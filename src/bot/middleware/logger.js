const User = require("../../models/User");
const Message = require("../../models/Message");

/**
 * Middleware to log messages and upsert user data.
 * @param {import('telegraf').Context} ctx
 * @param {Function} next
 */
const loggerMiddleware = async (ctx, next) => {
    // Only process if we have a from object (user interaction)
    if (ctx.from) {
        const { id, username, first_name, last_name, language_code, is_bot } = ctx.from;
        const telegram_id = id.toString();

        try {
            // Upsert User
            let user = await User.query().findOne({ telegram_id });
            const now = new Date().toISOString();

            const userData = {
                telegram_id,
                username,
                first_name,
                last_name,
                language_code,
                is_bot,
                // Store raw user data as metadata for future proofing
                metadata: { ...ctx.from },
                updated_at: now,
            };

            if (!user) {
                user = await User.query().insert({
                    ...userData,
                    created_at: now,
                });
            } else {
                await User.query().patch(userData).where("id", user.id);
            }

            // Log Message if text or caption exists
            const messageText = ctx.message?.text || ctx.message?.caption || ctx.callbackQuery?.data;
            const messageType = ctx.message?.sticker
                ? "sticker"
                : ctx.message?.photo
                ? "photo"
                : ctx.message?.voice
                ? "voice"
                : ctx.callbackQuery
                ? "callback_query"
                : "text";

            if (messageText || messageType) {
                await Message.query().insert({
                    user_id: user.id,
                    type: messageType,
                    text: messageText,
                    metadata: {
                        message_id: ctx.message?.message_id || ctx.callbackQuery?.id,
                        chat_id: ctx.chat?.id,
                        date: ctx.message?.date,
                        raw: ctx.message || ctx.callbackQuery,
                    },
                });
            }
        } catch (error) {
            console.error("Logger Middleware Error:", error);
            // Don't block execution if logging fails
        }
    }

    return next();
};

module.exports = loggerMiddleware;
