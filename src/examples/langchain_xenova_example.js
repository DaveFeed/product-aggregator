require("dotenv").config();
const SearchService = require("../services/SearchService");
const knexConfig = require("../../knexfile");
const Knex = require("knex");
const { Model } = require("objection");

/**
 * Validates the SearchService functionality using Xenova embeddings + GPT.
 * Replaces the old Xenova manual example.
 */
async function run() {
    console.log("Initializing Database...");
    const knex = Knex(knexConfig.development);
    Model.knex(knex);

    try {
        const query = "coding tools";
        console.log(`\nPerforming agentic search for: "${query}"`);

        const results = await SearchService.search(query);

        console.log("\nResults:");
        if (results.length === 0) {
            console.log("No matches found.");
        }
        results.forEach((res, i) => {
            console.log(`${i + 1}. [${res.provider_name || "?"}] ${res.title} - ${res.price}`);
            if (res.match_reason) console.log(`   Reason: ${res.match_reason}`);
        });
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await knex.destroy();
    }
}

if (require.main === module) {
    run().catch(console.error);
}
