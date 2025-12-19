/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema
        .raw("CREATE EXTENSION IF NOT EXISTS pg_trgm")

        .createTable("users", (table) => {
            table.increments("id");
            table.string("telegram_id").notNullable().unique();
            table.string("username");
            table.string("first_name");
            table.string("last_name");
            table.string("language_code");
            table.boolean("is_bot").defaultTo(false);

            table.jsonb("metadata").defaultTo("{}");
            table.timestamps(true, true);
        })

        .createTable("messages", (table) => {
            table.increments("id").primary();
            table.integer("user_id").unsigned().notNullable().references("id").inTable("users").onDelete("SET NULL");
            table.string("type").notNullable();
            table.string("text");

            table.jsonb("metadata").defaultTo("{}");
            table.timestamps(true, true);
        })

        .createTable("providers", (table) => {
            table.increments("id").primary();
            table.string("name").notNullable().unique();
            table.string("display_name").notNullable();
            table.string("description");
            table.string("base_url").notNullable();
            table.text("order_script");

            table.jsonb("metadata").defaultTo("{}");
            table.timestamps(true, true);
        })

        .createTable("categories", (table) => {
            table.increments("id").primary();
            table.string("name").notNullable().unique();
            table.string("display_name").notNullable();
            table.string("description");

            table.jsonb("metadata").defaultTo("{}");
            table.timestamps(true, true);
        })

        .createTable("category_links", (table) => {
            table.increments("id").primary();
            table
                .integer("provider_id")
                .unsigned()
                .notNullable()
                .references("id")
                .inTable("providers")
                .onDelete("CASCADE");
            table
                .integer("category_id")
                .unsigned()
                .notNullable()
                .references("id")
                .inTable("categories")
                .onDelete("CASCADE");

            table.jsonb("metadata").defaultTo("{}");
            table.timestamps(true, true);
        })

        .createTable("currencies", (table) => {
            table.increments("id").primary();
            table.string("code").notNullable().unique();
            table.string("name").notNullable();
            table.string("symbol").notNullable();

            table.jsonb("metadata").defaultTo("{}");
            table.timestamps(true, true);
        })

        .createTable("products", (table) => {
            table.increments("id").primary();
            table
                .integer("provider_id")
                .unsigned()
                .notNullable()
                .references("id")
                .inTable("providers")
                .onDelete("CASCADE");
            table
                .integer("category_id")
                .unsigned()
                .notNullable()
                .references("id")
                .inTable("categories")
                .onDelete("SET NULL");
            table.string("title").notNullable();
            table.string("description");
            table.integer("weight").unsigned(); // in grams

            table.text("fetch_url").notNullable();
            table.text("image_url");

            table.decimal("price", 18, 2);
            table.integer("currency_id").unsigned().references("id").inTable("currencies").onDelete("SET NULL");

            table.jsonb("raw_data").nullable(); // whatever cron result is
            table.jsonb("metadata").defaultTo("{}");
            table.timestamps(true, true);
            table.unique(["provider_id", "title"]);
        })

        .createTable("product_stocks", (table) => {
            table.increments("id").primary();
            table.integer("product_id").notNullable().references("id").inTable("products").onDelete("CASCADE");
            table.decimal("amount", 14, 2).notNullable();
            table.jsonb("metadata").defaultTo("{}");
            table.timestamps(true, true);
        })

        .createTable("price_history", (table) => {
            table.increments("id").primary();
            table.integer("product_id").notNullable().references("id").inTable("products").onDelete("CASCADE");
            table.decimal("price", 18, 2).notNullable();
            table
                .integer("currency_id")
                .notNullable()
                .unsigned()
                .references("id")
                .inTable("currencies")
                .onDelete("SET NULL");

            table.timestamp("created_at").defaultTo(knex.fn.now());
            table.index("created_at", "idx_created_at", "brin");
        });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema
        .dropTableIfExists("price_history")
        .dropTableIfExists("product_stocks")
        .dropTableIfExists("products")
        .dropTableIfExists("category_links")
        .dropTableIfExists("categories")
        .dropTableIfExists("providers")
        .dropTableIfExists("users")
        .dropTableIfExists("messages")
        .dropTableIfExists("currencies")
        .raw("DROP EXTENSION IF EXISTS pg_trgm");
};
