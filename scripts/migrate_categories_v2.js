require("dotenv").config();
const Knex = require("knex");
const { Model } = require("objection");
const knexConfig = require("../knexfile");
const Category = require("../src/models/Category");
const Product = require("../src/models/Product");

const knex = Knex(knexConfig.development);
Model.knex(knex);

const BATCH_SIZE = 20;

async function translateBatch(texts) {
    // Reuse same logic as processors/translate_products.js
    // Ideally this should be a shared utility, but duplicating for script isolation
    if (!texts || texts.length === 0) return [];
    const joined = texts.join("\n");
    try {
        const res = await fetch("http://127.0.0.1:8000/translate", {
            method: "POST",
            body: JSON.stringify({ text: joined, to: "en" }),
            headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        const resultText = data.translatedText || data.translation || data.text || "";
        return resultText.split("\n").map((t) => t.trim());
    } catch (e) {
        console.error("Translation failed:", e.message);
        return texts; // Fallback to original
    }
}

async function run() {
    try {
        console.log("Starting Category Migration (URL-based)...");

        // 1. Fetch all products
        const products = await Product.query().select("id", "url", "provider_id");
        console.log(`Found ${products.length} products to classify.`);

        const slugMap = new Map(); // slug -> [productIds]
        const slugToOriginal = new Map(); // slug -> "Nice String"

        // 2. Extract Slugs
        for (const p of products) {
            if (!p.url) continue;
            try {
                // http://.../catalog/slug/id/
                const match = p.url.match(/\/catalog\/([^/]+)\//);
                if (match && match[1]) {
                    const slug = match[1];
                    if (!slugMap.has(slug)) {
                        slugMap.set(slug, []);
                        // Convert "novogodnie_dekoratsii" -> "Novogodnie dekoratsii"
                        let nice = slug.replace(/_/g, " ");
                        nice = nice.charAt(0).toUpperCase() + nice.slice(1);
                        slugToOriginal.set(slug, nice);
                    }
                    slugMap.get(slug).push(p.id);
                }
            } catch (e) {
                // ignore malformed
            }
        }

        const uniqueSlugs = Array.from(slugMap.keys());
        console.log(`Found ${uniqueSlugs.length} unique category slugs.`);

        // 3. Translate Unique Categories
        // Process in batches
        const slugToEng = new Map();

        for (let i = 0; i < uniqueSlugs.length; i += BATCH_SIZE) {
            const batchSlugs = uniqueSlugs.slice(i, i + BATCH_SIZE);
            const batchTexts = batchSlugs.map((s) => slugToOriginal.get(s));

            console.log(`Translating batch ${Math.ceil((i + 1) / BATCH_SIZE)}...`);
            const trans = await translateBatch(batchTexts);

            for (let j = 0; j < batchSlugs.length; j++) {
                slugToEng.set(batchSlugs[j], trans[j] || batchTexts[j]);
            }

            await new Promise((r) => setTimeout(r, 200));
        }

        // 4. Create Categories & Link
        // We merge by English Name
        const engToCatId = new Map();

        for (const slug of uniqueSlugs) {
            const engName = slugToEng.get(slug);

            let catId;
            if (engToCatId.has(engName)) {
                catId = engToCatId.get(engName);
                // Merge logic: append slug to metadata if we want strict tracking?
                // User wants "merge", so treating them as same category is fine.
            } else {
                // Create new Category
                // Hardcoding provider logic for URL construction since we know it's generic extraction
                // Assuming unique English names for now
                const created = await Category.query().insert({
                    name: engName,
                    metadata: { original_slugs: [slug] },
                    // Construct URL primarily for SAS (provider 1/3)
                    // We can append to provider_links map
                    provider_links: {
                        sas_am: `https://www.sas.am/catalog/${slug}/`,
                        // If we had yerevan_city mapping, we'd add it here
                    },
                });
                catId = created.id;
                engToCatId.set(engName, catId);
                console.log(`Created Category: ${engName} (ID: ${catId})`);
            }

            // Link products
            const pIds = slugMap.get(slug);
            await Product.query().findByIds(pIds).patch({ category_id: catId });
        }

        console.log("Migration Complete.");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
