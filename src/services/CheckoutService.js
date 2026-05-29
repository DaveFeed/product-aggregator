/**
 * CheckoutService — MOCK checkout flow.
 *
 * No real order API exists for any provider. This module records intent
 * in the session context (and later in the `orders` DB table once that
 * migration lands — Task 10). The user sees a confirmation; internally
 * we log the "order" as a JSON snapshot.
 *
 * // MOCK: no real order placement — records intent only.
 */

const crypto = require("crypto");
const EventLogger = require("./EventLogger");

/**
 * Preview the order before confirmation.
 * @param {object} session - with .context.cart populated
 * @returns {{ ok, items, total, currency, prompt } | { ok:false, error }}
 */
function initiate(session) {
    const cart = session.context?.cart || [];
    if (cart.length === 0) {
        return { ok: false, error: "Cart is empty — add items before checkout." };
    }

    const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
    return {
        ok: true,
        items: cart.map((i) => ({ ...i })),
        total: Math.round(total * 100) / 100,
        currency: "AMD",
        prompt: `Confirm order of ${cart.length} item(s) for ${total} ֏?`,
    };
}

/**
 * Confirm or cancel the checkout.
 * @param {object} session
 * @param {boolean} confirmed
 * @returns {{ ok, orderId?, status, items?, total? }}
 */
function confirm(session, confirmed) {
    if (!confirmed) {
        return { ok: true, status: "cancelled" };
    }

    const cart = session.context?.cart || [];
    const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const orderId = crypto.randomUUID();

    const order = {
        orderId,
        status: "placed",
        items: cart.map((i) => ({ ...i })),
        total: Math.round(total * 100) / 100,
        currency: "AMD",
        createdAt: new Date().toISOString(),
    };

    // Log purchase events — one per cart item.
    for (const item of cart) {
        EventLogger.log({ userId: session.userId, eventType: "purchase", productId: item.product_id });
    }

    // Persist order snapshot in session context for the tool handler / DB writer.
    session.mergeContext({ lastOrder: order, cart: [] });
    // Clear the in-memory cart array too.
    session.context.cart = [];

    console.warn(`[CheckoutService] MOCK order placed: ${orderId} — ${cart.length} items, ${total} ֏`);

    return { ok: true, ...order };
}

module.exports = { initiate, confirm };
