const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/**
 * Bot adapter tests — unit tests for callback-to-intent mapping.
 * No Telegram API calls needed.
 */

describe("Bot Callback Mapping", () => {
    let parseCallback;

    it("parses add_to_cart callback", () => {
        parseCallback = require("../src/bot/callbacks").parseCallback;
        const result = parseCallback("cb:add:42");
        assert.equal(result.action, "add_to_cart");
        assert.equal(result.productId, 42);
    });

    it("parses product details callback", () => {
        const result = parseCallback("cb:details:123");
        assert.equal(result.action, "get_product_details");
        assert.equal(result.productId, 123);
    });

    it("parses price history callback", () => {
        const result = parseCallback("cb:hist:5");
        assert.equal(result.action, "get_price_history");
        assert.equal(result.productId, 5);
    });

    it("parses checkout callback", () => {
        const result = parseCallback("cb:checkout");
        assert.equal(result.action, "checkout");
    });

    it("parses clear cart callback", () => {
        const result = parseCallback("cb:clear");
        assert.equal(result.action, "clear_cart");
    });

    it("returns null for unknown callback", () => {
        const result = parseCallback("unknown");
        assert.equal(result, null);
    });
});
