require("dotenv").config();
const Knex = require("knex");
const { Model } = require("objection");
const knexConfig = require("../knexfile");
const Product = require("../src/models/Product");

// Initialize Knex
const knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
Model.knex(knex);

const BATCH_SIZE = 50; // Smaller batch for local CPU inference

async function generateEmbeddings() {
    console.log("Starting embedding generation...");

    // Lazy load transformers
    const { pipeline } = await import("@xenova/transformers");

    // Switch to Multilingual model (384 dims, valid for en/ru/hy)
    console.log("Loading model 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'...");
    // Singleton extractor
    const extractor = await pipeline("feature-extraction", "Xenova/paraphrase-multilingual-MiniLM-L12-v2");
    console.log("Model loaded.");

    try {
        const products = await Product.query().whereNull("embedding");

        console.log(`Found ${products.length} products needing embeddings.`);
        if (products.length === 0) {
            console.log("Nothing to do.");
            process.exit(0);
        }

        for (let i = 0; i < products.length; i += BATCH_SIZE) {
            const batch = products.slice(i, i + BATCH_SIZE);
            console.log(
                `Processing batch ${Math.ceil((i + 1) / BATCH_SIZE)}/${Math.ceil(products.length / BATCH_SIZE)}...`
            );

            // Process serially or in parallel? Parallel might block event loop if not threaded.
            // Transformers.js in Node (onnxruntime) is reasonably fast but CPU bound.
            // Let's loop items in batch.

            for (let j = 0; j < batch.length; j++) {
                const product = batch[j];
                const text = (product.title || "").replace(/\n/g, " ");

                // Generate embedding
                const output = await extractor(text, { pooling: "mean", normalize: true });
                const embedding = Array.from(output.data); // Float32Array to Array

                const vectorString = JSON.stringify(embedding);

                await Product.query()
                    .findById(product.id)
                    .patch({
                        embedding: knex.raw(`?::vector`, [vectorString]),
                    });
            }

            // tiny delay to breathe
            await new Promise((r) => setTimeout(r, 100));
        }

        console.log("Done generating embeddings.");
        process.exit(0);
    } catch (err) {
        console.error("Global error:", err);
        process.exit(1);
    }
}

generateEmbeddings();
