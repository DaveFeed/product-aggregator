/**
 * Task 08: user_events table for behavior signals (view, search, cart, purchase).
 */
exports.up = async function (knex) {
    await knex.schema.createTable("user_events", (table) => {
        table.bigIncrements("id").primary();
        table.integer("user_id").unsigned().references("id").inTable("users").onDelete("CASCADE");
        table.string("event_type").notNullable();
        table.integer("product_id").unsigned().references("id").inTable("products").onDelete("SET NULL");
        table.integer("category_id").unsigned().references("id").inTable("categories").onDelete("SET NULL");
        table.text("query");
        table.jsonb("metadata").defaultTo("{}");
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.index(["user_id", "event_type", "created_at"]);
        table.index(["product_id", "event_type", "created_at"]);
    });
    await knex.raw(
        `ALTER TABLE user_events ADD CONSTRAINT user_events_type_check CHECK (event_type IN ('view', 'search', 'add_to_cart', 'remove_from_cart', 'purchase'))`
    );
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("user_events");
};
