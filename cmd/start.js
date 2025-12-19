require("dotenv").config();
const setupBot = require("../src/bot");
const knex = require("../src/database/connection");

// Check DB connection
knex.raw("SELECT 1")
    .then(() => {
        console.log("PostgreSQL connected");

        const botToken = process.env.BOT_TOKEN;
        if (!botToken) {
            throw new Error("BOT_TOKEN is missing in .env");
        }

        setupBot(botToken);
    })
    .catch((e) => {
        console.error("PostgreSQL connection failed");
        console.error(e);
        process.exit(1);
    });
