/**
 * CartService — add/remove/view/clear cart items.
 *
 * Cart is stored in session.context.cart (an array of cart-item objects).
 * No DB table — lives in the conversation JSONB context. Session persistence
 * is the caller's responsibility (session.save()).
 */

function ensureCart(session) {
    if (!session.context) session.context = {};
    if (!Array.isArray(session.context.cart)) session.context.cart = [];
}

function validateQuantity(qty) {
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty <= 0) {
        throw new Error(`quantity must be a positive integer, got ${qty}`);
    }
}

/**
 * Add a product snapshot to the cart. Merges quantities if the same product_id already exists.
 * @param {object} session - conversation session with .context.cart
 * @param {{ product_id:number, title:string, price:number, provider_name:string }} product - product snapshot
 * @param {number} [quantity=1]
 * @returns {{ ok:true, cart_item_count:number }}
 */
function add(session, product, quantity = 1) {
    validateQuantity(quantity);
    ensureCart(session);

    const existing = session.context.cart.find((i) => i.product_id === product.product_id);
    if (existing) {
        existing.quantity += quantity;
    } else {
        session.context.cart.push({
            product_id: product.product_id,
            title: product.title,
            price: product.price,
            provider_name: product.provider_name,
            quantity,
        });
    }
    session.mergeContext({ cart: session.context.cart });
    return { ok: true, cart_item_count: session.context.cart.length };
}

/**
 * Remove a product from the cart entirely.
 * @returns {{ ok:true, removed:boolean }}
 */
function remove(session, productId) {
    ensureCart(session);
    const idx = session.context.cart.findIndex((i) => i.product_id === productId);
    if (idx === -1) return { ok: true, removed: false };
    session.context.cart.splice(idx, 1);
    session.mergeContext({ cart: session.context.cart });
    return { ok: true, removed: true };
}

/**
 * Set absolute quantity for a product. Removes if qty <= 0.
 */
function setQuantity(session, productId, quantity) {
    ensureCart(session);
    if (quantity <= 0) return remove(session, productId);
    const item = session.context.cart.find((i) => i.product_id === productId);
    if (item) {
        item.quantity = quantity;
        session.mergeContext({ cart: session.context.cart });
    }
    return { ok: true };
}

/**
 * View the current cart.
 * @returns {{ items: Array, total: number, currency: string }}
 */
function view(session) {
    ensureCart(session);
    const items = session.context.cart;
    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    return { items, total: Math.round(total * 100) / 100, currency: "AMD" };
}

/**
 * Clear all items from the cart.
 */
function clear(session) {
    ensureCart(session);
    session.context.cart = [];
    session.mergeContext({ cart: [] });
    return { ok: true };
}

module.exports = { add, remove, setQuantity, view, clear };
