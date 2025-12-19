require("dotenv").config();
const { Model } = require("objection");
const Knex = require("knex");
const knexConfig = require("./knexfile");
const Category = require("./src/models/Category");

const knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
Model.knex(knex);

async function analyze() {
    console.log("Analyzing Categories...");

    const categories = await Category.query();
    console.log(`Total Categories: ${categories.length}`);

    const numericCategories = categories.filter(
        (c) => /^\d+$/.test(c.name.trim()) || /^\d+$/.test(c.display_name.trim())
    );
    console.log(`\nNumeric Categories Found: ${numericCategories.length}`);
    if (numericCategories.length > 0) {
        console.log(
            "Examples:",
            numericCategories.slice(0, 10).map((c) => c.name)
        );
    }

    // Check for potential duplicates (case-insensitive)
    const nameMap = {};
    categories.forEach((c) => {
        const key = c.name.toLowerCase().trim();
        if (!nameMap[key]) nameMap[key] = [];
        nameMap[key].push(c.id);
    });

    const duplicates = Object.entries(nameMap).filter(([k, v]) => v.length > 1);
    console.log(`\nPotential Case-Insensitive Duplicates: ${duplicates.length}`);
    if (duplicates.length > 0) {
        console.log("Examples:", duplicates.slice(0, 5));
    }

    // Check for categories that look very similar (e.g. plural/singular or mostly same words)
    // This is expensive O(N^2), let's just dump the top 50 names to eyeball
    console.log("\nSample Categories:");
    console.log(
        categories
            .slice(0, 20)
            .map((c) => c.name)
            .join(", ")
    );

    process.exit(0);
}

analyze().catch(console.error);
