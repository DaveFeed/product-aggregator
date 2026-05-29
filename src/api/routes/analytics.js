/**
 * Analytics REST API — price history, deal score, provider comparison.
 */

const express = require("express");
const router = express.Router();

/**
 * Parse and validate a required integer query param.
 * @returns {number|null} null means invalid (caller should 400).
 */
function parseIntParam(val) {
    if (val == null || val === "") return null;
    const n = Number(val);
    if (!Number.isFinite(n) || n !== Math.floor(n)) return null;
    return n;
}

// GET /api/analytics/price-history?product_id=X&days=30
router.get("/price-history", async (req, res, next) => {
    try {
        const productId = parseIntParam(req.query.product_id);
        if (productId === null) return res.status(400).json({ error: "product_id must be an integer" });
        const days = parseIntParam(req.query.days) || 30;

        const knex = require("../../database/connection");
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();

        // Get current price.
        const product = await knex("products").select("price").where("id", productId).first();
        const currentPrice = product ? Number(product.price) : null;

        // Get history from MV or raw table.
        let points;
        try {
            points = await knex("price_history_daily")
                .where("product_id", productId)
                .where("day", ">=", cutoff)
                .orderBy("day", "asc")
                .select("day", "min_price as min", "max_price as max", "avg_price as avg", "sample_count");
        } catch {
            points = await knex("price_history")
                .where("product_id", productId)
                .where("created_at", ">=", cutoff)
                .orderBy("created_at", "asc")
                .select(knex.raw("created_at as day, price as min, price as max, price as avg, 1 as sample_count"));
        }

        // Deal score (lazy load to avoid circular deps).
        let dealScore = null;
        try {
            const DealScoreService = require("../../services/DealScoreService");
            const ds = await DealScoreService.compute(productId, { windowDays: days });
            dealScore = ds;
        } catch {
            // DealScoreService may not have enough data.
        }

        res.json({
            product_id: productId,
            current_price: currentPrice,
            deal_score: dealScore?.deal_score ?? null,
            points: points.map((p) => ({
                day: p.day,
                min: Number(p.min),
                max: Number(p.max),
                avg: Number(p.avg),
                sample_count: Number(p.sample_count),
            })),
        });
    } catch (err) {
        next(err);
    }
});

// GET /api/analytics/deal-score?product_id=X
router.get("/deal-score", async (req, res, next) => {
    try {
        const productId = parseIntParam(req.query.product_id);
        if (productId === null) return res.status(400).json({ error: "product_id must be an integer" });

        const DealScoreService = require("../../services/DealScoreService");
        const windowDays = parseIntParam(req.query.days) || 30;
        const result = await DealScoreService.compute(productId, { windowDays });

        res.json({
            product_id: productId,
            deal_score: result.dealScore ?? result.deal_score ?? null,
            components: result.components || {},
            window_days: windowDays,
            sample_count: result.sampleCount ?? result.sample_count ?? 0,
        });
    } catch (err) {
        next(err);
    }
});

// GET /api/analytics/provider-comparison?product_title=...
router.get("/provider-comparison", async (req, res, next) => {
    try {
        const title = req.query.product_title;
        if (!title || typeof title !== "string" || title.trim().length === 0) {
            return res.status(400).json({ error: "product_title is required" });
        }

        const knex = require("../../database/connection");
        const { rows } = await knex.raw(`
            SELECT p.id, p.title, p.price, p.fetch_url AS product_url,
                   p.provider_id, prov.display_name AS provider_name,
                   similarity(p.canonical_name, ?) AS sim
            FROM products p
            LEFT JOIN providers prov ON prov.id = p.provider_id
            WHERE p.canonical_name % ?
              AND p.price IS NOT NULL
            ORDER BY sim DESC
            LIMIT 20
        `, [title.trim(), title.trim()]);

        res.json({
            query: title,
            items: rows.map((r) => ({
                id: r.id,
                title: r.title,
                price: Number(r.price),
                provider: r.provider_name || "Unknown",
                product_url: r.product_url,
                similarity: Number(r.sim),
            })),
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
