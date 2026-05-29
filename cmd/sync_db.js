require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Knex = require("knex");
const { Model } = require("objection");
const knexConfig = require("../knexfile");
const Provider = require("../src/models/Provider");
const Product = require("../src/models/Product");
const Category = require("../src/models/Category");
const PriceHistory = require("../src/models/PriceHistory");
const Currency = require("../src/models/Currency");
const CategoryLink = require("../src/models/CategoryLink");

const knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
Model.knex(knex);

const FILES = [
    { path: path.join(__dirname, "../data/normalized_db_sas_am.json"), provider: "sas_am" },
    { path: path.join(__dirname, "../data/normalized_db_yerevan_city.json"), provider: "yerevan_city" },
    { path: path.join(__dirname, "../data/normalized_db_parma_am.json"), provider: "parma_am" },
    { path: path.join(__dirname, "../data/normalized_db_carrefour_am.json"), provider: "carrefour_am" },
];

const PROVIDER_BASE_URLS = {
    sas_am: "https://www.sas.am",
    yerevan_city: "https://yerevan-city.am",
    parma_am: "https://www.parma.am",
    carrefour_am: "https://www.carrefour.am",
};

async function syncCurrencies() {
    let amd = await Currency.query().findOne({ code: "AMD" });
    if (!amd) {
        amd = await Currency.query().insert({ code: "AMD", name: "Armenian Dram", symbol: "֏" });
        console.log("Created currency: AMD");
    }
    return amd;
}

async function syncProvider(name) {
    const baseUrl = PROVIDER_BASE_URLS[name] || "";
    let provider = await Provider.query().findOne({ name });
    if (!provider) {
        provider = await Provider.query().insert({
            name,
            display_name: name
                .split("_")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" "),
            base_url: baseUrl,
            // order_script stays NULL until a real order-placement integration exists.
        });
    }
    return provider;
}

async function syncCategoriesFor(provider, normalizedCategories, trx) {
    const categoryMap = new Map();

    for (const cat of normalizedCategories) {
        // Provider-specific name is authoritative; unified name is metadata only.
        const dbName = cat.name_en || cat.name;
        if (!dbName) continue;

        // Scope the lookup by (provider via category_links). At DB level, name is globally
        // unique, so we cannot have two providers with the same name text; we therefore
        // reuse the existing global row (the link table binds providers to that row).
        let category = await Category.query(trx).whereRaw("LOWER(name) = ?", [dbName.toLowerCase()]).first();

        const newMeta = {
            unified: cat.unified_category || "Other",
            original_names: [cat.name].filter(Boolean),
            providers: [provider.name],
        };

        if (!category) {
            category = await Category.query(trx).insert({
                name: dbName,
                display_name: dbName,
                metadata: newMeta,
            });
        } else {
            const existingMeta = category.metadata || {};
            const mergedOriginals = Array.from(
                new Set([...(existingMeta.original_names || []), ...(newMeta.original_names || [])])
            );
            const mergedProviders = Array.from(
                new Set([...(existingMeta.providers || []), ...(newMeta.providers || [])])
            );
            await Category.query(trx)
                .findById(category.id)
                .patch({
                    metadata: {
                        ...existingMeta,
                        unified: newMeta.unified,
                        original_names: mergedOriginals,
                        providers: mergedProviders,
                    },
                });
        }

        // Upsert category_link row
        let link = await CategoryLink.query(trx).findOne({ provider_id: provider.id, category_id: category.id });
        if (!link) {
            await CategoryLink.query(trx).insert({
                provider_id: provider.id,
                category_id: category.id,
                metadata: { url: cat.url },
            });
        } else {
            await CategoryLink.query(trx)
                .findById(link.id)
                .patch({ metadata: { ...(link.metadata || {}), url: cat.url } });
        }

        categoryMap.set(cat.id, category.id);
    }
    return categoryMap;
}

