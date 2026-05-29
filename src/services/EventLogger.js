/**
 * EventLogger — fire-and-forget user event recording.
 *
 * Inserts into user_events table. Errors are logged but never propagated
 * to callers, so event logging never blocks the response path.
 */

/**
 * Log a user event. Non-blocking — returns void.
 * @param {{ userId:number, eventType:string, productId?:number, categoryId?:number, query?:string, metadata?:object }} params
 */
async function log({ userId, eventType, productId, categoryId, query, metadata }) {
    try {
        const knex = require("../database/connection");
        await knex("user_events").insert({
            user_id: userId,
            event_type: eventType,
            product_id: productId || null,
            category_id: categoryId || null,
            query: query || null,
            metadata: metadata ? JSON.stringify(metadata) : "{}",
        });
    } catch (err) {
        console.error(`[EventLogger] Failed to log ${eventType} for user ${userId}:`, err.message);
    }
}

module.exports = { log };
