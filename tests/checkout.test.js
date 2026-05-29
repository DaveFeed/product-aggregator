const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");

const CartService = require("../src/services/CartService");
const CheckoutService = require("../src/services/CheckoutService");

// CheckoutService imports EventLogger which lazily loads the DB connection.
// Clean up the connection pool after tests so the process exits.
after(async () => {
    try {
        const knex = require("../src/database/connection");
        await knex.destroy();
    } catch {}
});
const { STATES } = require("../src/dialogue/FSM");

function makeSession(state = "cart_review") {
    return {
        state,
        context: { cart: [] },
        mergeContext(patch) { Object.assign(this.context, patch); },
    };
}

const MILK = { product_id: 1, title: "Milk 1L", price: 500, provider_name: "SAS" };
const BREAD = { product_id: 2, title: "Lavash 450g", price: 200, provider_name: "Parma" };

describe("CheckoutService", () => {
    let session;
    beforeEach(() => {
        session = makeSession();
        CartService.add(session, MILK, 2);
        CartService.add(session, BREAD, 1);
    });

    describe("initiate", () => {
        it("returns a summary with items, total, and confirmation prompt", () => {
            const result = CheckoutService.initiate(session);
            assert.equal(result.ok, true);
            assert.equal(result.items.length, 2);
            assert.equal(result.total, 1200);
            assert.ok(result.prompt);
        });

        it("returns error if cart is empty", () => {
            session.context.cart = [];
            const result = CheckoutService.initiate(session);
            assert.equal(result.ok, false);
            assert.ok(result.error.includes("empty"));
        });
    });

    describe("confirm (true)", () => {
        it("creates an order snapshot and clears the cart", () => {
            const result = CheckoutService.confirm(session, true);
            assert.equal(result.ok, true);
            assert.ok(result.orderId, "should have an orderId");
            assert.equal(result.status, "placed");
            assert.equal(result.total, 1200);
            assert.equal(result.items.length, 2);
            // Cart should be cleared.
            assert.equal(session.context.cart.length, 0);
            // Order snapshot stored in session for later persistence.
            assert.ok(session.context.lastOrder);
        });
    });

    describe("confirm (false / cancel)", () => {
        it("leaves cart intact and returns cancelled status", () => {
            const result = CheckoutService.confirm(session, false);
            assert.equal(result.ok, true);
            assert.equal(result.status, "cancelled");
            assert.equal(session.context.cart.length, 2, "cart should remain");
        });
    });
});
