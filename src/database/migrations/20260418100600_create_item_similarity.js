/**
 * Task 22: item_similarity table for collaborative filtering.
 */
exports.up = async function (knex) {
    await knex.schema.createTable("item_similarity", (table) => {
        table.integer("source_product_id").unsigned().notNullable()
            .references("id").inTable("products").onDelete("CASCADE");
        table.integer("target_product_id").unsigned().notNullable()
            .references("id").inTable("products").onDelete("CASCADE");
        table.float("score").notNullable();
        table.timestamp("updated_at").defaultTo(knex.fn.now());
        table.primary(["source_product_id", "target_product_id"]);
        table.index(["source_product_id", "score"]);
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("item_similarity");
};
