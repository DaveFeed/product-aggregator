exports.up = function (knex) {
    return knex.schema
        .raw("DROP INDEX IF EXISTS products_embedding_idx")
        .then(() => {
            // Resize column to 384 dimensions (for all-MiniLM-L6-v2)
            // We set values to NULL because 1536->384 conversion isn't meaningful/possible directly
            return knex.schema.raw("ALTER TABLE products ALTER COLUMN embedding TYPE vector(384) USING NULL");
        })
        .then(() => {
            // Re-create index for 384 dimensions
            return knex.schema.raw(
                "CREATE INDEX products_embedding_idx ON products USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
            );
        });
};

exports.down = function (knex) {
    return knex.schema
        .raw("DROP INDEX IF EXISTS products_embedding_idx")
        .then(() => {
            return knex.schema.raw("ALTER TABLE products ALTER COLUMN embedding TYPE vector(1536) USING NULL");
        })
        .then(() => {
            return knex.schema.raw(
                "CREATE INDEX products_embedding_idx ON products USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
            );
        });
};
