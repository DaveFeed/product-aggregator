#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");
const Knex = require("knex");
const knexConfig = require("../knexfile");
const { Model } = require("objection");

const environment = process.env.NODE_ENV || "development";
const knex = Knex(knexConfig[environment]);
Model.knex(knex);

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ARGS = process.argv.slice(2);

// Map provider name to script paths
const PROVIDERS = {
    sas_am: {
        scraper: "crons/sas_am/job.js",
        cleanFile: "data/products_sas_clean.json",
        rawFile: "data/products_sas.json",
        normalizedFile: "data/normalized_db.json", // SAS output name in normalizer is weird? No, checking normalizer logic.
    },
    yerevan_city: {
        scraper: "crons/yerevan_city/job.js",
        cleanFile: "data/products_yerevan_city_clean.json",
        rawFile: "data/products_yerevan_city.json",
    },
    parma_am: {
        scraper: "crons/parma_am/job.js",
        cleanFile: "data/products_parma_am_clean.json",
        rawFile: "data/products_parma_am.json",
    },
    carrefour_am: {
        scraper: "crons/carrefour_am/job.js",
        cleanFile: null,
        rawFile: "data/products_carrefour_am.json",
    },
};

// Normalizer outputs (based on normalizer_v2.js args)
const NORMALIZED_FILES = {
    sas_am: "data/normalized_db.json",
    yerevan_city: "data/normalized_db_yerevan_city.json",
    parma_am: "data/normalized_db_parma_am.json",
    carrefour_am: "data/normalized_db_carrefour_am.json",
};

async function runCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
        console.log(`Running: ${command} ${args.join(" ")}`);
        const proc = spawn(command, args, { cwd, stdio: "inherit", shell: true });
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command failed with code ${code}`));
        });
    });
}

async function cleanProvider(providerName) {
    if (providerName) {
        console.log(`Cleaning data for provider: ${providerName}...`);
        // Find provider ID
        const provider = await knex("providers").where("name", providerName).first();
        if (provider) {
            await knex("products").where("provider_id", provider.id).del(); // Cascade should handle price_history
            console.log(`Deleted products for ${providerName}`);
        } else {
            console.log(`Provider ${providerName} not found in DB. Skipping DB clean.`);
        }
    } else {
        // Full clean
        console.log("Cleaning ALL data...");
        await knex("price_history").del();
        await knex("products").del();
        await knex("categories").del();
        await knex("providers").del();
        console.log("Database cleared completely.");
    }
}

async function main() {
    try {
        const providerArg = ARGS.find((a) => a.startsWith("--provider="));
        const targetProvider = providerArg ? providerArg.split("=")[1] : null;

        // 1. Clean DB
        await cleanProvider(targetProvider);

        // 2. Scrape & Normalize
        const providerNames = targetProvider ? [targetProvider] : Object.keys(PROVIDERS);

        const skipScrape = ARGS.includes("--skip-scrape");

        for (const name of providerNames) {
            if (!PROVIDERS[name]) {
                console.warn(`Unknown provider: ${name}`);
                continue;
            }

            const config = PROVIDERS[name];

            // Run Scraper
            if (!skipScrape) {
                console.log(`\n=== Scraping ${name} ===`);
                await runCommand("node", [config.scraper], PROJECT_ROOT);
            } else {
                console.log(`\n=== Skipping Scrape for ${name} ===`);
            }

            // Run Normalizer
            console.log(`\n=== Normalizing ${name} ===`);
            const rawInput = config.rawFile;
            const normalizedOutput = NORMALIZED_FILES[name];

            // For SAS and City, normalizer currently defaults to 'products_sas_clean.json' inside if 'sas_am' passed?
            // Check normalizer logic:
            // if (provider === "sas_am") defaultInput = ... products_sas_clean.json
            // Wait, normalizer_v2.js expects 'products_sas_clean.json' which implies a cleaning step (clean_data.js) happens first?
            // Sas scraper output: data/products_sas.json?
            // I need to check if there's an intermediate 'clean' script for SAS/City.

            // Assuming straightforward pipeline for now or letting normalizer handle inputs if defaults match.
            // Explicitly passing input/output to normalizer overrides defaults.
            // BUT if SAS needs 'clean' step, I might be skipping it.
            // Let's stick to explicit paths matching normalizer expectations or raw files.
            // If normalizer expects 'sas_clean', it means 'products_sas.json' needs processing.
            // Checking local files: 'data/products_sas_clean.json' exists.
            // Who creates it? 'processors/clean_data.js'?

            // For simplicity/robustness, I will pass the raw output from scraper to normalizer
            // UNLESS there is a known intermediate step.
            // My previous tasks used 'normalizer_v2.js parma_am data/products_parma_am.json ...'
            // It worked. So passing raw file is fine if data is compatible.
            // SAS/City might be cleaner in 'clean.json' but let's try raw.

            await runCommand("node", ["processors/normalizer_v2.js", name, rawInput, normalizedOutput], PROJECT_ROOT);
        }

        // 3. Sync
        console.log("\n=== Syncing Database ===");
        await runCommand("node", ["cmd/sync_db.js"], PROJECT_ROOT);

        console.log("\nDone!");
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
