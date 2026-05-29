const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

describe("Analytics API", () => {
    let app, server, baseUrl, knex;

    before(async () => {
        require("dotenv").config();
        const Knex = require("knex");
        const { Model } = require("objection");
        const knexConfig = require("../knexfile");
        knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
        Model.knex(knex);

        const { createApp } = require("../src/api/index");
        app = createApp();
        server = app.listen(0);
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    after(async () => {
        if (server) server.close();
        try { const c = require("../src/database/connection"); await c.destroy(); } catch {}
        await knex.destroy();
    });

    function fetch(path) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, baseUrl);
            http.get(url, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try {
                        resolve({ status: res.statusCode, body: JSON.parse(data) });
                    } catch {
                        resolve({ status: res.statusCode, body: data });
                    }
                });
            }).on("error", reject);
        });
    }

    it("GET /api/analytics/price-history returns points array", async () => {
        // Get a real product ID.
        const [product] = await knex("products").select("id").whereNotNull("price").limit(1);
        if (!product) return; // skip if no products
        const res = await fetch(`/api/analytics/price-history?product_id=${product.id}&days=30`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.body.points), "should have points array");
        assert.ok("current_price" in res.body, "should have current_price");
    });

    it("GET /api/analytics/price-history rejects non-numeric product_id", async () => {
        const res = await fetch("/api/analytics/price-history?product_id=abc");
        assert.equal(res.status, 400);
        assert.ok(res.body.error, "should have error message");
    });

    it("GET /api/analytics/deal-score returns score components", async () => {
        const [product] = await knex("products").select("id").whereNotNull("price").limit(1);
        if (!product) return;
        const res = await fetch(`/api/analytics/deal-score?product_id=${product.id}`);
        assert.equal(res.status, 200);
        assert.ok("deal_score" in res.body, "should have deal_score");
        assert.ok("components" in res.body, "should have components");
    });

    it("GET /api/analytics/deal-score rejects non-numeric product_id", async () => {
        const res = await fetch("/api/analytics/deal-score?product_id=;DROP");
        assert.equal(res.status, 400);
    });

    it("GET /api/analytics/provider-comparison returns items", async () => {
        const res = await fetch("/api/analytics/provider-comparison?product_title=milk");
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.body.items), "should have items array");
    });

    it("GET /api/analytics/provider-comparison rejects missing product_title", async () => {
        const res = await fetch("/api/analytics/provider-comparison");
        assert.equal(res.status, 400);
    });
});
