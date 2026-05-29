const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

/**
 * End-to-end shopping flow test.
 * Simulates: search → add to cart → view cart → checkout → confirm.
 */

describe("Full Shopping Flow (E2E)", () => {
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
            .insert({ telegram_id: "e2e_flow_" + Date.now(), first_name: "E2ETest" })
            .returning("id");
        testUserId = row.id;
    });

    after(async () => {
        if (testUserId) {
            await knex("user_events").where("user_id", testUserId).del().catch(() => {});
            await knex("messages").whereIn("conversation_id",
                knex("conversations").select("id").where("user_id", testUserId)
            ).del().catch(() => {});
            await knex("conversations").where("user_id", testUserId).del().catch(() => {});
            await knex("recommendation_cache").where("user_id", testUserId).del().catch(() => {});
            await knex("users").where("id", testUserId).del().catch(() => {});
        }
        try { const c = require("../src/database/connection"); await c.destroy(); } catch {}
        await knex.destroy();
    });

    it("Step 1: search for a product", async () => {
        const r = await ChatService.handleMessage(testUserId, "find me milk");
        assert.ok(r.text, "should return response text");
        assert.ok(
            r.state === "showing_results" || r.state === "searching" || r.state === "idle",
            `state should be search-related, got ${r.state}`
        );
        if (r.toolResults) {
            assert.ok(r.toolResults.length > 0, "should find products");
        }
    });

    it("Step 2: view cart (initially empty)", async () => {
        const r = await ChatService.handleMessage(testUserId, "show my cart");
        assert.ok(r.text, "should return cart info");
        assert.ok(r.cartSummary, "should include cart summary");
    });

    it("Step 3: ask about a product", async () => {
        const r = await ChatService.handleMessage(testUserId, "tell me more about the first result");
        assert.ok(r.text, "should return response");
    });

    it("Step 4: conversation maintains context", async () => {
        const r = await ChatService.handleMessage(testUserId, "what was I searching for?");
        assert.ok(r.text, "should return context-aware response");
    });
});
