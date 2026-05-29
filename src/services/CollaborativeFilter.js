/**
 * CollaborativeFilter — item-based CF for product recommendations.
 *
 * Computes item-to-item similarity from user_events co-occurrence,
 * stores top-50 similar items per product in item_similarity table.
 */

// Event weights per doc §6.1.
const EVENT_WEIGHTS = {
    purchase: 1.0,
    add_to_cart: 0.7,
    view: 0.3,
    search: 0.15,
    remove_from_cart: 0.0, // negative signal, not used for similarity
};

/**
 * Build the item similarity matrix from user_events co-occurrence.
 * Writes results to item_similarity table. Returns row count inserted.
 */
async function buildItemSimilarityMatrix() {
    const knex = require("../database/connection");

    // Clear old data.
    await knex("item_similarity").del();

    // Compute cosine similarity over co-occurrence:
    // sim(A,B) = |users(A) ∩ users(B)| / sqrt(|users(A)| * |users(B)|)
    // Only consider events with product_id, weighted by event type.
    // Cap to top-50 per source product.
    const { rows } = await knex.raw(`
        WITH weighted_events AS (
            SELECT user_id, product_id,
                   MAX(CASE event_type
                       WHEN 'purchase' THEN 1.0
                       WHEN 'add_to_cart' THEN 0.7
                       WHEN 'view' THEN 0.3
                       WHEN 'search' THEN 0.15
                       ELSE 0
                   END) AS weight
            FROM user_events
            WHERE product_id IS NOT NULL
              AND event_type != 'remove_from_cart'
            GROUP BY user_id, product_id
        ),
        product_user_counts AS (
            SELECT product_id, COUNT(DISTINCT user_id) AS user_count
            FROM weighted_events
            GROUP BY product_id
        ),
        co_occurrence AS (
            SELECT a.product_id AS source_id,
                   b.product_id AS target_id,
                   COUNT(DISTINCT a.user_id) AS co_users
            FROM weighted_events a
            JOIN weighted_events b ON a.user_id = b.user_id AND a.product_id < b.product_id
            GROUP BY a.product_id, b.product_id
            HAVING COUNT(DISTINCT a.user_id) >= 2
        ),
        similarities AS (
            SELECT c.source_id, c.target_id,
                   c.co_users::float / SQRT(pa.user_count::float * pb.user_count::float) AS score
            FROM co_occurrence c
            JOIN product_user_counts pa ON pa.product_id = c.source_id
            JOIN product_user_counts pb ON pb.product_id = c.target_id
        ),
        ranked AS (
            SELECT source_id, target_id, score,
                   ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY score DESC) AS rn
            FROM (
                SELECT source_id, target_id, score FROM similarities
                UNION ALL
                SELECT target_id, source_id, score FROM similarities
            ) both_dirs
        )
        SELECT source_id AS source_product_id, target_id AS target_product_id, score
        FROM ranked
        WHERE rn <= 50
    `);

    if (rows.length > 0) {
        // Batch insert.
        const batchSize = 500;
        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize).map((r) => ({
                source_product_id: r.source_product_id,
                target_product_id: r.target_product_id,
                score: r.score,
            }));
            await knex("item_similarity").insert(batch);
        }
    }

    console.log(`[CollaborativeFilter] Built similarity matrix: ${rows.length} rows`);
    return rows.length;
}

/**
 * Get recommendation candidates for a user based on their event history.
 * @param {{ userId: number, limit?: number }} opts
 * @returns {Promise<Array<{ product_id: number, score: number }>>}
 */
async function getCandidates({ userId, limit = 50 }) {
    const knex = require("../database/connection");

    // Get user's recent interacted products with weights.
    const events = await knex("user_events")
        .where("user_id", userId)
        .whereNotNull("product_id")
        .where("event_type", "!=", "remove_from_cart")
        .select("product_id", "event_type")
        .orderBy("created_at", "desc")
        .limit(100);

    if (events.length === 0) return [];

    // Aggregate weights per product.
    const productWeights = {};
    for (const e of events) {
        const w = EVENT_WEIGHTS[e.event_type] || 0;
        productWeights[e.product_id] = Math.max(productWeights[e.product_id] || 0, w);
    }
    const interactedIds = Object.keys(productWeights).map(Number);

    // Get purchased products in last 30 days to exclude.
    const recentPurchases = await knex("user_events")
        .where("user_id", userId)
        .where("event_type", "purchase")
        .where("created_at", ">", knex.raw("NOW() - INTERVAL '30 days'"))
        .whereNotNull("product_id")
        .pluck("product_id");
    const excludeSet = new Set(recentPurchases.concat(interactedIds));

    // Look up similar items for all interacted products.
    const similarities = await knex("item_similarity")
        .whereIn("source_product_id", interactedIds)
        .whereNotIn("target_product_id", [...excludeSet])
        .orderBy("score", "desc")
        .limit(200);

    // Aggregate scores: sum(similarity * event_weight).
    const candidateScores = {};
    for (const sim of similarities) {
        const eventWeight = productWeights[sim.source_product_id] || 0.1;
        const combined = sim.score * eventWeight;
        candidateScores[sim.target_product_id] = (candidateScores[sim.target_product_id] || 0) + combined;
    }

    // Sort and return top candidates.
    return Object.entries(candidateScores)
        .map(([pid, score]) => ({ product_id: Number(pid), score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

module.exports = { buildItemSimilarityMatrix, getCandidates, EVENT_WEIGHTS };
