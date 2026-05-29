const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Module under test — will be created next.
const { STATES, ALLOWED_TOOLS, canTransition, transition } = require("../src/dialogue/FSM");

// ─── STATES ──────────────────────────────────────────────────────────────────

describe("STATES", () => {
    it("exports all 7 state constants", () => {
        const expected = ["idle", "searching", "showing_results", "viewing_product", "cart_review", "checkout_confirm", "order_placed"];
        for (const s of expected) {
            assert.ok(STATES[s.toUpperCase()] !== undefined, `missing STATES.${s.toUpperCase()}`);
            assert.equal(STATES[s.toUpperCase()], s);
        }
    });

    it("is frozen", () => {
        assert.ok(Object.isFrozen(STATES));
    });
});

// ─── ALLOWED_TOOLS ───────────────────────────────────────────────────────────

describe("ALLOWED_TOOLS", () => {
    it("is frozen at both levels", () => {
        assert.ok(Object.isFrozen(ALLOWED_TOOLS));
        for (const tools of Object.values(ALLOWED_TOOLS)) {
            assert.ok(Object.isFrozen(tools));
        }
    });

    it("idle includes search_products, get_recommendations, view_cart", () => {
        const idle = ALLOWED_TOOLS[STATES.IDLE];
        assert.ok(idle.includes("search_products"));
        assert.ok(idle.includes("get_recommendations"));
        assert.ok(idle.includes("view_cart"));
    });

    it("idle does NOT include initiate_checkout, add_to_cart, remove_from_cart", () => {
        const idle = ALLOWED_TOOLS[STATES.IDLE];
        assert.ok(!idle.includes("initiate_checkout"));
        assert.ok(!idle.includes("add_to_cart"));
        assert.ok(!idle.includes("remove_from_cart"));
    });

    it("showing_results includes search_products, add_to_cart, view_cart, get_product_details", () => {
        const sr = ALLOWED_TOOLS[STATES.SHOWING_RESULTS];
        assert.ok(sr.includes("search_products"));
        assert.ok(sr.includes("add_to_cart"));
        assert.ok(sr.includes("view_cart"));
        assert.ok(sr.includes("get_product_details"));
    });

    it("cart_review includes initiate_checkout and remove_from_cart", () => {
        const cr = ALLOWED_TOOLS[STATES.CART_REVIEW];
        assert.ok(cr.includes("initiate_checkout"));
        assert.ok(cr.includes("remove_from_cart"));
    });

    it("checkout_confirm does NOT include search or add_to_cart", () => {
        const cc = ALLOWED_TOOLS[STATES.CHECKOUT_CONFIRM];
        assert.ok(!cc.includes("search_products"));
        assert.ok(!cc.includes("add_to_cart"));
    });

    it("every state has an entry in ALLOWED_TOOLS", () => {
        for (const s of Object.values(STATES)) {
            assert.ok(Array.isArray(ALLOWED_TOOLS[s]), `ALLOWED_TOOLS missing entry for state '${s}'`);
        }
    });
});

// ─── canTransition ───────────────────────────────────────────────────────────

describe("canTransition", () => {
    it("allows idle → searching (via search_products)", () => {
        assert.equal(canTransition("idle", "searching"), true);
    });

    it("disallows idle → showing_results (no direct path)", () => {
        assert.equal(canTransition("idle", "showing_results"), false);
    });

    it("disallows idle → checkout_confirm", () => {
        assert.equal(canTransition("idle", "checkout_confirm"), false);
    });

    it("allows cart_review → checkout_confirm", () => {
        assert.equal(canTransition("cart_review", "checkout_confirm"), true);
    });

    it("allows any → idle (reset)", () => {
        for (const s of Object.values(STATES)) {
            assert.equal(canTransition(s, "idle"), true, `${s} → idle should be allowed`);
        }
    });

    it("self-transitions are allowed when defined (showing_results → showing_results via add_to_cart)", () => {
        assert.equal(canTransition("showing_results", "showing_results"), true);
    });
});

// ─── transition ──────────────────────────────────────────────────────────────

describe("transition", () => {
    it("idle + search_products → searching", () => {
        assert.equal(transition("idle", "search_products"), "searching");
    });

    it("searching + results_returned → showing_results", () => {
        assert.equal(transition("searching", "results_returned"), "showing_results");
    });

    it("showing_results + view_product → viewing_product", () => {
        assert.equal(transition("showing_results", "view_product"), "viewing_product");
    });

    it("showing_results + add_to_cart → showing_results (self-loop)", () => {
        assert.equal(transition("showing_results", "add_to_cart"), "showing_results");
    });

    it("showing_results + view_cart → cart_review", () => {
        assert.equal(transition("showing_results", "view_cart"), "cart_review");
    });

    it("viewing_product + add_to_cart → viewing_product (self-loop)", () => {
        assert.equal(transition("viewing_product", "add_to_cart"), "viewing_product");
    });

    it("viewing_product + back → showing_results", () => {
        assert.equal(transition("viewing_product", "back"), "showing_results");
    });

    it("cart_review + initiate_checkout → checkout_confirm", () => {
        assert.equal(transition("cart_review", "initiate_checkout"), "checkout_confirm");
    });

    it("cart_review + remove_from_cart → cart_review (self-loop)", () => {
        assert.equal(transition("cart_review", "remove_from_cart"), "cart_review");
    });

    it("cart_review + continue_shopping → idle", () => {
        assert.equal(transition("cart_review", "continue_shopping"), "idle");
    });

    it("checkout_confirm + confirm → order_placed", () => {
        assert.equal(transition("checkout_confirm", "confirm"), "order_placed");
    });

    it("checkout_confirm + cancel → cart_review", () => {
        assert.equal(transition("checkout_confirm", "cancel"), "cart_review");
    });

    it("order_placed + new_search → idle", () => {
        assert.equal(transition("order_placed", "new_search"), "idle");
    });

    it("any state + reset → idle", () => {
        for (const s of Object.values(STATES)) {
            assert.equal(transition(s, "reset"), "idle", `transition('${s}', 'reset') should be 'idle'`);
        }
    });

    it("throws on unknown event from a known state", () => {
        assert.throws(
            () => transition("idle", "nonexistent_event"),
            (err) => err.message.includes("idle") && err.message.includes("nonexistent_event")
        );
    });

    it("throws on unknown state", () => {
        assert.throws(
            () => transition("bogus_state", "search_products"),
            (err) => err.message.includes("bogus_state")
        );
    });
});
