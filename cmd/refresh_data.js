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

const PROVIDERS = {
    sas_am: { scraper: "crons/sas_am/job.js", rawFile: "data/products_sas.json" },
    yerevan_city: { scraper: "crons/yerevan_city/job.js", rawFile: "data/products_yerevan_city.json" },
    parma_am: { scraper: "crons/parma_am/job.js", rawFile: "data/products_parma_am.json" },
    carrefour_am: { scraper: "crons/carrefour_am/job.js", rawFile: "data/products_carrefour_am.json" },
};

const NORMALIZED_FILES = {
    sas_am: "data/normalized_db_sas_am.json",
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

// Mark stale products — do NOT delete. The sync step will update `updated_at` for any
// product it sees in the new scrape; products whose `updated_at` didn't move past the
// run's start timestamp are candidates for soft-delisting. Historical price data is
// preserved because we never DELETE products that have price_history rows.
async function markStaleBefore(providerName, runStartIso) {
    if (!providerName) return;
    const provider = await knex("providers").where("name", providerName).first();
    if (!provider) {
        console.log(`Provider ${providerName} not found in DB — first sync run.`);
        return;
    }
    const staleCount = await knex("products")
        .where("provider_id", provider.id)
        .where("updated_at", "<", runStartIso)
        .update({
            metadata: knex.raw(`COALESCE(metadata, '{}'::jsonb) || '{"stale": true}'::jsonb`),
            updated_at: runStartIso,
        });
    console.log(`Marked ${staleCount} stale products for ${providerName}.`);
}

async function main() {
    try {
        const providerArg = ARGS.find((a) => a.startsWith("--provider="));
        const targetProvider = providerArg ? providerArg.split("=")[1] : null;
        const skipScrape = ARGS.includes("--skip-scrape");

        const providerNames = targetProvider ? [targetProvider] : Object.keys(PROVIDERS);
        const runStartIso = new Date().toISOString();

        for (const name of providerNames) {
            if (!PROVIDERS[name]) {
                console.warn(`Unknown provider: ${name}`);
                continue;
            }
            const config = PROVIDERS[name];

            if (!skipScrape) {
                console.log(`\n=== Scraping ${name} ===`);
                await runCommand("node", [config.scraper], PROJECT_ROOT);
            } else {
                console.log(`\n=== Skipping Scrape for ${name} ===`);
            }

            console.log(`\n=== Deduplicating ${name} ===`);
            // Run the generic deduplicator on whatever raw files exist.
            await runCommand("node", ["processors/deduplicate.js"], PROJECT_ROOT);

            console.log(`\n=== Normalizing ${name} ===`);
            // Prefer *_clean.json if deduplicator produced one; fall back to raw file.
            const cleanFile = config.rawFile.replace(/\.json$/, "_clean.json");
            const fs = require("fs");
            const inputFile = fs.existsSync(path.join(PROJECT_ROOT, cleanFile)) ? cleanFile : config.rawFile;
            const normalizedOutput = NORMALIZED_FILES[name];
            await runCommand("node", ["processors/normalizer_v2.js", name, inputFile, normalizedOutput], PROJECT_ROOT);
        }

        console.log("\n=== Syncing Database ===");
        const syncArgs = ["cmd/sync_db.js"];
        if (ARGS.includes("--force-embeddings")) syncArgs.push("--force-embeddings");
        await runCommand("node", syncArgs, PROJECT_ROOT);

        // After sync, mark products we did NOT see this run as stale (but keep their data).
        // This replaces the v1 destructive DELETE+re-INSERT strategy that also wiped price_history.
        for (const name of providerNames) await markStaleBefore(name, runStartIso);

        console.log("\nDone!");
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
