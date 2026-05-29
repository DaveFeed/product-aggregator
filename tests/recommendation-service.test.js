const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

describe("RecommendationService", () => {
    let knex, RecommendationService, testUserId;

    before(async () => {
        require("dotenv").config();
        const Knex = require("knex");
        const { Model } = require("objection");
        const knexConfig = require("../knexfile");
        knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
        Model.knex(knex);
        RecommendationService = require("../src/services/RecommendationService");

        const [row] = await knex("users")
            .insert({ telegram_id: `rec_test_${Date.now()}`, first_name: "RecTest" })
            .returning("id");
        testUserId = row.id;
    });

    after(async () => {
        if (testUserId) {
            await knex("recommendation_cache").where("user_id", testUserId).del();
            await knex("user_events").where("user_id", testUserId).del();
            await knex("users").where("id", testUserId).del();
        }
        try { const c = require("../src/database/connection"); await c.destroy(); } catch {}
        await knex.destroy();
    });

    it("generateFor returns items array", async () => {
        const result = await RecommendationService.generateFor(testUserId);
        assert.ok(result, "should return a result");
        assert.ok(Array.isArray(result.items), "should have items array");
        assert.ok(result.items.length <= 10, "max 10 items");
    });

    it("caches results — second call returns cached", async () => {
        const first = await RecommendationService.generateFor(testUserId);
        const second = await RecommendationService.generateFor(testUserId);
        assert.equal(second.cached, true, "second call should be from cache");
        assert.deepEqual(first.items, second.items, "cached result should match");
    });

    it("each item has product_id and reason", async () => {
        const result = await RecommendationService.generateFor(testUserId);
        for (const item of result.items) {
            assert.ok(typeof item.product_id === "number", "should have product_id");
            assert.ok(typeof item.reason === "string", "should have reason");
        }
    });
});
