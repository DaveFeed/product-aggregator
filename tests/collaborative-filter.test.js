const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

describe("CollaborativeFilter", () => {
    let knex, CF, testUserIds;

    before(async () => {
        require("dotenv").config();
        const Knex = require("knex");
        const { Model } = require("objection");
        const knexConfig = require("../knexfile");
        knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
        Model.knex(knex);
        CF = require("../src/services/CollaborativeFilter");

        // Create test users and insert test events.
        testUserIds = [];
        for (let i = 0; i < 3; i++) {
            const [row] = await knex("users")
                .insert({ telegram_id: `cf_test_${Date.now()}_${i}`, first_name: `CFTest${i}` })
                .returning("id");
            testUserIds.push(row.id);
        }

        // Get some real product IDs.
        const products = await knex("products").select("id").whereNotNull("price").limit(5);
        if (products.length >= 3) {
            // User 0 views products 0,1,2
            for (const p of products.slice(0, 3)) {
                await knex("user_events").insert({
                    user_id: testUserIds[0], event_type: "view", product_id: p.id,
                });
            }
            // User 1 views products 0,1 (co-occurrence with user 0)
            for (const p of products.slice(0, 2)) {
                await knex("user_events").insert({
                    user_id: testUserIds[1], event_type: "view", product_id: p.id,
                });
            }
            // User 2 views products 1,2,3,4
            for (const p of products.slice(1, 5)) {
                await knex("user_events").insert({
                    user_id: testUserIds[2], event_type: "add_to_cart", product_id: p.id,
                });
            }
        }
    });

    after(async () => {
        for (const uid of testUserIds) {
            await knex("user_events").where("user_id", uid).del();
            await knex("users").where("id", uid).del();
        }
        await knex("item_similarity").del(); // clean test similarity data
        // Also destroy the singleton connection from database/connection module.
        try { const c = require("../src/database/connection"); await c.destroy(); } catch {}
        await knex.destroy();
    });

    it("buildItemSimilarityMatrix runs without error", async () => {
        const count = await CF.buildItemSimilarityMatrix();
        assert.ok(typeof count === "number", "should return row count");
    });

    it("item_similarity table has rows after build", async () => {
        const rows = await knex("item_similarity").limit(5);
        assert.ok(rows.length > 0, "should have similarity rows");
        assert.ok(rows[0].score > 0, "score should be positive");
        assert.ok(rows[0].score <= 1, "score should be <= 1");
    });

    it("getCandidates returns array for user with events", async () => {
        const candidates = await CF.getCandidates({ userId: testUserIds[0], limit: 10 });
        assert.ok(Array.isArray(candidates), "should return array");
        // May or may not have results depending on data
    });

    it("getCandidates returns empty array for user with no events", async () => {
        // Use a user ID that has no events.
        const [row] = await knex("users")
            .insert({ telegram_id: `cf_empty_${Date.now()}`, first_name: "NoEvents" })
            .returning("id");
        const candidates = await CF.getCandidates({ userId: row.id, limit: 10 });
        assert.ok(Array.isArray(candidates));
        assert.equal(candidates.length, 0, "new user should get no candidates");
        await knex("users").where("id", row.id).del();
    });
});
