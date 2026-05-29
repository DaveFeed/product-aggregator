const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

describe("SSE Chat Endpoint", () => {
    let app, server, baseUrl, knex, token, testUserId;

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

        // Create test user and JWT.
        const [row] = await knex("users")
            .insert({ telegram_id: `sse_test_${Date.now()}`, first_name: "SSETest" })
            .returning("id");
        testUserId = row.id;
        const { signToken } = require("../src/api/middleware/auth");
        token = signToken(testUserId);
    });

    after(async () => {
        if (testUserId) {
            await knex("messages").whereIn("conversation_id",
                knex("conversations").select("id").where("user_id", testUserId)
            ).del().catch(() => {});
            await knex("conversations").where("user_id", testUserId).del().catch(() => {});
            await knex("users").where("id", testUserId).del().catch(() => {});
        }
        if (server) server.close();
        try { const c = require("../src/database/connection"); await c.destroy(); } catch {}
        await knex.destroy();
    });

    function postSSE(path, body, headers = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, baseUrl);
            const req = http.request(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...headers },
            }, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
            });
            req.on("error", reject);
            req.write(JSON.stringify(body));
            req.end();
        });
    }

    it("returns 401 without auth token", async () => {
        const res = await postSSE("/api/chat/message", { text: "hello" });
        assert.equal(res.status, 401);
    });

    it("returns 400 without text", async () => {
        const res = await postSSE("/api/chat/message", {}, {
            Authorization: `Bearer ${token}`,
        });
        assert.equal(res.status, 400);
    });

    it("streams SSE events with valid auth", async () => {
        const res = await postSSE("/api/chat/message", { text: "hello" }, {
            Authorization: `Bearer ${token}`,
        });
        assert.equal(res.headers["content-type"], "text/event-stream");
        assert.ok(res.body.includes("event: token"), "should have token event");
        assert.ok(res.body.includes("event: done"), "should have done event");
    });

    it("done event includes state and cart_summary", async () => {
        const res = await postSSE("/api/chat/message", { text: "hi there" }, {
            Authorization: `Bearer ${token}`,
        });
        // Parse done event data.
        const doneMatch = res.body.match(/event: done\ndata: (.+)\n/);
        assert.ok(doneMatch, "should have done event");
        const doneData = JSON.parse(doneMatch[1]);
        assert.ok("state" in doneData, "done should have state");
        assert.ok("cart_summary" in doneData, "done should have cart_summary");
    });
});
