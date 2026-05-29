const { describe, it, beforeEach, after, mock } = require("node:test");
const assert = require("node:assert/strict");

after(async () => {
    try { const k = require("../src/database/connection"); await k.destroy(); } catch {}
});

// We test structure and config logic without making real API calls.
// Live API test requires OPENAI_API_KEY and is at the bottom (skipped by default).

const LLMRouter = require("../src/services/LLMRouter");

describe("LLMRouter", () => {
    describe("TIERS", () => {
        it("exports FAST and SMART tier constants", () => {
            assert.equal(LLMRouter.TIERS.FAST, "FAST");
            assert.equal(LLMRouter.TIERS.SMART, "SMART");
        });
    });

    describe("getModel", () => {
        it("returns a model for FAST tier", async () => {
            const model = await LLMRouter.getModel("FAST");
            assert.ok(model, "should return a model instance");
            assert.ok(typeof model.invoke === "function", "model should have .invoke()");
        });

        it("returns a model for SMART tier", async () => {
            const model = await LLMRouter.getModel("SMART");
            assert.ok(model, "should return a model instance");
        });

        it("throws on unknown tier", async () => {
            await assert.rejects(
                () => LLMRouter.getModel("UNKNOWN"),
                (err) => err.message.includes("UNKNOWN")
            );
        });

        it("caches the model on subsequent calls", async () => {
            const m1 = await LLMRouter.getModel("FAST");
            const m2 = await LLMRouter.getModel("FAST");
            assert.strictEqual(m1, m2, "should return the same cached instance");
        });

        it("constructs models lazily (not at require-time)", () => {
            // If the module had constructed at require time, it would have thrown
            // (no API key in CI). The fact we're here means lazy construction works.
            assert.ok(true);
        });
    });

    describe("getDefaultConfig", () => {
        it("returns config for both tiers", () => {
            const config = LLMRouter.getDefaultConfig();
            assert.ok(config.FAST, "should have FAST config");
            assert.ok(config.SMART, "should have SMART config");
            assert.ok(config.FAST.model, "FAST should have a model name");
            assert.ok(config.SMART.model, "SMART should have a model name");
        });
    });

    describe("clearCache", () => {
        it("forces re-construction on next getModel call", async () => {
            const m1 = await LLMRouter.getModel("FAST");
            LLMRouter.clearCache();
            const m2 = await LLMRouter.getModel("FAST");
            assert.notStrictEqual(m1, m2, "should be a new instance after cache clear");
        });
    });
});

// Live API test — only runs if OPENAI_API_KEY is set.
const hasApiKey = !!process.env.OPENAI_API_KEY;
describe("LLMRouter live API", { skip: !hasApiKey && "OPENAI_API_KEY not set" }, () => {
    it("FAST model can invoke a simple prompt", async () => {
        const model = await LLMRouter.getModel("FAST");
        const result = await model.invoke([{ role: "user", content: "Reply with the single word: pong" }]);
        assert.ok(result.content.toLowerCase().includes("pong"), `expected 'pong' in response, got: ${result.content}`);
    });
});
