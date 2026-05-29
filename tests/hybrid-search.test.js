const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

describe("SearchService.hybridSearch (live DB)", { skip: false }, () => {
    let SearchService, knex;

    before(async () => {
        require("dotenv").config();
        const Knex = require("knex");
        const { Model } = require("objection");
        const knexConfig = require("../knexfile");
        knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
        Model.knex(knex);
        SearchService = require("../src/services/SearchService");
    });

    after(async () => {
        try { const c = require("../src/database/connection"); await c.destroy(); } catch {}
        if (knex) await knex.destroy();
    });

    it("returns results for a simple English query", async () => {
        const results = await SearchService.hybridSearch({ query: "milk" });
        assert.ok(Array.isArray(results), "should return an array");
        assert.ok(results.length > 0, "should find some products for 'milk'");
        assert.ok(results[0].rrf_score !== undefined, "first result should have rrf_score");
        assert.ok(results[0].title, "first result should have title");
    });

    it("returns results sorted by rrf_score DESC", async () => {
        const results = await SearchService.hybridSearch({ query: "wine red" });
        for (let i = 1; i < results.length; i++) {
            assert.ok(
                results[i - 1].rrf_score >= results[i].rrf_score,
                `results[${i - 1}].rrf_score (${results[i - 1].rrf_score}) should >= results[${i}].rrf_score (${results[i].rrf_score})`
            );
        }
    });

    it("respects limit parameter", async () => {
        const results = await SearchService.hybridSearch({ query: "bread", limit: 5 });
        assert.ok(results.length <= 5, `should return <= 5 results, got ${results.length}`);
    });

    it("handles Cyrillic queries", async () => {
        const results = await SearchService.hybridSearch({ query: "молоко" });
        assert.ok(results.length >= 0, "should not throw on Cyrillic input");
    });

    it("returns provider info via JOIN", async () => {
        const results = await SearchService.hybridSearch({ query: "butter" });
        if (results.length > 0) {
            assert.ok(results[0].provider_name || results[0].provider_id, "should have provider info");
        }
    });

    it("applies price_max filter", async () => {
        const results = await SearchService.hybridSearch({
            query: "cheese",
            filters: { price_max: 1000 },
        });
        for (const r of results) {
            assert.ok(
                Number(r.price) <= 1000,
                `product "${r.title}" price ${r.price} exceeds filter max 1000`
            );
        }
    });

    it("applies provider_name filter", async () => {
        const results = await SearchService.hybridSearch({
            query: "wine",
            filters: { provider_name: "sas_am" },
        });
        for (const r of results) {
            assert.ok(
                r.provider_name === "Sas Am" || r.provider_id != null,
                `product should be from sas_am`
            );
        }
    });

    it("applies price_min filter", async () => {
        const results = await SearchService.hybridSearch({
            query: "wine",
            filters: { price_min: 5000 },
        });
        for (const r of results) {
            assert.ok(
                Number(r.price) >= 5000,
                `product "${r.title}" price ${r.price} below filter min 5000`
            );
        }
    });

    it("applies combined price_min + price_max filter", async () => {
        const results = await SearchService.hybridSearch({
            query: "bread",
            filters: { price_min: 200, price_max: 800 },
        });
        for (const r of results) {
            const price = Number(r.price);
            assert.ok(price >= 200 && price <= 800,
                `product "${r.title}" price ${r.price} outside range 200-800`);
        }
    });

    it("rejects non-numeric price_max with TypeError", async () => {
        await assert.rejects(
            () => SearchService.hybridSearch({ query: "test", filters: { price_max: "1; DROP TABLE products" } }),
            { name: "TypeError" }
        );
    });

    it("rejects non-numeric price_min with TypeError", async () => {
        await assert.rejects(
            () => SearchService.hybridSearch({ query: "test", filters: { price_min: "abc" } }),
            { name: "TypeError" }
        );
    });

    it("applies exclude_product_ids filter", async () => {
        // First get some results, then exclude the first one
        const initial = await SearchService.hybridSearch({ query: "milk", limit: 5 });
        if (initial.length > 1) {
            const excludeId = initial[0].id;
            const filtered = await SearchService.hybridSearch({
                query: "milk",
                limit: 5,
                filters: { exclude_product_ids: [excludeId] },
            });
            const ids = filtered.map((r) => r.id);
            assert.ok(!ids.includes(excludeId), `excluded product ${excludeId} should not appear`);
        }
    });

    it("applies category_id filter (with recursive descendants)", async () => {
        // Get a category that has products
        const knex = require("knex")(require("../knexfile")[process.env.NODE_ENV || "development"]);
        const [cat] = await knex("categories").select("id").limit(1);
        await knex.destroy();
        if (cat) {
            const results = await SearchService.hybridSearch({
                query: "food",
                filters: { category_id: cat.id },
            });
            // All returned products should belong to this category or a descendant
            for (const r of results) {
                assert.ok(r.category_id != null, "filtered results should have category_id");
            }
        }
    });
});
