/**
 * Task 06: HNSW index on products.embedding for fast ANN search.
 * Uses CONCURRENTLY so it doesn't lock the table during build.
 *
 * Must run AFTER Task 05 (column resize) and Task 04 (re-embed).
 * The index build on 56k+ rows takes ~1-3 minutes.
 */
exports.config = { transaction: false };

exports.up = async function (knex) {
    await knex.raw(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS products_embedding_hnsw_idx
        ON products
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `);
};

exports.down = async function (knex) {
    await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS products_embedding_hnsw_idx`);
};
