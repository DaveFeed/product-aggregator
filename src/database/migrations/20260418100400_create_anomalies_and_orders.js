/**
 * Task 10: price_anomalies + orders (mock checkout) tables.
 */
exports.up = async function (knex) {
    await knex.raw("CREATE EXTENSION IF NOT EXISTS pgcrypto");

    await knex.schema.createTable("price_anomalies", (table) => {
        table.bigIncrements("id").primary();
        table.integer("product_id").unsigned().references("id").inTable("products").onDelete("CASCADE");
        table.decimal("anomalous_price", 18, 2);
        table.decimal("expected_min", 18, 2);
        table.decimal("expected_max", 18, 2);
        table.decimal("zscore", 8, 4);
        table.string("method");
        table.timestamp("detected_at").defaultTo(knex.fn.now());
        table.timestamp("resolved_at");
        table.jsonb("metadata").defaultTo("{}");
        table.index(["product_id", "detected_at"]);
    });

    await knex.schema.createTable("orders", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.integer("user_id").unsigned().references("id").inTable("users");
        table.string("status").notNullable().defaultTo("placed");
        table.decimal("total_price", 18, 2);
        table.integer("currency_id").unsigned().references("id").inTable("currencies").onDelete("SET NULL");
        table.jsonb("items").notNullable();
        table.jsonb("metadata").defaultTo("{}");
        table.timestamps(true, true);
    });
    await knex.raw(
        `ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('placed','cancelled','fulfilled'))`
    );
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("orders");
    await knex.schema.dropTableIfExists("price_anomalies");
};
