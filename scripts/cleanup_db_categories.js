require("dotenv").config();
const { Model } = require("objection");
const Knex = require("knex");
const knexConfig = require("../knexfile");
const Category = require("../src/models/Category");
const Product = require("../src/models/Product");
const CategoryLink = require("../src/models/CategoryLink");

const knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
Model.knex(knex);

async function cleanup() {
    console.log("Starting Deep Category Cleanup...");
    const trx = await knex.transaction();

    try {
        // Ensure 'Other' category exists
        let otherCat = await Category.query(trx).whereRaw("LOWER(name) = ?", ["other"]).first();
        if (!otherCat) {
            otherCat = await Category.query(trx).insert({ name: "Other", display_name: "Other" });
        }

        // 1. Delete Garbage (Prices, Numbers, Short strings)
        console.log("Identifying garbage categories...");
        const allCategories = await Category.query(trx);

        // Regex for garbage:
        // - Contains ֏
        // - Is only numbers/dots/commas/spaces (Price-like)
        // - Is very short (<= 2 chars)
        const garbageCats = allCategories.filter((c) => {
            if (c.name === "Other") return false; // Protect Other
            if (c.name.includes("֏")) return true;
            if (/^[\d,.\s]+$/.test(c.name)) return true;
            if (c.name.trim().length <= 2) return true;
            if (["price tag", "unknown category", "grqer", "pices by kilogram"].includes(c.name.toLowerCase()))
                return true;
            return false;
        });

        console.log(`Found ${garbageCats.length} garbage categories.`);
        for (const cat of garbageCats) {
            // Reassign products to 'Other'
            await Product.query(trx).where("category_id", cat.id).patch({ category_id: otherCat.id });

            // Delete links
            await CategoryLink.query(trx).where("category_id", cat.id).delete();

            // Delete category
            await Category.query(trx).deleteById(cat.id);
            console.log(`Deleted garbage category: "${cat.name}" (ID: ${cat.id})`);
        }

        // 2. Title Case & Merge
        console.log("\nTitle Casing and Merging...");
        const remainingCats = await Category.query(trx).whereNot("id", otherCat.id);

        let mergedCount = 0;
        let renamedCount = 0;

        for (const cat of remainingCats) {
            const currentName = cat.name;
            const targetName = toTitleCase(currentName);

            if (currentName === targetName) continue; // Already title case

            // Check if target exists
            const existingTarget = await Category.query(trx).where({ name: targetName }).first();

            if (existingTarget) {
                // Merge into existing target
                console.log(`Merging "${currentName}" -> "${targetName}"`);

                await Product.query(trx).where("category_id", cat.id).patch({ category_id: existingTarget.id });

                // Handle Links
                const catLinks = await CategoryLink.query(trx).where("category_id", cat.id);
                for (const link of catLinks) {
                    const targetLink = await CategoryLink.query(trx)
                        .where("provider_id", link.provider_id)
                        .where("category_id", existingTarget.id)
                        .first();

                    if (!targetLink) {
                        await CategoryLink.query(trx).findById(link.id).patch({ category_id: existingTarget.id });
                    } else {
                        await CategoryLink.query(trx).deleteById(link.id);
                    }
                }

                await Category.query(trx).deleteById(cat.id);
                mergedCount++;
            } else {
                // Rename
                // console.log(`Renaming "${currentName}" -> "${targetName}"`);
                await Category.query(trx).findById(cat.id).patch({
                    name: targetName,
                    display_name: targetName, // Update display name too
                });
                renamedCount++;
            }
        }

        console.log(`Merged ${mergedCount} categories.`);
        console.log(`Renamed ${renamedCount} categories to Title Case.`);

        await trx.commit();
        console.log("Cleanup transactions committed successfully.");
    } catch (err) {
        console.error("Error during cleanup:", err);
        await trx.rollback();
        process.exit(1);
    }

    process.exit(0);
}

function toTitleCase(str) {
    if (!str) return "";
    return str
        .toLowerCase()
        .split(" ")
        .map(function (word) {
            if (!word) return "";
            // Handle parenthesis e.g. "(opt)"
            if (word.startsWith("(")) {
                return "(" + word.charAt(1).toUpperCase() + word.slice(2);
            }
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(" ");
}

function isTitleCase(str) {
    if (!str) return false;
    return str[0] === str[0].toUpperCase() && str !== str.toUpperCase();
}

cleanup();
