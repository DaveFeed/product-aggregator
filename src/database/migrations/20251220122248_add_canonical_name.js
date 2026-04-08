/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.alterTable("products", (table) => {
        table.text("canonical_name").nullable();
        // Index for faster regex/exact matching or future text search on this column
        table.index("canonical_name");
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.alterTable("products", (table) => {
        table.dropColumn("canonical_name");
    });
};
