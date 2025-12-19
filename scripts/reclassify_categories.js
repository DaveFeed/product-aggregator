require("dotenv").config();
const { Model } = require("objection");
const Knex = require("knex");
const knexConfig = require("../knexfile");
const Category = require("../src/models/Category");
const Product = require("../src/models/Product");
const CategoryLink = require("../src/models/CategoryLink");

const knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
Model.knex(knex);

// Taxonomy Definition
const TAXONOMY = {
    "Food & Pantry": [
        "Fruits & Vegetables",
        "Meat, Poultry & Seafood",
        "Dairy, Eggs & Cheese",
        "Bakery & Bread",
        "Pantry & Groceries",
        "Frozen Foods",
        "Beverages",
        "Sweets & Snacks",
    ],
    Household: ["Cleaning & Laundry", "Disposables & Paper", "Kitchenware & Home"],
    "Personal Care": ["Hygiene & Bath", "Beauty & Cosmetics"],
    Other: [
        "Baby Care",
        "Pet Supplies",
        "Electronics & Misc",
        "Alcohol & Tobacco", // Added explicit group for these
    ],
};

// Keyword mapping rules (ORDER MATTERS - specific first)
const RULES = [
    // Alcohol & Tobacco
    {
        match: [
            "vodka",
            "whiskey",
            "brandy",
            "beer",
            "wine",
            "cognac",
            "gin",
            "rum",
            "tequila",
            "liqueur",
            "alcohol",
            "tobacco",
            "cigar",
            "cigarette",
            "smoke",
        ],
        target: "Alcohol & Tobacco",
    },

    // Baby
    { match: ["baby", "diaper", "wipes", "infant", "newborn", "toy"], target: "Baby Care" },

    // Pet
    { match: ["dog", "cat", "pet", "animal", "feed"], target: "Pet Supplies" },

    // Personal Care
    {
        match: [
            "shampoo",
            "soap",
            "shower",
            "gel",
            "paste",
            "tooth",
            "brush",
            "hair",
            "shav",
            "razor",
            "deodorant",
            "hygiene",
            "sanitary",
            "pad",
            "cotton",
            "bath",
            "wash",
        ],
        target: "Hygiene & Bath",
    },
    {
        match: [
            "cream",
            "lotion",
            "mask",
            "makeup",
            "lipstick",
            "pencil",
            "mascara",
            "polish",
            "cosmetic",
            "perfume",
            "face",
            "skin",
            "beauty",
        ],
        target: "Beauty & Cosmetics",
    },

    // Household
    {
        match: [
            "clean",
            "detergent",
            "laundry",
            "bleach",
            "stain",
            "washing",
            "powder",
            "capsule",
            "freshener",
            "spray",
        ],
        target: "Cleaning & Laundry",
    },
    {
        match: [
            "paper",
            "towel",
            "tissue",
            "napkin",
            "disposable",
            "cup",
            "plate",
            "bag",
            "foil",
            "wrap",
            "tableware",
            "trash",
        ],
        target: "Disposables & Paper",
    },
    {
        match: [
            "kitchen",
            "pan",
            "pot",
            "knife",
            "fork",
            "spoon",
            "glass",
            "mug",
            "lamp",
            "bulb",
            "battery",
            "home",
            "decor",
            "candle",
        ],
        target: "Kitchenware & Home",
    },

    // Food - Specifics
    { match: ["frozen", "ice cream"], target: "Frozen Foods" },
    {
        match: [
            "bread",
            "bakery",
            "cake",
            "pastry",
            "cookie",
            "biscuit",
            "pie",
            "dough",
            "roll",
            "bun",
            "toast",
            "lavash",
            "matnakash",
        ],
        target: "Bakery & Bread",
    },
    {
        match: ["milk", "cheese", "butter", "yogurt", "cream", "curd", "kefir", "matsoun", "egg", "dairy", "margarine"],
        target: "Dairy, Eggs & Cheese",
    },
    {
        match: [
            "meat",
            "beef",
            "pork",
            "lamb",
            "chicken",
            "poultry",
            "fish",
            "seafood",
            "caviar",
            "sausage",
            "ham",
            "bacon",
            "salami",
        ],
        target: "Meat, Poultry & Seafood",
    },
    {
        match: [
            "fruit",
            "vegetable",
            "apple",
            "banana",
            "orange",
            "grape",
            "berry",
            "berries",
            "tomato",
            "cucumber",
            "potato",
            "onion",
            "carrot",
            "herb",
            "green",
            "salad",
            "pepper",
            "citrus",
            "exotic",
        ],
        target: "Fruits & Vegetables",
    },
    {
        match: ["water", "juice", "soda", "cola", "drink", "tea", "coffee", "cocoa", "beverage", "energy", "lemonade"],
        target: "Beverages",
    },

    // Food - Pantry/General
    {
        match: ["chocolate", "candy", "sweet", "snack", "chip", "nut", "seed", "dried", "gum", "waffle", "bar"],
        target: "Sweets & Snacks",
    },
    {
        match: [
            "oil",
            "sugar",
            "salt",
            "spice",
            "sauce",
            "ketchup",
            "mayo",
            "pasta",
            "noodle",
            "rice",
            "grain",
            "cereal",
            "flour",
            "canned",
            "preserve",
            "jam",
            "honey",
            "pantry",
            "grocery",
            "food",
        ],
        target: "Pantry & Groceries",
    },
];

