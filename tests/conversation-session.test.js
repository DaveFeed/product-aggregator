const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

describe("ConversationSession (live DB)", () => {
    let knex, ConversationSession, testUserId;

    before(async () => {
        require("dotenv").config();
        const Knex = require("knex");
        const { Model } = require("objection");
        const knexConfig = require("../knexfile");
        knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
        Model.knex(knex);
        ConversationSession = require("../src/dialogue/ConversationSession");

        // Create a test user.
        const [row] = await knex("users")
            .insert({ telegram_id: "test_conv_" + Date.now(), first_name: "Test" })
            .returning("id");
        testUserId = row.id;
    });

    after(async () => {
        // Cleanup test data.
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

    it("creates a new conversation on first load", async () => {
        const session = await ConversationSession.load(testUserId);
        assert.ok(session.id, "should have a conversation id");
        assert.equal(session.state, "idle");
        assert.deepEqual(session.context.cart, undefined); // fresh context is {}
    });

    it("returns the same conversation on second load", async () => {
        const s1 = await ConversationSession.load(testUserId);
        const s2 = await ConversationSession.load(testUserId);
        assert.equal(s1.id, s2.id, "should reuse the same conversation");
    });

    it("persists state transitions via save()", async () => {
        const session = await ConversationSession.load(testUserId);
        session.transition("search_products");
        await session.save();

        const reloaded = await ConversationSession.load(testUserId);
        assert.equal(reloaded.state, "searching");
    });

    it("persists context merge via save()", async () => {
        const session = await ConversationSession.load(testUserId);
        session.mergeContext({ cart: [{ product_id: 1, title: "Milk", price: 500, quantity: 1 }] });
        await session.save();

        const reloaded = await ConversationSession.load(testUserId);
        assert.equal(reloaded.context.cart.length, 1);
        assert.equal(reloaded.context.cart[0].title, "Milk");
    });

    it("appendMessage round-trips through DB", async () => {
        const session = await ConversationSession.load(testUserId);
        await session.appendMessage({ role: "user", content: "hello" });
        await session.appendMessage({ role: "assistant", content: "hi there" });

        const reloaded = await ConversationSession.load(testUserId);
        const msgs = reloaded.messages;
        assert.ok(msgs.length >= 2, "should have at least 2 messages");
        const last = msgs[msgs.length - 1];
        assert.equal(last.role, "assistant");
        assert.equal(last.content, "hi there");
    });

    it("reset() goes to idle but keeps cart", async () => {
        const session = await ConversationSession.load(testUserId);
        // First reset to idle (prior tests left state as 'searching').
        session.reset();
        session.mergeContext({ cart: [{ product_id: 42 }], focusedProductId: 99 });
        session.transition("search_products"); // idle → searching
        session.reset();
        assert.equal(session.state, "idle");
        assert.equal(session.context.focusedProductId, null);
        assert.ok(session.context.cart.length > 0, "cart should survive reset");
    });
});
