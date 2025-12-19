require("dotenv").config();
const { Model } = require("objection");
const Knex = require("knex");
const knexConfig = require("../knexfile");
const Provider = require("../src/models/Provider");
const Category = require("../src/models/Category");
const Product = require("../src/models/Product");

// Initialize Knex
const knex = Knex(knexConfig.development);
Model.knex(knex);

async function verify() {
    const providerCount = await Provider.query().resultSize();
    const categoryCount = await Category.query().resultSize();
    const productCount = await Product.query().resultSize();

    console.log(`Providers: ${providerCount}`);
    console.log(`Categories: ${categoryCount}`);
    console.log(`Products: ${productCount}`);

    // Detailed stats per provider
    const providerCounts = await Product.query().select("provider_id").count("*").groupBy("provider_id");

    console.log("Product counts per provider:", providerCounts);

    // Sample check
    const product = await Product.query().first().withGraphFetched("[provider, category]");

    console.log("Sample Product:", JSON.stringify(product, null, 2));

    await knex.destroy();
}

verify();
