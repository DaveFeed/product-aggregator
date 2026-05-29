const User = require("../../models/User");
const BotMessageLog = require("../../models/BotMessageLog");

/**
 * Middleware to log messages and upsert user data.
 * @param {import('telegraf').Context} ctx
 * @param {Function} next
 */
const loggerMiddleware = async (ctx, next) => {
    if (ctx.from) {
        const { id, username, first_name, last_name, language_code } = ctx.from;
        const telegram_id = id.toString();

        try {
            // todo:: (optimize) have a caching layer to reduce DB hits for known users
            let user = await User.query().findOne({ telegram_id });
            const now = new Date().toISOString();

            const userData = {
                telegram_id,
                username,
                first_name,
                last_name,
                language_code,
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

            console.log(`Logged message from user ${telegram_id} (${messageType}): ${messageText}`);

            if (messageText || messageType) {
                await BotMessageLog.query().insert({
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
        }
    }

    return next();
};

module.exports = loggerMiddleware;
