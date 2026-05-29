/**
 * RecommendationService — CF candidates → LLM re-rank → cache.
 *
 * For users with no CF candidates, falls back to globally popular products.
 */

const z = require("zod");
const LLMRouter = require("./LLMRouter");
const CF = require("./CollaborativeFilter");

const RecommendationsSchema = z.object({
    items: z.array(z.object({
        product_id: z.number(),
        reason: z.string(),
        priority: z.number().min(0).max(1),
    })).max(10),
});

/**
 * Generate recommendations for a user.
 * Checks cache first (48h expiry), then runs CF + LLM pipeline.
 * @param {number} userId
 * @returns {Promise<{ items: Array<{ product_id: number, reason: string, priority: number }> }>}
 */
async function generateFor(userId) {
    const knex = require("../database/connection");

    // 1. Check cache.
    const cached = await knex("recommendation_cache")
        .where("user_id", userId)
        .where("expires_at", ">", knex.fn.now())
        .orderBy("generated_at", "desc")
        .first();

    if (cached) {
        const recs = typeof cached.recommendations === "string" ? JSON.parse(cached.recommendations) : cached.recommendations;
        return { items: recs, cached: true };
    }

    // 2. Get CF candidates.
    let candidates = await CF.getCandidates({ userId, limit: 50 });

    // 3. Fallback: globally popular products if no CF candidates.
    if (candidates.length === 0) {
        const popular = await knex("user_events")
            .select("product_id")
            .count("* as event_count")
            .whereNotNull("product_id")
            .groupBy("product_id")
            .orderBy("event_count", "desc")
            .limit(20);

        if (popular.length > 0) {
            candidates = popular.map((p) => ({ product_id: p.product_id, score: Number(p.event_count) / 100 }));
        }
    }

    // 4. If still no candidates, return popular products by price history.
    if (candidates.length === 0) {
        const topProducts = await knex("products")
            .select("id", "title", "price")
            .whereNotNull("price")
            .orderBy("price", "asc")
            .limit(10);
        const items = topProducts.map((p) => ({
            product_id: p.id,
            reason: `Popular product: ${p.title}`,
            priority: 0.5,
        }));
        await cacheResults(knex, userId, items);
        return { items, cached: false };
    }

    // 5. Fetch product details for candidates.
    const productIds = candidates.map((c) => c.product_id);
    const products = await knex("products")
        .select("id", "title", "price", "category_id")
        .whereIn("id", productIds)
        .whereNotNull("price");

    const productMap = {};
    for (const p of products) productMap[p.id] = p;

    // 6. Build prompt for LLM re-ranking.
    const candidateList = candidates
        .filter((c) => productMap[c.product_id])
        .slice(0, 20)
        .map((c) => ({
            product_id: c.product_id,
            title: productMap[c.product_id].title,
            price: Number(productMap[c.product_id].price),
            cf_score: c.score,
        }));

    if (candidateList.length === 0) {
        const items = [];
        await cacheResults(knex, userId, items);
        return { items, cached: false };
    }

    let items;
    try {
        const chat = await LLMRouter.getModel("SMART");
        const structured = chat.withStructuredOutput(RecommendationsSchema);
        const result = await structured.invoke([
            {
                role: "system",
                content: `You are a shopping recommendation engine. Given a list of candidate products with collaborative filtering scores, select and re-rank the top 10 most relevant recommendations. For each, write a short, friendly reason (10-200 chars) explaining why the user might like it. Set priority 0-1 (1=highest). Include at least one discovery item from an unfamiliar category if possible.`,
            },
            {
                role: "user",
                content: `Candidates:\n${JSON.stringify(candidateList)}\n\nSelect up to 10 and provide reasons.`,
            },
        ]);
        items = result.items;
    } catch (err) {
        console.error("[RecommendationService] LLM re-rank failed, using CF order:", err.message);
        items = candidateList.slice(0, 10).map((c) => ({
            product_id: c.product_id,
            reason: `Recommended based on your shopping history (${c.title})`,
            priority: Math.min(c.cf_score, 1),
        }));
    }

    // 7. Validate product IDs exist.
    items = items.filter((i) => productMap[i.product_id]);

    // 8. Cache.
    await cacheResults(knex, userId, items);

    return { items, cached: false };
}

async function cacheResults(knex, userId, items) {
    try {
        await knex("recommendation_cache").insert({
            user_id: userId,
            recommendations: JSON.stringify(items),
            generated_at: knex.fn.now(),
            expires_at: knex.raw("NOW() + INTERVAL '48 hours'"),
        });
    } catch (err) {
        console.error("[RecommendationService] Cache write failed:", err.message);
    }
}

module.exports = { generateFor };
