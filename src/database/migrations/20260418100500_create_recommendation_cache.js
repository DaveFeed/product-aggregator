/**
 * Task 11: recommendation_cache table.
 */
exports.up = async function (knex) {
    await knex.schema.createTable("recommendation_cache", (table) => {
        table.bigIncrements("id").primary();
        table.integer("user_id").unsigned().references("id").inTable("users").onDelete("CASCADE");
        table.jsonb("recommendations").notNullable();
        table.timestamp("generated_at").defaultTo(knex.fn.now());
        table.timestamp("delivered_at");
        table.timestamp("expires_at").notNullable();
        table.jsonb("metadata").defaultTo("{}");
    });
    // Use a simple composite unique on (user_id, generated_at) to prevent exact-duplicate
    // inserts. The "at most one per day" invariant is enforced app-side instead of via a
    // functional index (generated_at::date is not IMMUTABLE in PostgreSQL).
    await knex.raw(
        `CREATE UNIQUE INDEX rec_cache_user_gen_uq ON recommendation_cache (user_id, generated_at)`
    );
    await knex.raw(`CREATE INDEX rec_cache_expires_idx ON recommendation_cache (expires_at)`);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("recommendation_cache");
};