async function syncProductsFor(provider, normalizedProducts, categoryMap, currency, batchSize = 500) {
    let inserted = 0;
    let updated = 0;
    let priceChanged = 0;
    let skipped = 0;

    for (let i = 0; i < normalizedProducts.length; i += batchSize) {
        const batch = normalizedProducts.slice(i, i + batchSize);
        const trx = await knex.transaction();

        try {
            for (const item of batch) {
                const finalCategoryId = categoryMap.get(item.category_id);
                if (!finalCategoryId) {
                    skipped++;
                    continue;
                }

                const priceVal = item.price_value;
                const productTitle = item.title_en || item.title;

                // Upsert by (provider_id, fetch_url) rather than (provider_id, title).
                // Two different URLs may legitimately share a title; URL is the truly
                // stable identifier. The DB still enforces unique(provider_id, title)
                // until the schema migration lands — this loop catches that case and
                // appends an external-id suffix to avoid constraint violation.
                let product = await Product.query(trx).findOne({
                    provider_id: provider.id,
                    fetch_url: item.product_url,
                });

                const priceChangedForRow =
                    !product || product.price == null || Number(product.price) !== Number(priceVal);

                const baseData = {
                    provider_id: provider.id,
                    category_id: finalCategoryId,
                    title: productTitle,
                    fetch_url: item.product_url,
                    image_url: item.image_url,
                    price: priceVal,
                    weight: item.weight,
                    currency_id: currency.id,
                    raw_data: item.raw_data,
                    metadata: {
                        original_price: item.price_raw,
                        original_price_value: item.original_price_value,
                        subcategory: item.subcategory,
                        promo_badge: item.promo_badge,
                        unit: item.unit,
                        volume_ml: item.volume_ml,
                        external_product_id: item.external_product_id,
                        categories_seen: item.categories_seen,
                    },
                };

                if (!product) {
                    try {
                        product = await Product.query(trx).insert({
                            ...baseData,
                            created_at: new Date().toISOString(),
                        });
                        inserted++;
                    } catch (e) {
                        // Likely unique(provider_id, title) collision. Append an external-id
                        // suffix to make title unique, and retry insert. Log so we can track.
                        if (String(e.message || "").includes("unique")) {
                            const suffix = item.external_product_id || item.id || Date.now();
                            try {
                                product = await Product.query(trx).insert({
                                    ...baseData,
                                    title: `${productTitle} [#${suffix}]`,
                                    created_at: new Date().toISOString(),
                                });
                                inserted++;
                            } catch (e2) {
                                console.warn(`Skip ${item.product_url}: ${e2.message}`);
                                skipped++;
                                continue;
                            }
                        } else {
                            throw e;
                        }
                    }
                } else {
                    const mergedMeta = { ...(product.metadata || {}), ...baseData.metadata };
                    await Product.query(trx)
                        .findById(product.id)
                        .patch({
                            ...baseData,
                            metadata: mergedMeta,
                            updated_at: new Date().toISOString(),
                        });
                    updated++;
                }

                // Only record price history on actual changes. This avoids flooding the
                // table with identical rows on every nightly sync.
                if (priceVal != null && priceVal > 0 && priceChangedForRow) {
                    await PriceHistory.query(trx).insert({
                        product_id: product.id,
                        price: priceVal,
                        currency_id: currency.id,
                    });
                    priceChanged++;
                }
            }
            await trx.commit();
            console.log(
                `  Batch ${Math.ceil((i + 1) / batchSize)}/${Math.ceil(normalizedProducts.length / batchSize)} (inserted=${inserted} updated=${updated} price_changed=${priceChanged} skipped=${skipped})`
            );
        } catch (err) {
            await trx.rollback();
            console.error(`Batch error at index ${i}: ${err.message}`);
            // Fail fast — a schema-level error will repeat across all batches.
            throw err;
        }
    }

    return { inserted, updated, priceChanged, skipped };
}

const EMBED_BATCH_SIZE = parseInt(process.env.EMBEDDING_BATCH_SIZE, 10) || 32;
const FORCE_EMBEDDINGS = process.argv.includes("--force-embeddings");

async function embedProducts(productIds) {
    if (productIds.length === 0) return 0;
    const EmbeddingService = require("../src/services/EmbeddingService");
    let embedded = 0;

    for (let i = 0; i < productIds.length; i += EMBED_BATCH_SIZE) {
        const batchIds = productIds.slice(i, i + EMBED_BATCH_SIZE);
        try {
            const rows = await knex("products")
                .select("id", "canonical_name", "title")
                .whereIn("id", batchIds);

            const texts = rows.map((r) => r.canonical_name || r.title || "product");
            const vectors = await EmbeddingService.embedBatch(texts);

            for (let j = 0; j < rows.length; j++) {
                const vecStr = EmbeddingService.vectorToPgString(vectors[j]);
                await knex.raw("UPDATE products SET embedding = ?::vector WHERE id = ?", [vecStr, rows[j].id]);
            }
            embedded += rows.length;
        } catch (err) {
            console.error(`  Embedding batch error at offset ${i}: ${err.message}`);
            // Continue with remaining batches — embeddings are best-effort.
        }
    }
    return embedded;
}

async function sync() {
    console.log("Starting DB Sync...");
    const currency = await syncCurrencies();

    for (const fileInfo of FILES) {
        if (!fs.existsSync(fileInfo.path)) {
            console.warn(`File not found: ${fileInfo.path}`);
            continue;
        }

        console.log(`\n=== Processing ${fileInfo.provider} ===`);
        const data = JSON.parse(fs.readFileSync(fileInfo.path, "utf8"));
        const { categories, products } = data;
        if (!categories || !products) {
            console.warn(`Invalid normalized data structure for ${fileInfo.provider}`);
            continue;
        }

        const provider = await syncProvider(fileInfo.provider);
        console.log(`Provider ${fileInfo.provider} synced (ID: ${provider.id})`);

        const catTrx = await knex.transaction();
        let categoryMap;
        try {
            categoryMap = await syncCategoriesFor(provider, categories, catTrx);
            await catTrx.commit();
            console.log(`Synced ${categories.length} categories.`);
        } catch (err) {
            await catTrx.rollback();
            console.error(`Category sync failed for ${fileInfo.provider}: ${err.message}`);
            throw err;
        }

        const result = await syncProductsFor(provider, products, categoryMap, currency);
        console.log(`Synced ${fileInfo.provider}:`, result);

        // Embed products that need it.
        const embQuery = knex("products").select("id").where("provider_id", provider.id);
        if (!FORCE_EMBEDDINGS) {
            embQuery.whereNull("embedding");
        }
        const needEmbed = await embQuery.pluck("id");
        if (needEmbed.length > 0) {
            console.log(`  Embedding ${needEmbed.length} products for ${fileInfo.provider}...`);
            const embCount = await embedProducts(needEmbed);
            console.log(`  Embedded ${embCount} products.`);
        } else {
            console.log(`  All products already embedded.`);
        }
    }

    console.log("\nSync completed successfully!");
}

if (require.main === module) {
    sync()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { sync, syncCurrencies, syncProvider, syncCategoriesFor, syncProductsFor };
