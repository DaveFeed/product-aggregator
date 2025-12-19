require("dotenv").config({
    path: require("path").resolve(__dirname, "../.env"),
});
const Knex = require("knex");
const knexConfig = require("../knexfile");

// Initialize Knex
const knex = Knex(knexConfig.development);

async function clean() {
    try {
        console.log("Dropping all tables...");

        // Order matters due to Foreign Keys
        await knex.schema.dropTableIfExists("price_history");
        await knex.schema.dropTableIfExists("product_stocks");
        await knex.schema.dropTableIfExists("products");
        await knex.schema.dropTableIfExists("category_links");
        await knex.schema.dropTableIfExists("categories");
        await knex.schema.dropTableIfExists("providers");
        await knex.schema.dropTableIfExists("messages");
        await knex.schema.dropTableIfExists("users");
        await knex.schema.dropTableIfExists("currencies");

        // Reset migration history
        await knex.schema.dropTableIfExists("knex_migrations");
        await knex.schema.dropTableIfExists("knex_migrations_lock");

        console.log("Database tables dropped successfully!");
        process.exit(0);
    } catch (err) {
        console.error("Failed to clean database:", err);
        process.exit(1);
    }
}

clean();
