const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

describe("Express API Bootstrap", () => {
    let app, server, baseUrl;

    before(async () => {
        require("dotenv").config();
        const { createApp } = require("../src/api/index");
        app = createApp();
        // Start on a random port for testing.
        server = app.listen(0);
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    after(async () => {
        if (server) server.close();
        try { const c = require("../src/database/connection"); await c.destroy(); } catch {}
    });

    function fetch(path, opts = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, baseUrl);
            const req = http.request(url, {
                method: opts.method || "GET",
                headers: opts.headers || {},
            }, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try {
                        resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
                    } catch {
                        resolve({ status: res.statusCode, headers: res.headers, body: data });
                    }
                });
            });
            req.on("error", reject);
            if (opts.body) req.write(JSON.stringify(opts.body));
            req.end();
        });
    }

    it("GET /api/health returns ok:true", async () => {
        const res = await fetch("/api/health");
        assert.equal(res.status, 200);
        assert.equal(res.body.ok, true);
        assert.ok(res.body.version, "should include version");
    });

    it("sets security headers via helmet", async () => {
        const res = await fetch("/api/health");
        // Helmet sets various security headers.
        assert.ok(res.headers["x-content-type-options"], "should have x-content-type-options");
    });

    it("returns 404 JSON for unknown routes", async () => {
        const res = await fetch("/api/nonexistent");
        assert.equal(res.status, 404);
        assert.ok(res.body.error, "should return error field");
    });

    it("accepts JSON body", async () => {
        // Just verify the JSON middleware doesn't crash on a POST.
        const res = await fetch("/api/health", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: { test: true },
        });
        // Health endpoint likely returns 404 for POST or 200 — either is fine.
        assert.ok(res.status < 500, "should not crash on JSON body");
    });

    it("CORS header is present", async () => {
        const res = await fetch("/api/health", {
            headers: { Origin: "http://localhost:5173" },
        });
        // cors() should add access-control-allow-origin.
        assert.ok(
            res.headers["access-control-allow-origin"],
            "should have CORS header"
        );
    });
});
