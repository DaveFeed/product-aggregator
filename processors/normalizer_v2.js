const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const categoryRules = require("./category_rules");

const TRANSLATION_CACHE_FILE = path.join(__dirname, "../data/translation_cache.json");
let translationCache = {};

if (fs.existsSync(TRANSLATION_CACHE_FILE)) {
    try {
        translationCache = JSON.parse(fs.readFileSync(TRANSLATION_CACHE_FILE, "utf8"));
    } catch (e) {
        translationCache = {};
    }
}

function saveCache() {
    fs.writeFileSync(TRANSLATION_CACHE_FILE, JSON.stringify(translationCache, null, 2), "utf-8");
}

function generateId(str) {
    return crypto.createHash("md5").update(str).digest("hex").substring(0, 12);
}

// Parse price strings like "2,500 ֏", "5 000", "1.599,50", "֏75", "2,500.75" into a number.
// Strategy: determine the decimal separator from the LAST separator position, and only
// treat it as a decimal if it's followed by 1-2 digits and appears only once.
function parsePrice(priceStr) {
    if (priceStr === null || priceStr === undefined) return 0;
    const s = String(priceStr).replace(/[^\d.,\s]/g, "").replace(/\s/g, "");
    if (!s) return 0;

    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot === -1 && lastComma === -1) return parseFloat(s) || 0;

    const decSep = lastDot > lastComma ? "." : ",";
    const thouSep = decSep === "." ? "," : ".";
    const decSepCount = s.split(decSep).length - 1;
    const afterDec = s.length - Math.max(lastDot, lastComma) - 1;

    // If the candidate decimal separator repeats, or the suffix is not 1-2 digits,
    // treat ALL separators as thousands (strip them).
    if (decSepCount > 1 || afterDec < 1 || afterDec > 2) {
        return parseFloat(s.replace(/[.,]/g, "")) || 0;
    }

    let normalized = s.split(thouSep).join(""); // strip thousands
    if (decSep === ",") normalized = normalized.replace(",", ".");
    return parseFloat(normalized) || 0;
}

// Parse weight/size from a text (title or unit). Handles Armenian, Russian, English.
// Returns the equivalent weight in grams when mass is specified. For volume (l, ml)
// returns null (we don't know density). For piece counts returns null.
function parseWeight(textStr) {
    if (!textStr) return null;
    // Last numeric+unit match — product size tends to trail text.
    // Unicode-aware ending: use negative lookahead for a letter. \b is ASCII-only in JS.
    const re = /(\d+(?:[.,]\d+)?)\s*(kg|g|piece|pcs|l|ml|կգ|գ|լ|մլ|հատ|кг|г|л|мл|шт)(?![\p{L}])/gimu;
    const matches = [...String(textStr).matchAll(re)];
    if (matches.length === 0) return null;
    const m = matches[matches.length - 1];
    const value = parseFloat(m[1].replace(",", "."));
    if (isNaN(value) || value <= 0) return null;
    const unit = m[2].toLowerCase();
    const MASS_GRAM = new Set(["g", "գ", "г"]);
    const MASS_KG = new Set(["kg", "կգ", "кг"]);
    if (MASS_GRAM.has(unit)) return Math.round(value);
    if (MASS_KG.has(unit)) return Math.round(value * 1000);
    // Volume (l, ml, լ, մլ, л, мл) or count (pcs, piece, հատ, шт): not representable as grams.
    return null;
}

function parseVolumeMl(textStr) {
    if (!textStr) return null;
    const re = /(\d+(?:[.,]\d+)?)\s*(l|ml|լ|մլ|л|мл)(?![\p{L}])/gimu;
    const matches = [...String(textStr).matchAll(re)];
    if (matches.length === 0) return null;
    const m = matches[matches.length - 1];
    const value = parseFloat(m[1].replace(",", "."));
    if (isNaN(value) || value <= 0) return null;
    const unit = m[2].toLowerCase();
    if (unit === "ml" || unit === "մլ" || unit === "мл") return Math.round(value);
    return Math.round(value * 1000);
}

