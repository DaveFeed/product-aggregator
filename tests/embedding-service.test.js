const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");

/**
 * EmbeddingService tests.
 * Tests the interface and vector properties without requiring bge-m3 model download.
 * Uses the current MiniLM model for structural tests.
 */

after(async () => {
    try { const k = require("../src/database/connection"); await k.destroy(); } catch {}
});

describe("EmbeddingService", () => {
    let EmbeddingService;

    it("loads without error", async () => {
        EmbeddingService = require("../src/services/EmbeddingService");
        assert.ok(EmbeddingService, "module should export");
        assert.ok(typeof EmbeddingService.embedQuery === "function");
        assert.ok(typeof EmbeddingService.embedPassage === "function");
        assert.ok(typeof EmbeddingService.embedBatch === "function");
        assert.ok(typeof EmbeddingService.vectorToPgString === "function");
    });

    it("embedQuery returns a vector of correct dimension (1024 for bge-m3)", async () => {
        const vec = await EmbeddingService.embedQuery("test query");
        assert.ok(vec instanceof Float32Array || Array.isArray(vec), "should return array-like");
        assert.equal(vec.length, EmbeddingService.getDims(),
            `should return ${EmbeddingService.getDims()}-dim vector, got ${vec.length}`);
    });

    it("embedPassage returns same dimension as embedQuery", async () => {
        const q = await EmbeddingService.embedQuery("milk");
        const p = await EmbeddingService.embedPassage("milk 3.2% 1L");
        assert.equal(q.length, p.length, "query and passage should have same dimension");
    });

    it("vectors are approximately unit norm", async () => {
        const vec = await EmbeddingService.embedQuery("cheese");
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
        assert.ok(Math.abs(norm - 1.0) < 0.05, `norm should be ~1.0, got ${norm}`);
    });

    it("similar texts produce similar vectors", async () => {
        const v1 = await EmbeddingService.embedQuery("молоко 3.2%");
        const v2 = await EmbeddingService.embedQuery("молоко 2.5%");
        const v3 = await EmbeddingService.embedQuery("компьютер ноутбук");

        const cosine = (a, b) => {
            let dot = 0, na = 0, nb = 0;
            for (let i = 0; i < a.length; i++) {
                dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
            }
            return dot / (Math.sqrt(na) * Math.sqrt(nb));
        };

        const simSimilar = cosine(v1, v2);
        const simDifferent = cosine(v1, v3);
        assert.ok(simSimilar > simDifferent,
            `similar texts (${simSimilar.toFixed(3)}) should have higher cosine than different (${simDifferent.toFixed(3)})`);
    });

    it("vectorToPgString formats correctly", async () => {
        const vec = new Float32Array([0.1, 0.2, 0.3]);
        const str = EmbeddingService.vectorToPgString(vec);
        assert.ok(str.startsWith("["), "should start with [");
        assert.ok(str.endsWith("]"), "should end with ]");
        assert.ok(str.includes("0.1"), "should contain values");
    });

    it("embedBatch processes multiple texts", async () => {
        const results = await EmbeddingService.embedBatch(["milk", "bread", "cheese"]);
        assert.equal(results.length, 3, "should return 3 vectors");
        for (const vec of results) {
            assert.ok(vec.length > 0, "each vector should have content");
        }
    });
});
