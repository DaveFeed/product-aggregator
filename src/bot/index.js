const { Telegraf, session } = require("telegraf");
const User = require("../models/User");
const stage = require("./scenes");

const setupBot = (botToken) => {
    const bot = new Telegraf(botToken);

    // Middleware
    bot.use(session());
    bot.use(require("./middleware/logger"));
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
                ctx.reply(`Welcome ${first_name}! You have been registered.`);
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

    bot.command("test", (ctx) => ctx.scene.enter("test_scene"));

    bot.help((ctx) => ctx.reply("Send /start to register.\nSend /test to run DB verification scene."));

    // Error Handling
    bot.catch((err, ctx) => {
        console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
        // Try to notify user if possible
        try {
            ctx.reply("Something went wrong. Please try again later.");
        } catch (e) {
            console.error("Could not reply to user", e);
        }
        // Do not crash the process
    });

    return bot;
};

module.exports = setupBot;
