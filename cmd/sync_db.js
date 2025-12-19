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
const ProductStock = require("../src/models/ProductStock");

// Initialize Knex
const knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
Model.knex(knex);

const FILES = [
    {
        path: path.join(__dirname, "../data/normalized_db_sas_am.json"),
        provider: "sas_am",
    },
    {
        path: path.join(__dirname, "../data/normalized_db_yerevan_city.json"),
        provider: "yerevan_city",
    },
    {
        path: path.join(__dirname, "../data/normalized_db_parma_am.json"),
        provider: "parma_am",
    },
    {
        path: path.join(__dirname, "../data/normalized_db_carrefour_am.json"),
        provider: "carrefour_am",
    },
];

async function sync() {
    console.log("Starting DB Sync...");

    // 0. Ensure Currencies exist
    let amdCurrency = await Currency.query().findOne({ code: "AMD" });
    if (!amdCurrency) {
        amdCurrency = await Currency.query().insert({
            code: "AMD",
            name: "Armenian Dram",
            symbol: "֏",
        });
        console.log("Created currency: AMD");
    }

    const providerMap = {};
    for (const fileInfo of FILES) {
        if (!fs.existsSync(fileInfo.path)) continue;

        const name = fileInfo.provider;
        let baseUrl = "https://www.sas.am";
        if (name === "yerevan_city") baseUrl = "https://yerevan-city.am";
        if (name === "parma_am") baseUrl = "https://www.parma.am";
        if (name === "carrefour_am") baseUrl = "https://www.carrefour.am";

        let provider = await Provider.query().findOne({ name });
        if (!provider) {
            provider = await Provider.query().insert({
                name,
                display_name: name
                    .split("_")
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(" "),
                base_url: baseUrl,
                order_script: "test_script", // Placeholder for now as data source doesn't have it
                order_script: "test_script", // Placeholder for now as data source doesn't have it
            });
        } else {
            await Provider.query().findById(provider.id).patch({
                order_script: "test_script",
            });
        }
        providerMap[name] = provider.id;
        console.log(`Provider ${name} synced (ID: ${provider.id})`);
    }

    // 2. Sync Categories and Products
    for (const fileInfo of FILES) {
        if (!fs.existsSync(fileInfo.path)) {
            console.warn(`File not found: ${fileInfo.path}`);
            continue;
        }

        console.log(`Processing ${fileInfo.provider}...`);
        const trx = await knex.transaction();

        try {
            const data = JSON.parse(fs.readFileSync(fileInfo.path, "utf8"));
            const providerId = providerMap[fileInfo.provider];
            const { categories: normalizedCategories, products: normalizedProducts } = data;

            if (!normalizedCategories || !normalizedProducts) {
                console.warn(`Invalid normalized data structure for ${fileInfo.provider}`);
                await trx.rollback();
                continue;
            }

            // Sync Categories
            const categoryMap = new Map();

            for (const cat of normalizedCategories) {
                const dbName =
                    cat.unified_category && cat.unified_category !== "Other"
                        ? cat.unified_category
                        : cat.name_en || cat.name;

                let category = await Category.query(trx).whereRaw("LOWER(name) = ?", [dbName.toLowerCase()]).first();

                if (!category) {
                    category = await Category.query(trx).insert({
                        name: dbName,
                        display_name: dbName,
                        metadata: {
                            unified: cat.unified_category,
                            original_names: [cat.name],
                        },
                    });
                } else {
                    const meta = category.metadata || {};
                    const originals = meta.original_names || [];
                    if (!originals.includes(cat.name)) {
                        originals.push(cat.name);
                        await Category.query(trx)
                            .findById(category.id)
                            .patch({
                                metadata: { ...meta, original_names: originals },
                            });
                    }
                }

                let link = await CategoryLink.query(trx).findOne({
                    provider_id: providerId,
                    category_id: category.id,
                });

                if (!link) {
                    await CategoryLink.query(trx).insert({
                        provider_id: providerId,
                        category_id: category.id,
                        metadata: { url: cat.url },
                    });
                } else {
                    await CategoryLink.query(trx)
                        .findById(link.id)
                        .patch({
                            metadata: { ...link.metadata, url: cat.url },
                        });
                }

                categoryMap.set(cat.id, category.id);
            }
            console.log(`Synced ${normalizedCategories.length} categories.`);
            await trx.commit(); // Commit categories transaction

            // Sync Products with Batching
            console.log(`Syncing ${normalizedProducts.length} products...`);
            const BATCH_SIZE = 500;
            let productsSynced = 0;

            for (let i = 0; i < normalizedProducts.length; i += BATCH_SIZE) {
                const batch = normalizedProducts.slice(i, i + BATCH_SIZE);
                const batchTrx = await knex.transaction();

                try {
                    for (const item of batch) {
                        const finalCategoryId = categoryMap.get(item.category_id);
                        if (!finalCategoryId) continue;

                        const priceVal = item.price_value;
                        const productTitle = item.title_en || item.title;

                        let product = await Product.query(batchTrx).findOne({
                            provider_id: providerId,
                            title: productTitle,
                        });

                        const productData = {
                            provider_id: providerId,
                            category_id: finalCategoryId,
                            title: productTitle,
                            fetch_url: item.product_url,
                            image_url: item.image_url,
                            price: priceVal,
                            weight: item.weight,
                            currency_id: amdCurrency.id,
                            raw_data: item.raw_data,
                            metadata: {
                                original_price: item.price_raw,
                                subcategory: item.subcategory,
                                unit: item.unit,
                            },
                        };

                        if (!product) {
                            product = await Product.query(batchTrx).insert({
                                ...productData,
                                created_at: new Date().toISOString(),
                            });
                        } else {
                            // Merge metadata to preserve reclassification info
                            const existingMeta = product.metadata || {};
                            const mergedMeta = { ...existingMeta, ...productData.metadata };

                            await Product.query(batchTrx)
                                .findById(product.id)
                                .patch({
                                    ...productData,
                                    metadata: mergedMeta,
                                    updated_at: new Date().toISOString(),
                                });
                        }

                        // Stock
                        let stock = await ProductStock.query(batchTrx).findOne({ product_id: product.id });
                        if (!stock) {
                            await ProductStock.query(batchTrx).insert({
                                product_id: product.id,
                                amount: 100,
                            });
                        }

                        // Price History
                        if (priceVal !== null && priceVal > 0) {
                            await PriceHistory.query(batchTrx).insert({
                                product_id: product.id,
                                price: priceVal,
                                currency_id: amdCurrency.id,
                            });
                        }
                        productsSynced++;
                    }

                    await batchTrx.commit();
                    console.log(
                        `  Committed batch ${Math.ceil((i + 1) / BATCH_SIZE)}/${Math.ceil(
                            normalizedProducts.length / BATCH_SIZE
                        )} (${productsSynced} total)`
                    );
                } catch (err) {
                    console.error(`Error in batch starting at index ${i}:`, err);
                    await batchTrx.rollback();
                    // Don't kill the whole process, but maybe this provider is compromised
                    // For now, let's continue to try other batches?
                    // But if it's a schema issue, they will all fail.
                    // Let's log and re-throw to skip to next provider.
                    throw err;
                }
            }
            console.log(`Synced ${productsSynced} items for ${fileInfo.provider}`);
        } catch (err) {
            console.error(`Error syncing ${fileInfo.provider}:`, err);
            // Outer transaction (used for categories) is already committed/rolled back?
            // If error happened in Category loop, we need to rollback `trx`.
            // If it happened in Product loop, `trx` was already committed.
            // Objection/Knex handles "commit execution" promise.
            // Check if trx is completed?
            if (!trx.isCompleted()) {
                await trx.rollback();
            }
        }
    }

    console.log("Sync completed successfully!");
    process.exit(0);
}

sync().catch((err) => {
    console.error(err);
    process.exit(1);
});
