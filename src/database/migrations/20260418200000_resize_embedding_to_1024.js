/**
 * Task 05: Resize products.embedding from vector(384) to vector(1024) for bge-m3.
 *
 * WARNING: This NULLs all existing embeddings. Run Task 04 (re-embed) after this migration.
 * DO NOT apply until ready to re-embed all 56k+ products.
 */
exports.up = async function (knex) {
    // 1. Drop existing IVFFlat index (if it exists).
    await knex.raw(`DROP INDEX IF EXISTS products_embedding_idx`);
    // 2. NULL all existing 384d embeddings (incompatible with new dimension).
    await knex.raw(`UPDATE products SET embedding = NULL`);
    // 3. Alter column type to vector(1024).
    await knex.raw(`ALTER TABLE products ALTER COLUMN embedding TYPE vector(1024)`);
};

exports.down = async function (knex) {
    await knex.raw(`DROP INDEX IF EXISTS products_embedding_hnsw_idx`);
    await knex.raw(`UPDATE products SET embedding = NULL`);
    await knex.raw(`ALTER TABLE products ALTER COLUMN embedding TYPE vector(384)`);
};
