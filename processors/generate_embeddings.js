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
        // User requested to redo embeddings on title texts.
        // We will fetch ALL products.
        // Or better, let's reset them first to be sure?
        // Actually, just overwriting is fine.
        console.log("Fetching ALL products to regenerate embeddings...");
        const products = await Product.query(); // .whereNull("embedding") <--- Removed to force update

        console.log(`Found ${products.length} products.`);
        if (products.length === 0) {
            console.log("Nothing to do.");
            process.exit(0);
        }

        for (let i = 0; i < products.length; i += BATCH_SIZE) {
            const batch = products.slice(i, i + BATCH_SIZE);
            console.log(
                `Processing batch ${Math.ceil((i + 1) / BATCH_SIZE)}/${Math.ceil(products.length / BATCH_SIZE)}...`
            );

            for (let j = 0; j < batch.length; j++) {
                const product = batch[j];
                // "redo the embedings on title texts" - Ensure we use title.
                // Currently it uses product.title.
                const text = (product.title || "").trim().replace(/\n/g, " ");

                if (!text) continue;

                // Generate embedding
                const output = await extractor(text, { pooling: "mean", normalize: true });
                const embedding = Array.from(output.data);

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

        console.log("Done regenerating embeddings.");
        process.exit(0);
    } catch (err) {
        console.error("Global error:", err);
        process.exit(1);
    }
}

generateEmbeddings();
