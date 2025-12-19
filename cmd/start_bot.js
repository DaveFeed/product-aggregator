require("dotenv").config();
const { Model } = require("objection");
const Knex = require("knex");
const knexConfig = require("../knexfile");
const setupBot = require("../src/bot/index");

const environment = process.env.NODE_ENV || "development";
const knex = Knex(knexConfig[environment]);
Model.knex(knex);

console.log("Database connected.");

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error("BOT_TOKEN is missing in .env!");
    process.exit(1);
}

// Global Error Handlers (prevent crash)
process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err);
    // Decide whether to exit. For bot stability, we might want to log and keep running,
    // or exit if critical. Usually, let's keep running unless it's catastrophic.
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("UNHANDLED REJECTION:", reason);
});

async function start() {
    try {
        const bot = setupBot(BOT_TOKEN);

        // Launch bot with manual signal handling to coordinate with DB
        await bot.launch({
            handleSigInt: false,
            handleSigTerm: false,
        });

        console.log("Bot setup complete. Launching...");
        console.log("Bot is running!");

        // Graceful Stop Logic
        const stop = async (signal) => {
            console.log(`\nReceived ${signal}. Stopping bot...`);
            try {
                await bot.stop(signal);
                console.log("Bot stopped.");
                await knex.destroy();
                console.log("Database connection closed.");
                process.exit(0);
            } catch (err) {
                console.error("Error during graceful shutdown:", err);
                process.exit(1);
            }
        };

        process.once("SIGINT", () => stop("SIGINT"));
        process.once("SIGTERM", () => stop("SIGTERM"));
    } catch (error) {
        console.error("Failed to setup/launch bot:", error);
        process.exit(1);
    }
}

start();