async function reclassify() {
    console.log("Starting Reclassification...");
    const trx = await knex.transaction();

    try {
        // 1. Ensure Taxonomy Exists
        const categoryMap = {}; // name -> id

        for (const [parentName, children] of Object.entries(TAXONOMY)) {
            let parent = await Category.query(trx).whereRaw("LOWER(name) = ?", [parentName.toLowerCase()]).first();
            if (!parent) {
                parent = await Category.query(trx).insert({
                    name: parentName,
                    display_name: parentName,
                    parent_id: null,
                });
                console.log(`Created Parent: ${parentName}`);
            }

            for (const childName of children) {
                let child = await Category.query(trx).whereRaw("LOWER(name) = ?", [childName.toLowerCase()]).first();
                // If it exists but has no parent, update parent. If it doesn't exist, create it.
                if (!child) {
                    child = await Category.query(trx).insert({
                        name: childName,
                        display_name: childName,
                        parent_id: parent.id,
                    });
                    console.log(`  Created Child: ${childName}`);
                } else if (child.parent_id !== parent.id) {
                    await Category.query(trx).findById(child.id).patch({ parent_id: parent.id });
                    console.log(`  Linked Child: ${childName}`);
                }
                categoryMap[childName] = child.id;
            }
        }

        const miscId =
            categoryMap["Electronics & Misc"] ||
            (await Category.query(trx).where({ name: "Electronics & Misc" }).first()).id;

        // 2. Classify Existing Categories
        const allCategories = await Category.query(trx);

        let movedCount = 0;

        for (const cat of allCategories) {
            // Skip if it is already one of our new taxonomy nodes
            const isTaxonomyNode =
                Object.values(TAXONOMY).flat().includes(cat.name) || Object.keys(TAXONOMY).includes(cat.name);
            if (isTaxonomyNode) continue;

            let targetId = null;
            const lowerName = cat.name.toLowerCase();

            // Find match
            for (const rule of RULES) {
                if (rule.match.some((keyword) => lowerName.includes(keyword))) {
                    targetId = categoryMap[rule.target];
                    break;
                }
            }

            // Fallback to Pantry if it looks like food but wasnt matched, otherwise Misc
            if (!targetId) {
                // Heuristic: If we don't know, it goes to Misc, unless user reviews later.
                targetId = miscId;
            }

            // 3. Move Products
            if (targetId) {
                console.log(`Mapping "${cat.name}" -> ID: ${targetId}`);

                // Fetch products first to update metadata
                // Fetch products first to update metadata
                const products = await Product.query(trx).where("category_id", cat.id);
                for (const p of products) {
                    const existingProductMeta = p.metadata || {};
                    const newMeta = {
                        ...existingProductMeta,
                        original_category_name: cat.name,
                        original_category_id: cat.id,
                        original_category_metadata: cat.metadata || null, // Preserve old category's metadata if any
                    };

                    await Product.query(trx).findById(p.id).patch({
                        category_id: targetId,
                        metadata: newMeta,
                    });
                }

                // Delete old category
                await CategoryLink.query(trx).where("category_id", cat.id).delete();
                await Category.query(trx).deleteById(cat.id);
                movedCount++;
            }
        }

        console.log(`Reclassified and removed ${movedCount} old categories.`);

        await trx.commit();
        console.log("Reclassification committed.");
    } catch (err) {
        console.error("Error:", err);
        await trx.rollback();
        process.exit(1);
    }
    process.exit(0);
}

reclassify();
