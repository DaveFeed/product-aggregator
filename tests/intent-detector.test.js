const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");

after(async () => {
    try { const k = require("../src/database/connection"); await k.destroy(); } catch {}
});

const IntentDetector = require("../src/services/IntentDetector");

describe("IntentDetector", () => {
    describe("IntentSchema", () => {
        it("exports the Zod schema", () => {
            assert.ok(IntentDetector.IntentSchema, "should export IntentSchema");
            assert.ok(typeof IntentDetector.IntentSchema.parse === "function", "schema should have .parse()");
        });

        it("validates a well-formed intent", () => {
            const valid = {
                intent: "product_search",
                confidence: 0.95,
                search_query: "milk",
                slots: { price_max: 500, price_min: null, category: null, brand: null, quantity: 1, product_id: null },
            };
            const parsed = IntentDetector.IntentSchema.parse(valid);
            assert.equal(parsed.intent, "product_search");
            assert.equal(parsed.confidence, 0.95);
            assert.equal(parsed.search_query, "milk");
            assert.equal(parsed.slots.price_max, 500);
        });

        it("rejects an unknown intent", () => {
            assert.throws(() =>
                IntentDetector.IntentSchema.parse({
                    intent: "fly_to_moon",
                    confidence: 0.5,
                    search_query: null,
                    slots: { price_max: null, price_min: null, category: null, brand: null, quantity: null, product_id: null },
                })
            );
        });

        it("rejects confidence outside [0, 1]", () => {
            assert.throws(() =>
                IntentDetector.IntentSchema.parse({
                    intent: "greet",
                    confidence: 1.5,
                    search_query: null,
                    slots: { price_max: null, price_min: null, category: null, brand: null, quantity: null, product_id: null },
                })
            );
        });

        it("allows null search_query", () => {
            const parsed = IntentDetector.IntentSchema.parse({
                intent: "greet",
                confidence: 0.9,
                search_query: null,
                slots: { price_max: null, price_min: null, category: null, brand: null, quantity: null, product_id: null },
            });
            assert.equal(parsed.search_query, null);
        });

        it("slots with null values parse correctly", () => {
            const parsed = IntentDetector.IntentSchema.parse({
                intent: "product_search",
                confidence: 0.8,
                search_query: "wine",
                slots: { price_max: 2000, price_min: null, category: null, brand: null, quantity: null, product_id: null },
            });
            assert.equal(parsed.slots.price_max, 2000);
            assert.equal(parsed.slots.brand, null);
        });
    });

    describe("mapIntentToEvent", () => {
        it("maps product_search to search_products", () => {
            assert.equal(IntentDetector.mapIntentToEvent("product_search"), "search_products");
        });

        it("maps add_to_cart to add_to_cart", () => {
            assert.equal(IntentDetector.mapIntentToEvent("add_to_cart"), "add_to_cart");
        });

        it("maps checkout to initiate_checkout", () => {
            assert.equal(IntentDetector.mapIntentToEvent("checkout"), "initiate_checkout");
        });

        it("returns null for greet (no FSM event)", () => {
            assert.equal(IntentDetector.mapIntentToEvent("greet"), null);
        });

        it("returns null for help", () => {
            assert.equal(IntentDetector.mapIntentToEvent("help"), null);
        });
    });
});

// Live API test — only runs if OPENAI_API_KEY is set.
const hasApiKey = !!process.env.OPENAI_API_KEY;
describe("IntentDetector live API", { skip: !hasApiKey && "OPENAI_API_KEY not set" }, () => {
    it("detects a product search intent", async () => {
        const result = await IntentDetector.detectIntent("find me cheap red wine under 2000 drams");
        assert.equal(result.intent, "product_search");
        assert.ok(result.confidence > 0.5, `confidence should be > 0.5, got ${result.confidence}`);
        assert.ok(result.search_query, "search_query should be populated");
        assert.ok(result.tier_used, "tier_used should be populated");
    });

    it("detects a greeting", async () => {
        const result = await IntentDetector.detectIntent("hello!");
        assert.equal(result.intent, "greet");
    });
});
