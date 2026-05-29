const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const CartService = require("../src/services/CartService");

// Minimal session mock — CartService only reads/writes session.context.cart.
function makeSession() {
    return {
        context: { cart: [] },
        mergeContext(patch) {
            Object.assign(this.context, patch);
        },
    };
}

// Fake product snapshot — CartService receives these from the caller (tool handler).
const MILK = { product_id: 1, title: 'Milk "Marianna" 1L', price: 500, provider_name: "SAS" };
const BREAD = { product_id: 2, title: "Lavash 450g", price: 200, provider_name: "Parma" };

describe("CartService", () => {
    let session;
    beforeEach(() => {
        session = makeSession();
    });

    describe("add", () => {
        it("adds a new item with quantity 1 by default", () => {
            const result = CartService.add(session, MILK);
            assert.equal(result.ok, true);
            assert.equal(session.context.cart.length, 1);
            assert.equal(session.context.cart[0].product_id, 1);
            assert.equal(session.context.cart[0].quantity, 1);
        });

        it("adds with explicit quantity", () => {
            CartService.add(session, MILK, 3);
            assert.equal(session.context.cart[0].quantity, 3);
        });

        it("merges quantity when same product added again", () => {
            CartService.add(session, MILK, 2);
            CartService.add(session, MILK, 3);
            assert.equal(session.context.cart.length, 1, "should not duplicate");
            assert.equal(session.context.cart[0].quantity, 5, "quantities should sum");
        });

        it("keeps different products separate", () => {
            CartService.add(session, MILK);
            CartService.add(session, BREAD);
            assert.equal(session.context.cart.length, 2);
        });

        it("rejects zero or negative quantity", () => {
            assert.throws(() => CartService.add(session, MILK, 0));
            assert.throws(() => CartService.add(session, MILK, -1));
        });

        it("rejects non-integer quantity", () => {
            assert.throws(() => CartService.add(session, MILK, 1.5));
        });
    });

    describe("remove", () => {
        it("removes an existing item", () => {
            CartService.add(session, MILK);
            const result = CartService.remove(session, 1);
            assert.equal(result.ok, true);
            assert.equal(result.removed, true);
            assert.equal(session.context.cart.length, 0);
        });

        it("returns removed:false for non-existent product", () => {
            const result = CartService.remove(session, 999);
            assert.equal(result.ok, true);
            assert.equal(result.removed, false);
        });
    });

    describe("setQuantity", () => {
        it("sets absolute quantity", () => {
            CartService.add(session, MILK, 5);
            CartService.setQuantity(session, 1, 2);
            assert.equal(session.context.cart[0].quantity, 2);
        });

        it("removes item when quantity <= 0", () => {
            CartService.add(session, MILK);
            CartService.setQuantity(session, 1, 0);
            assert.equal(session.context.cart.length, 0);
        });
    });

    describe("view", () => {
        it("returns empty cart", () => {
            const view = CartService.view(session);
            assert.deepEqual(view.items, []);
            assert.equal(view.total, 0);
            assert.equal(view.currency, "AMD");
        });

        it("total equals sum(price * quantity)", () => {
            CartService.add(session, MILK, 2); // 500 * 2 = 1000
            CartService.add(session, BREAD, 3); // 200 * 3 = 600
            const view = CartService.view(session);
            assert.equal(view.total, 1600);
            assert.equal(view.items.length, 2);
        });
    });

    describe("clear", () => {
        it("empties the cart", () => {
            CartService.add(session, MILK);
            CartService.add(session, BREAD);
            CartService.clear(session);
            assert.equal(session.context.cart.length, 0);
        });
    });
});
