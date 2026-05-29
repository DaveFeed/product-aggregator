/**
 * Task 30: auth_link_codes table for Telegram account linking.
 */
exports.up = async function (knex) {
    await knex.schema.createTable("auth_link_codes", (table) => {
        table.string("code", 6).primary();
        table.integer("user_id").unsigned().references("id").inTable("users").onDelete("CASCADE");
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("consumed_at");
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("auth_link_codes");
};
