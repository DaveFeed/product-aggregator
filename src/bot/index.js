const { Telegraf, Markup } = require("telegraf");
const User = require("../models/User");
const ChatService = require("../services/ChatService");
const { parseCallback, actionToMessage } = require("./callbacks");

const setupBot = (botToken) => {
    const bot = new Telegraf(botToken);

    // Middlewares
    bot.use((ctx, next) => {
        if (ctx?.from?.is_bot) return; // Ignore bot messages
        return next();
    });
    bot.use(require("./middlewares/logger"));

    // /start — register user
    bot.start(async (ctx) => {
        const { id, username, first_name, last_name } = ctx.from;

        try {
            let user = await User.query().findOne({ telegram_id: id.toString() });

            if (!user) {
                user = await User.query().insert({
                    telegram_id: id.toString(),
                    username,
                    first_name,
                    last_name,
                });
                await ctx.reply(`Welcome ${first_name}! I'm your shopping assistant. Just tell me what you're looking for.`);
            } else {
                await ctx.reply(`Welcome back ${first_name}! How can I help you today?`);
            }
        } catch (error) {
            console.error("Error handling start command:", error);
            ctx.reply("An error occurred.");
        }
    });

    // /link <code> — Telegram account linking (Task 30)
    bot.command("link", async (ctx) => {
        const code = ctx.message.text.split(" ")[1]?.trim();
        if (!code) {
            return ctx.reply("Usage: /link <CODE>");
        }

        try {
            const knex = require("../database/connection");
            const row = await knex("auth_link_codes").where("code", code.toUpperCase()).first();

            if (!row) return ctx.reply("Invalid code. Please try again.");

            const created = new Date(row.created_at);
            if (Date.now() - created.getTime() > 10 * 60 * 1000) {
                return ctx.reply("Code expired. Please generate a new one.");
            }
            if (row.consumed_at) {
                return ctx.reply("Code already used.");
            }

            const user = await User.query().findOne({ telegram_id: ctx.from.id.toString() });
            if (!user) return ctx.reply("Please /start first.");

            await knex("auth_link_codes").where("code", code.toUpperCase()).update({
                user_id: user.id,
                consumed_at: new Date().toISOString(),
            });

            await ctx.reply("Account linked successfully! You can now use the web interface.");
        } catch (err) {
            console.error("[bot] Link error:", err);
            ctx.reply("An error occurred while linking.");
        }
    });

    bot.help((ctx) => {
        ctx.reply(
            "I'm a shopping assistant. You can:\n" +
            "- Search for products: \"find milk\"\n" +
            "- View your cart: \"show my cart\"\n" +
            "- Check prices: \"price history for product 42\"\n" +
            "- Link your web account: /link <CODE>"
        );
    });

    // Handle callback queries (inline buttons).
    bot.on("callback_query", async (ctx) => {
        const data = ctx.callbackQuery.data;
        const action = parseCallback(data);
        if (!action) {
            await ctx.answerCbQuery("Unknown action");
            return;
        }

        const message = actionToMessage(action);
        if (!message) {
            await ctx.answerCbQuery("Unknown action");
            return;
        }

        try {
            const user = await User.query().findOne({ telegram_id: ctx.from.id.toString() });
            if (!user) {
                await ctx.answerCbQuery("Please /start first");
                return;
            }

            await ctx.answerCbQuery();
            const response = await ChatService.handleMessage(user.id, message);
            await sendResponse(ctx, response);
        } catch (err) {
            console.error("[bot] Callback error:", err);
            await ctx.answerCbQuery("Error processing action");
        }
    });

    // Handle all text messages via ChatService.
    bot.on("text", async (ctx) => {
        try {
            const user = await User.query().findOne({ telegram_id: ctx.from.id.toString() });
            if (!user) {
                return ctx.reply("Please send /start first.");
            }

            const response = await ChatService.handleMessage(user.id, ctx.message.text);
            await sendResponse(ctx, response);
        } catch (err) {
            console.error("[bot] Message error:", err);
            ctx.reply("Sorry, an error occurred. Please try again.");
        }
    });

    // Error Handling
    bot.catch((err, ctx) => {
        console.error(`Bot error for ${ctx.updateType}:`, err);
        try {
            ctx.reply("An error occurred. Please try again.");
        } catch (e) {
            console.error("Could not reply to user:", e);
        }
    });

    return bot;
};

/**
 * Send a ChatService response as Telegram message(s).
 * Renders product cards with inline keyboards when search results are present.
 */
async function sendResponse(ctx, response) {
    // If there are search results, render product cards.
    if (response.toolResults && Array.isArray(response.toolResults) && response.toolResults.length > 0) {
        const products = response.toolResults.slice(0, 5);
        for (const product of products) {
            const text = `${product.title}\n💰 ${product.price} ֏ — ${product.provider_name || "Unknown"}`;
            await ctx.reply(text, Markup.inlineKeyboard([
                Markup.button.callback("🛒 В корзину", `cb:add:${product.id}`),
                Markup.button.callback("📋 Подробнее", `cb:details:${product.id}`),
                Markup.button.callback("📈 Цены", `cb:hist:${product.id}`),
            ]));
        }
    }

    // Send the main response text (chunked if too long for Telegram).
    const text = response.text || "Done.";
    const chunks = chunkText(text, 4096);
    for (const chunk of chunks) {
        await ctx.reply(chunk);
    }
}

function chunkText(text, maxLen) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLen) {
        chunks.push(text.slice(i, i + maxLen));
    }
    return chunks;
}

module.exports = setupBot;
