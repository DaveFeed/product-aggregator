/**
 * NotificationService — stub for price drop notifications.
 *
 * v2 stub: function signature + cart-item check only.
 * Full implementation would trigger when a scheduled price check detects
 * ≥10% drop on a tracked product.
 */

/**
 * Notify user about a price drop. Stub — logs intent only.
 * @param {number} userId
 * @param {number} productId
 * @param {number} oldPrice
 * @param {number} newPrice
 */
async function notifyPriceDrop(userId, productId, oldPrice, newPrice) {
    const dropPct = ((oldPrice - newPrice) / oldPrice) * 100;
    console.log(
        `[NotificationService] STUB: Price drop ${dropPct.toFixed(1)}% for product ${productId} ` +
        `(${oldPrice} → ${newPrice}). User ${userId} would be notified.`
    );
    // TODO: In production, send via Telegram bot with inline "Add to cart" button.
}

module.exports = { notifyPriceDrop };
