/**
 * Callback query parsing — maps Telegram inline button callbacks to actions.
 */

/**
 * Parse a callback data string into an action descriptor.
 * @param {string} data - callback data from Telegram (e.g., "cb:add:42")
 * @returns {{ action: string, productId?: number } | null}
 */
function parseCallback(data) {
    if (!data || typeof data !== "string") return null;

    const parts = data.split(":");
    if (parts[0] !== "cb") return null;

    switch (parts[1]) {
        case "add":
            return { action: "add_to_cart", productId: Number(parts[2]) };
        case "details":
            return { action: "get_product_details", productId: Number(parts[2]) };
        case "hist":
            return { action: "get_price_history", productId: Number(parts[2]) };
        case "checkout":
            return { action: "checkout" };
        case "clear":
            return { action: "clear_cart" };
        default:
            return null;
    }
}

/**
 * Convert an action descriptor to a synthetic user message for ChatService.
 */
function actionToMessage(action) {
    switch (action.action) {
        case "add_to_cart":
            return `add product ${action.productId} to cart`;
        case "get_product_details":
            return `show details for product ${action.productId}`;
        case "get_price_history":
            return `show price history for product ${action.productId}`;
        case "checkout":
            return "checkout";
        case "clear_cart":
            return "clear my cart";
        default:
            return null;
    }
}

module.exports = { parseCallback, actionToMessage };
