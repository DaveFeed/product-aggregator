const { Telegraf, session } = require("telegraf");
const User = require("../models/User");
const stage = require("./scenes");

const setupBot = (botToken) => {
    const bot = new Telegraf(botToken);

    // Middlewares
    bot.use((ctx, next) => {
        if (ctx?.from?.is_bot) return; // Ignore bot messages
        return next();
    });
    bot.use(session());
    bot.use(require("./middlewares/logger"));
    bot.use(stage.middleware());

    console.log("Registered Scenes:", stage && stage.scenes ? Array.from(stage.scenes.keys()) : "None");

    bot.start(async (ctx) => {
        const { id, username, first_name, last_name } = ctx.from;

        try {
            // Check if user exists
            let user = await User.query().findOne({ telegram_id: id.toString() });

            if (!user) {
                // Create new user
                user = await User.query().insert({
                    telegram_id: id.toString(),
                    username,
                    first_name,
                    last_name,
                });
                ctx.reply(`Welcome ${first_name}!`);
            } else {
                // ctx.reply(`Welcome back ${first_name}!`);
            }

            // Enter Home Scene
            await ctx.scene.enter("home");
        } catch (error) {
            console.error("Error handling start command:", error);
            ctx.reply("An error occurred.");
        }
    });

    // Global handlers for Main Menu (in case session is lost/restarted)
    bot.hears("🔍 Search", (ctx) => ctx.scene.enter("search"));
    bot.hears("📋 Catalog", (ctx) => ctx.scene.enter("catalog"));
    bot.hears("⚙️ Settings", (ctx) => ctx.scene.enter("settings"));
    bot.hears("🔙 Back", (ctx) => ctx.scene.enter("home"));
    bot.help((ctx) => {
        ctx.reply("Todo: Help message");
    });

    // Error Handling
    bot.catch((err, ctx) => {
        console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);

        try {
            ctx.reply(
                `Error occurred while processing your request, please provide this information to @davefeed\nMessage: \`${err.message}\`\nStack: \`\`\`${err.stack}\`\`\``,
                {
                    parse_mode: "Markdown",
                }
            );
        } catch (e) {
            console.error("Could not reply to user", e);
        }
    });
    return bot;
};

module.exports = setupBot;
