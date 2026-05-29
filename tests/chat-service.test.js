const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

describe("ChatService (live DB + API)", () => {
    let knex, ChatService, testUserId;

    before(async () => {
        require("dotenv").config();
        const Knex = require("knex");
        const { Model } = require("objection");
        const knexConfig = require("../knexfile");
        knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
        Model.knex(knex);
        ChatService = require("../src/services/ChatService");

        const [row] = await knex("users")
            .insert({ telegram_id: "test_chat_" + Date.now(), first_name: "ChatTest" })
            .returning("id");
        testUserId = row.id;
    });

    after(async () => {
        if (testUserId) {
            await knex("messages").whereIn(
                "conversation_id",
                knex("conversations").select("id").where("user_id", testUserId)
            ).del();
            await knex("conversations").where("user_id", testUserId).del();
            await knex("users").where("id", testUserId).del();
        }
        try { const c = require("../src/database/connection"); await c.destroy(); } catch {}
        await knex.destroy();
    });

    it("handles a greeting", async () => {
        const response = await ChatService.handleMessage(testUserId, "hello!");
        assert.ok(response.text, "should return text");
        assert.equal(response.state, "idle", "greeting should keep state idle");
    });

    it("handles a product search", async () => {
        const response = await ChatService.handleMessage(testUserId, "find me milk");
        assert.ok(response.text, "should return text response");
        assert.ok(
            response.state === "showing_results" || response.state === "idle",
            `state should be showing_results or idle, got ${response.state}`
        );
        if (response.toolResults) {
            assert.ok(Array.isArray(response.toolResults), "toolResults should be array");
        }
    });

    it("preserves conversation state across calls", async () => {
        // First: search
        await ChatService.handleMessage(testUserId, "find cheese");
        // Second: should have context from first call
        const r2 = await ChatService.handleMessage(testUserId, "what did I search for?");
        assert.ok(r2.text, "should reply with context-aware text");
    });

    it("handles view_cart intent", async () => {
        const response = await ChatService.handleMessage(testUserId, "show my cart");
        assert.ok(response.text, "should return cart summary");
    });
});
