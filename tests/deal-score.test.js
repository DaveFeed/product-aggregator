const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const DealScoreService = require("../src/services/DealScoreService");

// Helper: create mock price-history-daily rows.
function makeHistory(avgPrices) {
    const now = new Date();
    return avgPrices.map((avg, i) => ({
        day: new Date(now.getTime() - (avgPrices.length - 1 - i) * 86400000).toISOString().slice(0, 10),
        avg_price: avg,
        min_price: avg * 0.95,
        max_price: avg * 1.05,
        sample_count: 1,
    }));
}

describe("DealScoreService.computeFromData", () => {
    it("returns insufficient_data when < 3 days", () => {
        const result = DealScoreService.computeFromData(100, makeHistory([100, 100]));
        assert.equal(result.dealScore, null);
        assert.equal(result.insufficient_data, true);
    });

    it("returns dealScore in [0, 1] for valid data", () => {
        const history = makeHistory([100, 110, 105, 115, 108, 112, 107]);
        const result = DealScoreService.computeFromData(107, history);
        assert.ok(result.dealScore >= 0 && result.dealScore <= 1, `dealScore ${result.dealScore} not in [0,1]`);
        assert.ok(result.components);
        assert.equal(result.insufficient_data, false);
    });

    it("product at historical minimum → dealScore close to 1.0", () => {
        const history = makeHistory([200, 180, 190, 195, 185, 170, 160]);
        const currentPrice = 160; // at the min
        const result = DealScoreService.computeFromData(currentPrice, history);
        assert.ok(result.dealScore > 0.7, `expected > 0.7 at min, got ${result.dealScore}`);
    });

    it("product at historical maximum → dealScore close to 0.0", () => {
        const history = makeHistory([100, 110, 105, 115, 108, 112, 120]);
        const currentPrice = 120; // at the max
        const result = DealScoreService.computeFromData(currentPrice, history);
        assert.ok(result.dealScore < 0.35, `expected < 0.35 at max, got ${result.dealScore}`);
    });

    it("falling prices → higher momentum component", () => {
        const falling = makeHistory([200, 190, 180, 170, 160, 150, 140]);
        const stable = makeHistory([170, 170, 170, 170, 170, 170, 170]);

        const fallingResult = DealScoreService.computeFromData(140, falling);
        const stableResult = DealScoreService.computeFromData(170, stable);
        assert.ok(
            fallingResult.components.momentum > stableResult.components.momentum,
            `falling momentum ${fallingResult.components.momentum} should > stable ${stableResult.components.momentum}`
        );
    });

    it("handles zero price range (all same price)", () => {
        const history = makeHistory([100, 100, 100, 100]);
        const result = DealScoreService.computeFromData(100, history);
        assert.ok(result.dealScore !== null);
        // hist component should be 0.5 (midpoint fallback) when min===max
        assert.ok(result.dealScore >= 0 && result.dealScore <= 1);
    });

    it("returns sampleCount matching history length", () => {
        const history = makeHistory([100, 110, 120, 130, 140]);
        const result = DealScoreService.computeFromData(120, history);
        assert.equal(result.sampleCount, 5);
    });
});
