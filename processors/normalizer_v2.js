const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// const { translate } = require("@vitalets/google-translate-api"); // Removed
const categoryRules = require("./category_rules");

// Cache for translations to avoid rate limits/redundant calls
const TRANSLATION_CACHE_FILE = path.join(__dirname, "../data/translation_cache.json");
let translationCache = {};

if (fs.existsSync(TRANSLATION_CACHE_FILE)) {
    translationCache = JSON.parse(fs.readFileSync(TRANSLATION_CACHE_FILE, "utf8"));
}

function saveCache() {
    fs.writeFileSync(TRANSLATION_CACHE_FILE, JSON.stringify(translationCache, null, 2), "utf-8");
}

function generateId(str) {
    return crypto.createHash("md5").update(str).digest("hex").substring(0, 12);
}

function parsePrice(priceStr) {
    if (!priceStr) return 0;
    const numericStr = priceStr.replace(/[^\d]/g, "");
    return parseInt(numericStr, 10) || 0;
}

async function normalize(provider, inputFile, outputFile) {
    const UNIFIED_CATEGORIES_FILE = path.join(__dirname, "../data/unified_categories.json");
    const CATEGORY_MAPPING_FILE = path.join(__dirname, `../data/category_mapping_${provider}.json`);

    if (!fs.existsSync(inputFile)) {
        console.error(`Input file not found: ${inputFile}`);
        return;
    }

    const rawData = JSON.parse(fs.readFileSync(inputFile, "utf8"));
    const unifiedCategories = JSON.parse(fs.readFileSync(UNIFIED_CATEGORIES_FILE, "utf8"));

    let categoryMapping = {};
    if (fs.existsSync(CATEGORY_MAPPING_FILE)) {
        categoryMapping = JSON.parse(fs.readFileSync(CATEGORY_MAPPING_FILE, "utf8"));
    }

    const categoriesMap = new Map();
    const products = [];

    console.log(`Processing ${rawData.length} raw products for provider: ${provider}...`);

    // 1. Process Categories First
    const uniqueCategories = [...new Set(rawData.map((i) => i.category_name))];
    console.log(`Found ${uniqueCategories.length} unique categories.`);

    // Skip translation in normalizer. We process it later or use existing mapping.
    // For now, if no mapping exists, default to original name.

    uniqueCategories.forEach((catName) => {
        if (!categoryMapping[catName]) {
            categoryMapping[catName] = {
                en: catName, // Default to original. Translate later if needed.
                unified: categoryRules.getUnifiedCategory(catName), // Attempt unification on original name (or skip)
            };
        }
    });

    console.log("Category mapping applied.");

    // Save mapping for future use/manual editing
    fs.writeFileSync(CATEGORY_MAPPING_FILE, JSON.stringify(categoryMapping, null, 2), "utf-8");
    saveCache();

    // 2. Process Products
    for (const item of rawData) {
        // Normalize Category
        const categoryKey = item.category_url;
        const catName = item.category_name;

        if (!categoryRules.isValidCategory(catName)) {
            console.log(`Skipping invalid category: ${catName}`);
            continue;
        }
        const catInfo = categoryMapping[catName] || {
            en: catName,
            unified: "Other",
        };

        if (!categoriesMap.has(categoryKey)) {
            categoriesMap.set(categoryKey, {
                id: generateId(categoryKey),
                name: catName,
                name_en: catInfo.en,
                unified_category: catInfo.unified,
                url: item.category_url,
                provider: provider,
            });
        }
        const category = categoriesMap.get(categoryKey);

        // Normalize Product
        // Skip if no product_url (critical for ID)
        if (!item.product_url) {
            console.warn(`Skipping item without product_url: ${item.title}`);
            continue;
        }
        function parseWeight(unitStr) {
            if (!unitStr) return null;
            const match = unitStr.match(/(\d+(\.\d+)?)\s*(kg|g|pcs|l|ml|կգ|գ|լ|մլ|հատ|кг|г|шт)/i);
            if (!match) return null;

            let value = parseFloat(match[1]);
            const unit = match[3].toLowerCase();

            // Convert to grams (g)
            if (["kg", "կգ", "кг", "l", "լ", "л"].includes(unit)) {
                value *= 1000;
            }
            // "pcs" or "шт" or "հատ" - might treat as 1 unit or null weight?
            // Schema says "weight" (grams). PCS isn't weight.
            // Let's return null for PCS or pieces, or keep as is?
            // "weight" implies mass. Liquids (l/ml) approximate to g.
            if (["pcs", "шт", "հատ"].includes(unit)) {
                return null; // Or handle quantity separately
            }

            return Math.round(value);
        }

        // ... internal functions ...

        const productId = generateId(item.product_url);

        products.push({
            id: productId,
            category_id: category.id,
            provider: provider,
            title: item.title,
            title_en: item.title, // Placeholder
            subcategory: item.subcategory || "",
            unit: item.unit,
            weight: parseWeight(item.unit), // New field
            price_raw: item.price,
            price_value: parsePrice(item.price),
            currency: "AMD",
            image_url: item.image_url,
            product_url: item.product_url, // Keep for reference
            fetch_url: item.product_url, // Match new schema
            add_to_cart_selector: item.add_to_cart_selector || "",
            last_updated: new Date().toISOString(),
            raw_data: item,
        });
    }

    const normalizedData = {
        categories: Array.from(categoriesMap.values()),
        products: products,
    };

    fs.writeFileSync(outputFile, JSON.stringify(normalizedData, null, 2), "utf-8");
    console.log(`Normalized data saved to ${outputFile}`);
    console.log(`Categories: ${normalizedData.categories.length}, Products: ${normalizedData.products.length}`);
}

async function main() {
    const provider = process.argv[2] || "sas_am";
    let defaultInput = path.join(__dirname, "../data/products_all.json");

    if (provider === "sas_am") defaultInput = path.join(__dirname, "../data/products_sas_clean.json");
    if (provider === "yerevan_city") defaultInput = path.join(__dirname, "../data/products_yerevan_city_clean.json");
    if (provider === "parma_am") defaultInput = path.join(__dirname, "../data/products_parma_am_clean.json");
    if (provider === "carrefour_am") defaultInput = path.join(__dirname, "../data/products_carrefour_am.json"); // Assuming no pre-clean step necessary yet

    const inputFile = process.argv[3] || defaultInput;
    const outputFile = process.argv[4] || path.join(__dirname, `../data/normalized_db_${provider}.json`);

    console.log(`Provider: ${provider}`);
    console.log(`Input: ${inputFile}`);
    console.log(`Output: ${outputFile}`);

    await normalize(provider, inputFile, outputFile);
}

if (require.main === module) {
    main();
}

module.exports = normalize;