async function normalize(provider, inputFile, outputFile) {
    const UNIFIED_CATEGORIES_FILE = path.join(__dirname, "../data/unified_categories.json");
    const CATEGORY_MAPPING_FILE = path.join(__dirname, `../data/category_mapping_${provider}.json`);

    if (!fs.existsSync(inputFile)) {
        console.error(`Input file not found: ${inputFile}`);
        return;
    }

    const rawData = JSON.parse(fs.readFileSync(inputFile, "utf8"));
    let unifiedCategories = [];
    if (fs.existsSync(UNIFIED_CATEGORIES_FILE)) {
        try {
            unifiedCategories = JSON.parse(fs.readFileSync(UNIFIED_CATEGORIES_FILE, "utf8"));
        } catch (e) {
            unifiedCategories = [];
        }
    }

    let categoryMapping = {};
    if (fs.existsSync(CATEGORY_MAPPING_FILE)) {
        try {
            categoryMapping = JSON.parse(fs.readFileSync(CATEGORY_MAPPING_FILE, "utf8"));
        } catch (e) {
            categoryMapping = {};
        }
    }

    const categoriesMap = new Map();
    const products = [];
    const stats = { skippedInvalidCat: 0, skippedNoUrl: 0, titleDupes: 0 };

    console.log(`Processing ${rawData.length} raw products for provider: ${provider}...`);

    const uniqueCategories = [...new Set(rawData.map((i) => i.category_name))];
    console.log(`Found ${uniqueCategories.length} unique categories.`);

    uniqueCategories.forEach((catName) => {
        if (!categoryMapping[catName]) {
            categoryMapping[catName] = {
                en: catName,
                unified: categoryRules.getUnifiedCategory(catName),
            };
        }
    });
    console.log("Category mapping applied.");

    fs.writeFileSync(CATEGORY_MAPPING_FILE, JSON.stringify(categoryMapping, null, 2), "utf-8");
    saveCache();

    // Deduplicate products by product_url first — the same item often appears in multiple
    // subcategories on Parma/SAS. First-seen wins; all categories the product appeared in
    // are recorded in raw_data.categories_seen for later many-to-many linkage.
    const dedupedByUrl = new Map();
    const categoriesSeenByUrl = new Map();
    for (const item of rawData) {
        if (!item.product_url) {
            stats.skippedNoUrl++;
            continue;
        }
        if (!dedupedByUrl.has(item.product_url)) {
            dedupedByUrl.set(item.product_url, item);
            categoriesSeenByUrl.set(item.product_url, [item.category_name]);
        } else {
            const seen = categoriesSeenByUrl.get(item.product_url);
            if (!seen.includes(item.category_name)) seen.push(item.category_name);
        }
    }
    if (dedupedByUrl.size < rawData.length) {
        console.log(`Deduplicated ${rawData.length - dedupedByUrl.size} duplicate product URLs.`);
    }

    const titleCounts = new Map();
    for (const item of dedupedByUrl.values()) {
        const catName = item.category_name;

        if (!categoryRules.isValidCategory(catName)) {
            stats.skippedInvalidCat++;
            continue;
        }
        const catInfo = categoryMapping[catName] || { en: catName, unified: "Other" };
        const categoryKey = item.category_url || catName;

        if (!categoriesMap.has(categoryKey)) {
            categoriesMap.set(categoryKey, {
                id: generateId(categoryKey),
                name: catName,
                name_en: catInfo.en,
                unified_category: catInfo.unified,
                url: item.category_url,
                provider,
            });
        }
        const category = categoriesMap.get(categoryKey);

        // Weight from TITLE (corrects the v1 bug that used pricing-unit). Volume kept separate.
        const weight = parseWeight(item.title);
        const volumeMl = parseVolumeMl(item.title);

        const productId = generateId(item.product_url);
        const productTitle = item.title;

        // Track title collisions across different URLs within this provider so we can see
        // how often the old `(provider_id, title)` unique constraint would have merged rows.
        titleCounts.set(productTitle, (titleCounts.get(productTitle) || 0) + 1);

        products.push({
            id: productId,
            category_id: category.id,
            categories_seen: categoriesSeenByUrl.get(item.product_url) || [catName],
            external_product_id: item.external_product_id || null,
            provider,
            title: productTitle,
            title_en: productTitle, // placeholder — translator not wired into main pipeline
            subcategory: item.subcategory || "",
            promo_badge: item.promo_badge || "",
            unit: item.unit,
            weight,
            volume_ml: volumeMl,
            price_raw: item.price,
            price_value: parsePrice(item.price),
            original_price_raw: item.original_price || null,
            original_price_value: item.original_price ? parsePrice(item.original_price) : null,
            currency: item.currency || "AMD",
            image_url: item.image_url,
            product_url: item.product_url,
            fetch_url: item.product_url,
            add_to_cart_selector: item.add_to_cart_selector || "",
            last_updated: new Date().toISOString(),
            raw_data: item,
        });
    }

    for (const [t, n] of titleCounts) if (n > 1) stats.titleDupes += n - 1;

    const normalizedData = {
        categories: Array.from(categoriesMap.values()),
        products,
    };

    fs.writeFileSync(outputFile, JSON.stringify(normalizedData, null, 2), "utf-8");
    console.log(`Normalized data saved to ${outputFile}`);
    console.log(
        `Categories: ${normalizedData.categories.length}, Products: ${normalizedData.products.length}, ` +
            `skipped_invalid_cat=${stats.skippedInvalidCat}, skipped_no_url=${stats.skippedNoUrl}, ` +
            `within-provider-title-collisions=${stats.titleDupes}`
    );
}

async function main() {
    const provider = process.argv[2] || "sas_am";
    let defaultInput = path.join(__dirname, "../data/products_all.json");

    if (provider === "sas_am") defaultInput = path.join(__dirname, "../data/products_sas_clean.json");
    if (provider === "yerevan_city") defaultInput = path.join(__dirname, "../data/products_yerevan_city_clean.json");
    if (provider === "parma_am") defaultInput = path.join(__dirname, "../data/products_parma_am_clean.json");
    if (provider === "carrefour_am") defaultInput = path.join(__dirname, "../data/products_carrefour_am_clean.json");

    const inputFile = process.argv[3] || defaultInput;
    const outputFile = process.argv[4] || path.join(__dirname, `../data/normalized_db_${provider}.json`);

    console.log(`Provider: ${provider}`);
    console.log(`Input: ${inputFile}`);
    console.log(`Output: ${outputFile}`);

    await normalize(provider, inputFile, outputFile);
}

if (require.main === module) main();

module.exports = normalize;
