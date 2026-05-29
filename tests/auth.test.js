const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

describe("JWT Auth + Link Code", () => {
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
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        await knex("auth_link_codes").del();
        server.close();
        try { const c = require("../src/database/connection"); await c.destroy(); } catch {}
        await knex.destroy();
    });

    function fetch(path, opts = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, baseUrl);
            const req = http.request(url, {
                method: opts.method || "GET",
                headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
            }, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                    catch { resolve({ status: res.statusCode, body: data }); }
                });
            });
            req.on("error", reject);
            if (opts.body) req.write(JSON.stringify(opts.body));
            req.end();
        });
    }

    it("POST /api/auth/link-code/start returns a 6-char code", async () => {
        const res = await fetch("/api/auth/link-code/start", { method: "POST" });
        assert.equal(res.status, 200);
        assert.equal(res.body.code.length, 6);
        assert.equal(res.body.expires_in, 600);
    });

    it("POST /api/auth/link-code/poll returns pending:true for unconsumed code", async () => {
        const start = await fetch("/api/auth/link-code/start", { method: "POST" });
        const res = await fetch("/api/auth/link-code/poll", {
            method: "POST",
            body: { code: start.body.code },
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.pending, true);
    });

    it("POST /api/auth/link-code/poll returns token after code is consumed", async () => {
        // Create a code.
        const start = await fetch("/api/auth/link-code/start", { method: "POST" });
        const code = start.body.code;

        // Simulate bot consuming the code.
        const [user] = await knex("users")
            .insert({ telegram_id: `auth_test_${Date.now()}`, first_name: "AuthTest" })
            .returning("id");
        await knex("auth_link_codes").where("code", code).update({
            user_id: user.id,
            consumed_at: new Date().toISOString(),
        });

        // Poll should return token.
        const res = await fetch("/api/auth/link-code/poll", {
            method: "POST",
            body: { code },
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.pending, false);
        assert.ok(res.body.token, "should return JWT token");

        // Verify the JWT works.
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET || "dev-secret-change-in-production");
        assert.equal(decoded.sub, user.id);

        // Cleanup.
        await knex("users").where("id", user.id).del();
    });

    it("auth middleware rejects invalid token", async () => {
        // Use a protected endpoint (e.g., chat would need auth — but let's just test the middleware directly).
        const { authRequired } = require("../src/api/middleware/auth");
        let resStatus, resBody;
        const fakeReq = { headers: { authorization: "Bearer invalid.token.here" } };
        const fakeRes = {
            status(s) { resStatus = s; return this; },
            json(b) { resBody = b; },
        };
        authRequired(fakeReq, fakeRes, () => {});
        assert.equal(resStatus, 401);
        assert.ok(resBody.error.includes("Invalid"));
    });

    it("auth middleware passes with valid token", async () => {
        const { signToken, authRequired } = require("../src/api/middleware/auth");
        const token = signToken(42);
        let nextCalled = false;
        const fakeReq = { headers: { authorization: `Bearer ${token}` } };
        const fakeRes = {};
        authRequired(fakeReq, fakeRes, () => { nextCalled = true; });
        assert.ok(nextCalled, "next() should be called");
        assert.equal(fakeReq.user.id, 42);
    });
});
