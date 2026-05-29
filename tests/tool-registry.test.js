const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");

after(async () => {
    try { const k = require("../src/database/connection"); await k.destroy(); } catch {}
});

/**
 * Tool registry tests — pure unit tests using a fake session.
 * No DB, no LLM calls.
 */

function makeSession(state = "idle", cart = []) {
    const session = {
        state,
        context: { cart: [...cart] },
        userId: 999,
        _dirty: false,
        mergeContext(patch) {
            Object.assign(this.context, patch);
            this._dirty = true;
        },
        transition(event) {
            // Minimal FSM stub — just update state for tests that need it.
            const { transition: fsmTransition } = require("../src/dialogue/FSM");
            this.state = fsmTransition(this.state, event);
            this._dirty = true;
            return this.state;
        },
    };
    return session;
}

describe("Tool Registry (buildTools)", () => {
    let buildTools;

    beforeEach(() => {
        // Re-require to reset any module-level caches.
        delete require.cache[require.resolve("../src/dialogue/tools/index")];
        buildTools = require("../src/dialogue/tools/index").buildTools;
    });

    it("returns an object keyed by tool name", () => {
        const session = makeSession();
        const tools = buildTools(session);
        assert.ok(typeof tools === "object", "should return an object");
        assert.ok("search_products" in tools, "should have search_products");
        assert.ok("add_to_cart" in tools, "should have add_to_cart");
        assert.ok("remove_from_cart" in tools, "should have remove_from_cart");
        assert.ok("view_cart" in tools, "should have view_cart");
        assert.ok("get_product_details" in tools, "should have get_product_details");
        assert.ok("get_price_history" in tools, "should have get_price_history");
        assert.ok("initiate_checkout" in tools, "should have initiate_checkout");
        assert.ok("confirm_checkout" in tools, "should have confirm_checkout");
    });

    it("each tool has name, description, and schema", () => {
        const session = makeSession();
        const tools = buildTools(session);
        for (const [name, tool] of Object.entries(tools)) {
            assert.ok(tool.name === name, `tool.name should be ${name}`);
            assert.ok(typeof tool.description === "string" && tool.description.length > 0,
                `${name} should have a description`);
            assert.ok(tool.schema, `${name} should have a schema`);
        }
    });

    it("view_cart works from idle state", async () => {
        const session = makeSession("idle", [
            { product_id: 1, title: "Milk", price: 500, provider_name: "SAS", quantity: 2 },
        ]);
        const tools = buildTools(session);
        const result = await tools.view_cart.invoke({});
        const parsed = JSON.parse(result);
        assert.equal(parsed.items.length, 1);
        assert.equal(parsed.total, 1000);
    });

    it("add_to_cart works from showing_results state", async () => {
        const session = makeSession("showing_results", []);
        const tools = buildTools(session);
        // add_to_cart requires a real product lookup — so we test the FSM guard part.
        // With a fake product_id that doesn't exist, it should return ok:false.
        const result = await tools.add_to_cart.invoke({ product_id: 999999 });
        const parsed = JSON.parse(result);
        assert.equal(parsed.ok, false, "non-existent product should fail gracefully");
    });

    it("confirm_checkout returns error when called from idle state", async () => {
        const session = makeSession("idle");
        const tools = buildTools(session);
        const result = await tools.confirm_checkout.invoke({ confirm: true });
        const parsed = JSON.parse(result);
        assert.equal(parsed.ok, false);
        assert.ok(parsed.error.includes("not available"), `should mention tool not available, got: ${parsed.error}`);
    });

    it("initiate_checkout returns error when called from idle state", async () => {
        const session = makeSession("idle");
        const tools = buildTools(session);
        const result = await tools.initiate_checkout.invoke({});
        const parsed = JSON.parse(result);
        assert.equal(parsed.ok, false);
        assert.ok(parsed.error.includes("not available"), `should mention tool not available`);
    });

    it("view_cart returns cart summary with correct total", async () => {
        const session = makeSession("idle", [
            { product_id: 1, title: "Bread", price: 300, provider_name: "SAS", quantity: 1 },
            { product_id: 2, title: "Butter", price: 800, provider_name: "Parma", quantity: 2 },
        ]);
        const tools = buildTools(session);
        const result = await tools.view_cart.invoke({});
        const parsed = JSON.parse(result);
        assert.equal(parsed.items.length, 2);
        assert.equal(parsed.total, 1900); // 300 + 800*2
    });

    it("remove_from_cart works from cart_review state", async () => {
        const session = makeSession("cart_review", [
            { product_id: 42, title: "Wine", price: 5000, provider_name: "SAS", quantity: 1 },
        ]);
        const tools = buildTools(session);
        const result = await tools.remove_from_cart.invoke({ product_id: 42 });
        const parsed = JSON.parse(result);
        assert.equal(parsed.ok, true);
        assert.equal(session.context.cart.length, 0);
    });

    it("remove_from_cart blocked from idle state", async () => {
        const session = makeSession("idle", [
            { product_id: 42, title: "Wine", price: 5000, provider_name: "SAS", quantity: 1 },
        ]);
        const tools = buildTools(session);
        const result = await tools.remove_from_cart.invoke({ product_id: 42 });
        const parsed = JSON.parse(result);
        assert.equal(parsed.ok, false);
        assert.ok(parsed.error.includes("not available"));
    });

    it("tools return as LangChain-compatible array", () => {
        const session = makeSession();
        const { buildToolsArray } = require("../src/dialogue/tools/index");
        const arr = buildToolsArray(session);
        assert.ok(Array.isArray(arr));
        assert.ok(arr.length > 0);
        // Each should be a DynamicStructuredTool instance
        for (const tool of arr) {
            assert.ok(typeof tool.invoke === "function", "each tool should have invoke()");
        }
    });
});
