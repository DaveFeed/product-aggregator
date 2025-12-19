require("dotenv").config();
const { Model } = require("objection");
const Knex = require("knex");
const knexConfig = require("./knexfile");
const Provider = require("./src/models/Provider");
const Category = require("./src/models/Category");
const User = require("./src/models/User");
const Message = require("./src/models/Message");

const knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
Model.knex(knex);

async function verify() {
    console.log("Verifying database changes...");

    // 1. Verify Provider order_script
    const provider = await Provider.query().first();
    console.log(`Provider order_script: ${provider.order_script}`);

    // 2. Verify Category display_name
    const category = await Category.query().first();
    console.log(`Category display_name: ${category.display_name}`);

    // 3. Verify User columns exist (by checking schema info as we might not have users)
    const hasMetadata = await knex.schema.hasColumn("users", "metadata");
    const hasLanguage = await knex.schema.hasColumn("users", "language_code");
    const hasIsBot = await knex.schema.hasColumn("users", "is_bot");
    console.log(`User columns exist: metadata=${hasMetadata}, language_code=${hasLanguage}, is_bot=${hasIsBot}`);

    // 4. Verify Messages table exists
    const hasMessages = await knex.schema.hasTable("messages");
    console.log(`Messages table exists: ${hasMessages}`);

    process.exit(0);
}

verify().catch(console.error);
