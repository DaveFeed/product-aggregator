/**
 * Daily Recommendations Cron Job.
 *
 * 1. Find active users (≥1 event in last 7 days).
 * 2. Generate recommendations via RecommendationService.
 * 3. Push via Telegram (rate-limited to ≤3 messages/user/day).
 */

require("dotenv").config();
const Knex = require("knex");
const { Model } = require("objection");
const { Telegraf } = require("telegraf");

async function run() {
    const knexConfig = require("../../knexfile");
    const knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
    Model.knex(knex);

    const RecommendationService = require("../../src/services/RecommendationService");

    // 1. Find active users.
    const activeUsers = await knex("user_events")
        .select("user_events.user_id")
        .join("users", "users.id", "user_events.user_id")
        .where("user_events.created_at", ">", knex.raw("NOW() - INTERVAL '7 days'"))
        .groupBy("user_events.user_id")
        .pluck("user_events.user_id");

    console.log(`[daily_recommendations] ${activeUsers.length} active users found.`);

    if (activeUsers.length === 0) {
        await knex.destroy();
        return;
    }

    // 2. Initialize Telegram bot (for sending messages).
    const bot = process.env.BOT_TOKEN ? new Telegraf(process.env.BOT_TOKEN) : null;

    let sent = 0, skipped = 0, failed = 0;

    for (const userId of activeUsers) {
        try {
            // Rate limit: max 3 notifications/user/day.
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayCount = await knex("bot_message_log")
                .where("user_id", userId)
                .where("created_at", ">=", todayStart.toISOString())
                .count("id as cnt")
                .first();

            if (todayCount && Number(todayCount.cnt) >= 3) {
                skipped++;
                continue;
            }

            // Generate recommendations.
            const result = await RecommendationService.generateFor(userId);
            if (!result.items || result.items.length === 0) {
                skipped++;
                continue;
            }

            // Format message.
            const lines = result.items.slice(0, 5).map((item, i) =>
                `${i + 1}. ${item.reason}`
            );
            const messageText = `🛒 Daily Recommendations:\n\n${lines.join("\n")}\n\nReply "show more" to see all.`;

            // Send via Telegram.
            if (bot) {
                const user = await knex("users").where("id", userId).first();
                if (user?.telegram_id) {
                    try {
                        await bot.telegram.sendMessage(user.telegram_id, messageText);
                        sent++;
                        // Mark delivered.
                        await knex("recommendation_cache")
                            .where("user_id", userId)
                            .whereNull("delivered_at")
                            .update({ delivered_at: knex.fn.now() });
                    } catch (tgErr) {
                        if (tgErr.response?.error_code === 403) {
                            // Bot blocked by user — mark inactive.
                            await knex("users").where("id", userId)
                                .update({ metadata: knex.raw("COALESCE(metadata, '{}'::jsonb) || '{\"bot_blocked\": true}'::jsonb") });
                            console.log(`[daily_recommendations] User ${userId} blocked bot.`);
                        } else {
                            console.error(`[daily_recommendations] Telegram error for user ${userId}:`, tgErr.message);
                        }
                        failed++;
                    }
                }
            } else {
                console.log(`[daily_recommendations] (no bot) Would send to user ${userId}: ${result.items.length} items`);
                sent++;
            }
        } catch (err) {
            console.error(`[daily_recommendations] Error for user ${userId}:`, err.message);
            failed++;
        }
    }

    console.log(`[daily_recommendations] Done. Sent: ${sent}, Skipped: ${skipped}, Failed: ${failed}`);
    await knex.destroy();
}

// Run if called directly.
if (require.main === module) {
    run().catch((e) => {
        console.error("[daily_recommendations] Fatal:", e);
        process.exit(1);
    });
}

module.exports = { run };
