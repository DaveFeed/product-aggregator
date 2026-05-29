#!/usr/bin/env node

/**
 * Build item similarity matrix from user_events.
 * Usage: node cmd/build_item_similarity.js
 */

require("dotenv").config();
const Knex = require("knex");
const { Model } = require("objection");
const knexConfig = require("../knexfile");
const knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
Model.knex(knex);

const CF = require("../src/services/CollaborativeFilter");

(async () => {
    try {
        console.log("[build_item_similarity] Starting...");
        const count = await CF.buildItemSimilarityMatrix();
        console.log(`[build_item_similarity] Done. ${count} similarity pairs written.`);
    } catch (err) {
        console.error("[build_item_similarity] Error:", err);
        process.exit(1);
    } finally {
        await knex.destroy();
    }
})();
