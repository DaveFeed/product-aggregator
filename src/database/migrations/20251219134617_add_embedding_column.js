exports.up = function (knex) {
    return knex.schema
        .raw("CREATE EXTENSION IF NOT EXISTS vector")
        .then(() => {
            return knex.schema.alterTable("products", (table) => {
                table.specificType("embedding", "vector(1536)");
            });
        })
        .then(() => {
            // Index for faster cosine similarity search
            return knex.schema.raw(
                "CREATE INDEX products_embedding_idx ON products USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
            );
        });
};

exports.down = function (knex) {
    return knex.schema
        .alterTable("products", (table) => {
            table.dropColumn("embedding");
        })
        .then(() => {
            return knex.schema.raw("DROP EXTENSION IF NOT EXISTS vector");
        });
};
