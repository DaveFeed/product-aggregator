/**
 * DealScoreService — computes a Deal Score ∈ [0, 1] for a product based on
 * its price history. Formula from doc §7.2:
 *
 *   DealScore = 0.4·P_hist + 0.3·P_zscore + 0.3·P_momentum
 *
 * P_hist    — (max - current) / (max - min). 1 = at historical min, 0 = at max.
 * P_zscore  — sigmoid of z-score: 1/(1+exp(z)). Cheap → high, expensive → low.
 * P_momentum — linear regression slope of last 7 days. Downward trend → high.
 */

/**
 * Simple linear regression: returns { slope, intercept }.
 * x = [0, 1, 2, ...], y = price values.
 */
function linearRegression(yValues) {
    const n = yValues.length;
    if (n < 2) return { slope: 0, intercept: yValues[0] || 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += yValues[i];
        sumXY += i * yValues[i];
        sumXX += i * i;
    }
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return { slope: 0, intercept: sumY / n };
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
}

function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

/**
 * Compute Deal Score from raw data (no DB access).
 *
 * @param {number} currentPrice - the product's current price
 * @param {Array<{avg_price:number}>} history - daily price-history rows (sorted by day ascending)
 * @param {{ windowDays?: number }} [opts]
 * @returns {{ dealScore: number|null, components: object, sampleCount: number, insufficient_data: boolean }}
 */
function computeFromData(currentPrice, history, opts = {}) {
    if (!history || history.length < 3) {
        return { dealScore: null, components: {}, sampleCount: history?.length || 0, insufficient_data: true };
    }

    const prices = history.map((h) => Number(h.avg_price));
    const n = prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const mean = prices.reduce((a, b) => a + b, 0) / n;
    const stddev = Math.sqrt(prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / n);

    // P_hist: normalized position. 1 = at min, 0 = at max.
    const pHist = max === min ? 0.5 : clamp01((max - currentPrice) / (max - min));

    // P_zscore: sigmoid of z-score. Low z (cheap) → sigmoid → high.
    const z = stddev > 0 ? (currentPrice - mean) / stddev : 0;
    const pZscore = 1 / (1 + Math.exp(z));

    // P_momentum: slope of last 7 days (or all if < 7). Negative slope (falling) = good deal.
    const momentumWindow = prices.slice(-7);
    const { slope } = linearRegression(momentumWindow);
    // Normalize: slope is in price/day. A 10% daily drop is extremely strong.
    // Map slope to [0,1] via sigmoid-like transform: pMomentum = 1/(1+exp(slope/avgPrice * 20))
    // Downward slope → negative → exp(<0) < 1 → > 0.5; upward → > 0 → < 0.5.
    const normalizedSlope = mean > 0 ? (slope / mean) * 20 : 0;
    const pMomentum = clamp01(1 / (1 + Math.exp(normalizedSlope)));

    const dealScore = 0.4 * pHist + 0.3 * pZscore + 0.3 * pMomentum;

    return {
        dealScore: Math.round(dealScore * 1000) / 1000,
        components: {
            hist: Math.round(pHist * 1000) / 1000,
            zscore: Math.round(pZscore * 1000) / 1000,
            momentum: Math.round(pMomentum * 1000) / 1000,
        },
        sampleCount: n,
        insufficient_data: false,
    };
}

/**
 * Compute deal score for a product by ID (requires DB — calls price_history_daily MV).
 * Falls back to price_history table if MV doesn't exist.
 */
async function compute(productId, { windowDays = 90 } = {}) {
    const Product = require("../models/Product");
    const knex = Product.knex();

    const product = await Product.query().findById(productId);
    if (!product || product.price == null) {
        return { dealScore: null, insufficient_data: true, sampleCount: 0 };
    }

    // Try MV first, fall back to raw price_history.
    let history;
    const hasMV = await knex.schema.hasTable("price_history_daily").catch(() => false);
    if (hasMV) {
        history = await knex("price_history_daily")
            .where("product_id", productId)
            .where("day", ">=", knex.raw(`NOW() - INTERVAL '${parseInt(windowDays, 10)} days'`))
            .orderBy("day", "asc");
    } else {
        history = await knex("price_history")
            .select(
                knex.raw("date_trunc('day', created_at)::date as day"),
                knex.raw("avg(price)::numeric(18,2) as avg_price"),
                knex.raw("min(price) as min_price"),
                knex.raw("max(price) as max_price"),
                knex.raw("count(*) as sample_count")
            )
            .where("product_id", productId)
            .where("created_at", ">=", knex.raw(`NOW() - INTERVAL '${parseInt(windowDays, 10)} days'`))
            .groupByRaw("date_trunc('day', created_at)")
            .orderByRaw("date_trunc('day', created_at) ASC");
    }

    return computeFromData(Number(product.price), history, { windowDays });
}

module.exports = { compute, computeFromData, linearRegression };
