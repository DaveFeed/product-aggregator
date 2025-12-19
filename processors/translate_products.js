require("dotenv").config();

const Knex = require("knex");
const { Model } = require("objection");
const knexConfig = require("../knexfile");
const Product = require("../src/models/Product");
const Provider = require("../src/models/Provider");

// Initialize Knex
const knex = Knex(knexConfig.development);
Model.knex(knex);

// Strategy:
// Use local free-translate-api container at http://localhost:8000/translate
// It supports simple POST {"text": "...", "to": "en"}.
// We'll process with some concurrency since it's "Unlimited" but local.
// Let's try concurrency of 5-10.

const CONCURRENCY = 1;
const TRANSLATOR_URL = process.env.TRANSLATOR_URL || "http://127.0.0.1:8000";

async function translateTitle(text) {
    try {
        const res = await fetch(`${TRANSLATOR_URL}/translate`, {
            method: "POST",
            body: JSON.stringify({
                text: text,
                to: "en",
            }),
            headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        return data.translatedText || data.translation || data.text || JSON.stringify(data);
    } catch (e) {
        throw e;
    }
}

const BATCH_SIZE = 20;

async function translateBatch(texts) {
    if (!texts || texts.length === 0) return [];
    const joined = texts.join("\n");
    try {
        const res = await fetch(`${TRANSLATOR_URL}/translate`, {
            method: "POST",
            body: JSON.stringify({
                text: joined,
                to: "en",
            }),
            headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const resultText = data.translatedText || data.translation || data.text || "";

        // Split by newline
        return resultText.split("\n").map((t) => t.trim());
    } catch (e) {
        throw e;
    }
}

async function processProvider(provider) {
    console.log(`Processing provider: ${provider.name} (ID: ${provider.id})`);

    const products = await Product.query().where("provider_id", provider.id);
    const toSort = products.filter((p) => !p.metadata || !p.metadata.original_title);

    console.log(`Found ${toSort.length} products needing translation for ${provider.name}.`);

    if (toSort.length === 0) return;

    // Batch processing
    for (let i = 0; i < toSort.length; i += BATCH_SIZE) {
        const batch = toSort.slice(i, i + BATCH_SIZE);
        const originalTitles = batch.map((p) => p.title);

        console.log(
            `    [${provider.name}] Batch ${Math.ceil((i + 1) / BATCH_SIZE)}/${Math.ceil(
                toSort.length / BATCH_SIZE
            )} (${batch.length} items)...`
        );

        try {
            let translatedTitles = await translateBatch(originalTitles);

            // Validation: Length mismatch or empty result
            if (translatedTitles.length !== batch.length) {
                console.warn(
                    `    Mismatch in batch translation (Sent: ${batch.length}, Got: ${translatedTitles.length}). Falling back to individual translation.`
                );
                // Fallback: Translate individually
                translatedTitles = [];
                for (const title of originalTitles) {
                    try {
                        const single = await translateBatch([title]);
                        translatedTitles.push(single[0] || title);
                    } catch (e) {
                        console.error(`    Failed individual translation for "${title}": ${e.message}`);
                        translatedTitles.push(title); // Keep original on error
                    }
                }
            }

            // Save updates
            for (let j = 0; j < batch.length; j++) {
                const product = batch[j];
                const originalTitle = originalTitles[j];
                let translatedTitle = translatedTitles[j];

                // Truncate to 255 chars to avoid DB error
                if (translatedTitle && translatedTitle.length > 255) {
                    translatedTitle = translatedTitle.substring(0, 255);
                }

                if (translatedTitle && translatedTitle !== originalTitle) {
                    await Product.query()
                        .findById(product.id)
                        .patch({
                            title: translatedTitle,
                            metadata: {
                                ...product.metadata,
                                original_title: originalTitle,
                                original_language: "auto",
                            },
                        });
                    // Log first item of batch to show progress
                    if (j === 0) {
                        console.log(
                            `    ✓ [Batch Sample] ${originalTitle.substring(0, 20)}... -> ${translatedTitle.substring(
                                0,
                                20
                            )}...`
                        );
                    }
                } else {
                    await Product.query()
                        .findById(product.id)
                        .patch({
                            metadata: {
                                ...product.metadata,
                                original_title: originalTitle,
                                original_language: "auto",
                            },
                        });
                }
            }
        } catch (e) {
            console.error(`    ✗ Batch failed: ${e.message}`);
        }

        // Small delay to prevent overwhelming local container
        await new Promise((r) => setTimeout(r, 200));
    }
}

async function run() {
    try {
        const providers = await Provider.query();
        console.log(`Found ${providers.length} providers.`);

        for (const provider of providers) {
            await processProvider(provider);
        }

        console.log("Done!");
        process.exit(0);
    } catch (err) {
        console.error("Global error:", err);
        process.exit(1);
    }
}

run();
