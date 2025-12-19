require("dotenv").config();
const { Model } = require("objection");
const Knex = require("knex");
const knexConfig = require("./knexfile");
const Category = require("./src/models/Category");
const fs = require("fs");

const knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
Model.knex(knex);

async function dump() {
    console.log("Dumping all categories...");
    const categories = await Category.query().orderBy("name");

    const lines = categories.map((c) => c.name);
    fs.writeFileSync("all_categories.txt", lines.join("\n"));

    console.log(`Dumped ${lines.length} categories to all_categories.txt`);
    process.exit(0);
}

dump().catch(console.error);
