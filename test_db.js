require("dotenv").config();
const Knex = require("knex");
const knexConfig = require("./knexfile");
const knex = Knex(knexConfig.development);

async function check() {
    try {
        const count = await knex("products").count("id as c").first();
        console.log(`Total Products: ${count.c}`);

        const sample = await knex("products").whereNotNull("weight").first();
        console.log("Sample with weight:", sample ? sample.weight : "None");

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
