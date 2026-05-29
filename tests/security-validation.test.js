const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

/**
 * Security validation tests — input sanitization, injection prevention.
 */

describe("Security Validation", () => {
    let SearchService, app, server, baseUrl, knex;

    before(async () => {
        require("dotenv").config();
        const Knex = require("knex");
        const { Model } = require("objection");
        const knexConfig = require("../knexfile");
        knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
        Model.knex(knex);
        SearchService = require("../src/services/SearchService");

        const { createApp } = require("../src/api/index");
        app = createApp();
        server = app.listen(0);
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        if (server) server.close();
        try { const c = require("../src/database/connection"); await c.destroy(); } catch {}
        await knex.destroy();
    });

    function fetch(path) {
        return new Promise((resolve, reject) => {
            http.get(new URL(path, baseUrl), (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                    catch { resolve({ status: res.statusCode, body: data }); }
                });
            }).on("error", reject);
        });
    }

    describe("SQL Injection Prevention", () => {
        it("price_max rejects string SQL injection", async () => {
            await assert.rejects(
                () => SearchService.hybridSearch({
                    query: "test",
                    filters: { price_max: "1; DROP TABLE products" },
                }),
                { name: "TypeError" }
            );
        });

        it("price_min rejects string SQL injection", async () => {
            await assert.rejects(
                () => SearchService.hybridSearch({
                    query: "test",
                    filters: { price_min: "'; DELETE FROM products; --" },
                }),
                { name: "TypeError" }
            );
        });

        it("product_id rejects non-numeric via API", async () => {
            const r = await fetch("/api/analytics/price-history?product_id=1%3BDROP%20TABLE%20products");
            assert.equal(r.status, 400);
        });

        it("deal-score rejects non-numeric via API", async () => {
            const r = await fetch("/api/analytics/deal-score?product_id=abc");
            assert.equal(r.status, 400);
        });
    });

    describe("Auth Security", () => {
        it("protected endpoint rejects missing Authorization", async () => {
            const r = await new Promise((resolve, reject) => {
                const req = http.request(new URL("/api/chat/message", baseUrl), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                }, (res) => {
                    let data = "";
                    res.on("data", (c) => (data += c));
                    res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
                });
                req.on("error", reject);
                req.write(JSON.stringify({ text: "hello" }));
                req.end();
            });
            assert.equal(r.status, 401);
        });

        it("protected endpoint rejects malformed JWT", async () => {
            const r = await new Promise((resolve, reject) => {
                const req = http.request(new URL("/api/chat/message", baseUrl), {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer not.a.valid.jwt.token",
                    },
                }, (res) => {
                    let data = "";
                    res.on("data", (c) => (data += c));
                    res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
                });
                req.on("error", reject);
                req.write(JSON.stringify({ text: "hello" }));
                req.end();
            });
            assert.equal(r.status, 401);
        });
    });

    describe("Input Sanitization", () => {
        it("empty search query handled gracefully", async () => {
            const results = await SearchService.hybridSearch({ query: "" });
            assert.ok(Array.isArray(results), "should return array even for empty query");
        });

        it("very long query handled without crash", async () => {
            const longQuery = "a".repeat(5000);
            const results = await SearchService.hybridSearch({ query: longQuery, limit: 5 });
            assert.ok(Array.isArray(results), "should return array for long query");
        });

        it("special characters in query don't crash", async () => {
            const results = await SearchService.hybridSearch({
                query: "test'; DROP TABLE products; --",
                limit: 5,
            });
            assert.ok(Array.isArray(results), "should handle SQL-like characters");
        });

        it("provider_comparison rejects empty title", async () => {
            const r = await fetch("/api/analytics/provider-comparison?product_title=");
            assert.equal(r.status, 400);
        });
    });
});
