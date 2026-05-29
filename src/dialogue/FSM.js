/**
 * Finite State Machine for dialogue state management.
 *
 * Pure functions — no DB, no side effects. State persistence is handled by
 * ConversationSession (Task 16).
 */

const STATES = Object.freeze({
    IDLE: "idle",
    SEARCHING: "searching",
    SHOWING_RESULTS: "showing_results",
    VIEWING_PRODUCT: "viewing_product",
    CART_REVIEW: "cart_review",
    CHECKOUT_CONFIRM: "checkout_confirm",
    ORDER_PLACED: "order_placed",
});

// Tools available per state (doc §5.3 Table 3).
const ALLOWED_TOOLS = Object.freeze({
    [STATES.IDLE]: Object.freeze(["search_products", "get_recommendations", "view_cart"]),
    [STATES.SEARCHING]: Object.freeze(["search_products", "view_cart"]),
    [STATES.SHOWING_RESULTS]: Object.freeze([
        "search_products",
        "get_product_details",
        "add_to_cart",
        "view_cart",
        "get_recommendations",
    ]),
    [STATES.VIEWING_PRODUCT]: Object.freeze([
        "add_to_cart",
        "view_cart",
        "get_price_history",
        "search_products",
    ]),
    [STATES.CART_REVIEW]: Object.freeze([
        "remove_from_cart",
        "view_cart",
        "initiate_checkout",
        "search_products",
        "get_recommendations",
    ]),
    [STATES.CHECKOUT_CONFIRM]: Object.freeze(["confirm_checkout", "view_cart"]),
    [STATES.ORDER_PLACED]: Object.freeze(["search_products", "get_recommendations", "view_cart"]),
});

// Transition table: { [state]: { [event]: nextState } }
// The special event "reset" is handled universally outside this map.
const TRANSITIONS = {
    [STATES.IDLE]: {
        search_products: STATES.SEARCHING,
    },
    [STATES.SEARCHING]: {
        results_returned: STATES.SHOWING_RESULTS,
    },
    [STATES.SHOWING_RESULTS]: {
        search_products: STATES.SEARCHING, // new search from results
        view_product: STATES.VIEWING_PRODUCT,
        add_to_cart: STATES.SHOWING_RESULTS,
        view_cart: STATES.CART_REVIEW,
    },
    [STATES.VIEWING_PRODUCT]: {
        search_products: STATES.SEARCHING, // new search from product detail
        add_to_cart: STATES.VIEWING_PRODUCT,
        back: STATES.SHOWING_RESULTS,
    },
    [STATES.CART_REVIEW]: {
        search_products: STATES.SEARCHING, // new search from cart
        initiate_checkout: STATES.CHECKOUT_CONFIRM,
        remove_from_cart: STATES.CART_REVIEW,
        continue_shopping: STATES.IDLE,
    },
    [STATES.CHECKOUT_CONFIRM]: {
        confirm: STATES.ORDER_PLACED,
        cancel: STATES.CART_REVIEW,
    },
    [STATES.ORDER_PLACED]: {
        new_search: STATES.IDLE,
    },
};

/**
 * Check whether a direct transition from `from` to `to` state exists.
 * @param {string} from - current state
 * @param {string} to   - target state
 * @returns {boolean}
 */
function canTransition(from, to) {
    // Reset to idle is always allowed.
    if (to === STATES.IDLE) return true;
    const stateTransitions = TRANSITIONS[from];
    if (!stateTransitions) return false;
    return Object.values(stateTransitions).includes(to);
}

/**
 * Deterministic state transition given a current state and an event.
 * @param {string} from  - current state
 * @param {string} event - event name
 * @returns {string} next state
 * @throws {Error} on unknown state or unknown event for that state
 */
function transition(from, event) {
    // Universal reset.
    if (event === "reset") return STATES.IDLE;

    const stateTransitions = TRANSITIONS[from];
    if (!stateTransitions) {
        throw new Error(`Unknown state '${from}'. Valid states: ${Object.values(STATES).join(", ")}`);
    }
    const next = stateTransitions[event];
    if (next === undefined) {
        const validEvents = Object.keys(stateTransitions).concat("reset");
        throw new Error(
            `No transition for event '${event}' in state '${from}'. Valid events: ${validEvents.join(", ")}`
        );
    }
    return next;
}

module.exports = { STATES, ALLOWED_TOOLS, TRANSITIONS, canTransition, transition };
