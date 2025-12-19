require("dotenv").config({
    path: require("path").resolve(__dirname, "../.env"),
});
const Knex = require("knex");
const knexConfig = require("../knexfile");

const knex = Knex(knexConfig.development);

async function verify() {
    try {
        const productsCount = await knex("products").count("id as count").first();
        const historyCount = await knex("price_history").count("id as count").first();

        console.log(`Products: ${productsCount.count}`);
        console.log(`Price History Entries: ${historyCount.count}`);

        if (parseInt(historyCount.count) > 0 && parseInt(historyCount.count) >= parseInt(productsCount.count)) {
            console.log("Verification SUCCESS: History populated.");
        } else {
            console.log("Verification FAILED: History missing or incomplete.");
        }

        const sample = await knex("price_history")
            .join("products", "price_history.product_id", "products.id")
            .select("products.title", "price_history.price", "price_history.created_at")
            .limit(3);

        console.log("Sample History:", sample);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

verify();
