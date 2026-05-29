/**
 * @deprecated Replaced by integrated embedding in cmd/sync_db.js (Task 04).
 * Embeddings are now computed automatically during sync.
 * Use: npm run refresh (or cmd/sync_db.js --force-embeddings)
 */

const fs = require("fs");
const path = require("path");

// Scan for all normalized db files
function getAllNormalizedData() {
    const dataDir = path.join(__dirname, "../data");
    const files = fs.readdirSync(dataDir).filter((f) => f.startsWith("normalized_db_") && f.endsWith(".json"));

    let allCategories = [];
    let allProducts = [];
    let seenCategories = new Set(); // To merge categories by ID if strict, or just concat.
    // Wait, categories usually have unique ID per provider run in normalizer?
    // Normalizer v2 generates IDs like "sas_123". So they are unique.

    files.forEach((file) => {
        const content = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
        if (content.categories) allCategories.push(...content.categories);
        if (content.products) allProducts.push(...content.products);
    });

    return { categories: allCategories, products: allProducts };
}

const OUTPUT_FILE = path.join(__dirname, "../data/rag_documents.json");

function prepRag() {
    const db = getAllNormalizedData();
    if (db.products.length === 0) {
        console.warn("No products found in normalized_db_*.json files.");
        return;
    }

    const documents = [];

    // Create a map for quick category lookup
    const categoryMap = new Map();
    db.categories.forEach((c) => categoryMap.set(c.id, c));

    console.log(`Preparing RAG documents from ${db.products.length} products...`);

    db.products.forEach((product) => {
        const category = categoryMap.get(product.category_id);
        const categoryName = category ? category.name : "Unknown";
        const categoryEn = category ? category.name_en : "Unknown";
        const unifiedCategory = category ? category.unified_category : "Other";

        // Construct text content for embedding
        // "Provider: {provider}. Product: {title_en} ({title}). Category: {unified} ({en}). Price: {price_raw}."
        const content = `Provider: ${product.provider}. Product: ${product.title_en} (${product.title}). Category: ${unifiedCategory} (${categoryEn}). Price: ${product.price_raw}.`;

        // Construct metadata for filtering
        const metadata = {
            product_id: product.id,
            price: product.price_value,
            category: unifiedCategory, // Use unified for broad filtering
            category_original: categoryName,
            provider: product.provider,
            url: product.product_url,
            image_url: product.image_url,
        };

        documents.push({
            content: content,
            metadata: metadata,
        });
    });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(documents, null, 2), "utf-8");
    console.log(`RAG documents saved to ${OUTPUT_FILE}`);
    console.log(`Total documents: ${documents.length}`);
}

if (require.main === module) {
    prepRag();
}

module.exports = prepRag;
