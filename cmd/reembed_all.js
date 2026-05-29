#!/usr/bin/env node

/**
 * Re-embed all products using the current EmbeddingService model.
 * Processes in batches of BATCH_SIZE (default 32).
 */

require("dotenv").config();
const Knex = require("knex");
const { Model } = require("objection");
const knexConfig = require("../knexfile");
const knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
Model.knex(knex);

const EmbeddingService = require("../src/services/EmbeddingService");

const BATCH_SIZE = parseInt(process.env.EMBEDDING_BATCH_SIZE, 10) || 32;

(async () => {
    console.log(`[reembed] Model: ${process.env.EMBEDDING_MODEL || "Xenova/bge-m3"}`);
    console.log(`[reembed] Dims: ${EmbeddingService.getDims()}`);
    console.log(`[reembed] Batch size: ${BATCH_SIZE}`);

    const total = await knex("products").count("id as cnt").first();
    console.log(`[reembed] Total products: ${total.cnt}`);

    let processed = 0;
    let offset = 0;
    const start = Date.now();

    while (true) {
        const products = await knex("products")
            .select("id", "canonical_name", "title")
            .orderBy("id")
            .limit(BATCH_SIZE)
            .offset(offset);

        if (products.length === 0) break;

        const texts = products.map((p) => p.canonical_name || p.title || "unknown product");
        const vectors = await EmbeddingService.embedBatch(texts);

        for (let i = 0; i < products.length; i++) {
            const vecStr = EmbeddingService.vectorToPgString(vectors[i]);
            await knex.raw(
                "UPDATE products SET embedding = ?::vector WHERE id = ?",
                [vecStr, products[i].id]
            );
        }

        processed += products.length;
        offset += BATCH_SIZE;

        if (processed % 500 === 0 || products.length < BATCH_SIZE) {
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            const rate = (processed / (Date.now() - start) * 1000).toFixed(1);
            console.log(`[reembed] ${processed}/${total.cnt} (${rate}/s, ${elapsed}s elapsed)`);
        }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[reembed] Done. ${processed} products in ${elapsed}s`);

    // Verify
    const nullCount = await knex("products").whereNull("embedding").count("id as cnt").first();
    console.log(`[reembed] Products still without embeddings: ${nullCount.cnt}`);

    await EmbeddingService.dispose();
    await knex.destroy();
})();
