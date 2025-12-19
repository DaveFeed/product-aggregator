exports.up = function (knex) {
    return knex.schema.table("categories", function (table) {
        table.integer("parent_id").unsigned().nullable();
        table.foreign("parent_id").references("categories.id").onDelete("SET NULL");
    });
};

exports.down = function (knex) {
    return knex.schema.table("categories", function (table) {
        table.dropColumn("parent_id");
    });
};
