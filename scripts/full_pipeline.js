require("dotenv").config({
    path: require("path").resolve(__dirname, "../.env"),
});
const { spawn } = require("child_process");
const path = require("path");

function runCommand(command, args, cwd = process.cwd()) {
    return new Promise((resolve, reject) => {
        console.log(`\n> Running: ${command} ${args.join(" ")}`);
        const proc = spawn(command, args, { stdio: "inherit", cwd, shell: true });

        proc.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command failed with code ${code}`));
            }
        });

        proc.on("error", (err) => {
            reject(err);
        });
    });
}

async function main() {
    try {
        const projectRoot = path.resolve(__dirname, "..");

        // 1. Clean Database
        console.log("=== STEP 1: Cleaning Database ===");
        await runCommand("node", ["scripts/clean_db.js"], projectRoot);

        // 2. Run Migrations (Ensure schema is up to date)
        console.log("=== STEP 2: Running Migrations ===");
        await runCommand("npm", ["run", "migrate"], projectRoot);

        // 3. Run Scrapers
        // Note: These can take a long time. In a real scenario, you might want to run them in parallel or handle timeouts.
        console.log("=== STEP 3 & 4: Running Scrapers in Parallel ===");
        await Promise.all([
            runCommand("node", ["crons/sas_am/job.js"], projectRoot),
            runCommand("node", ["crons/yerevan_city/job.js"], projectRoot),
            runCommand("node", ["crons/parma_am/job.js"], projectRoot),
            runCommand("node", ["crons/carrefour_am/job.js"], projectRoot),
        ]);

        // 4. Normalize Data
        console.log("=== STEP 4.5: Normalizing Data ===");
        // Usage: node processors/normalizer_v2.js <provider> <input> <output>
        const normalizerScript = "processors/normalizer_v2.js";

        // Normalize SAS
        await runCommand(
            "node",
            [normalizerScript, "sas_am", "data/products_sas_clean.json", "data/normalized_db_sas_am.json"],
            projectRoot
        );

        // Normalize Yerevan City
        await runCommand(
            "node",
            [
                normalizerScript,
                "yerevan_city",
                "data/products_yerevan_city_clean.json",
                "data/normalized_db_yerevan_city.json",
            ],
            projectRoot
        );

        // Normalize Parma
        await runCommand(
            "node",
            [normalizerScript, "parma_am", "data/products_parma_am.json", "data/normalized_db_parma_am.json"],
            projectRoot
        );

        // Normalize Carrefour
        await runCommand(
            "node",
            [
                normalizerScript,
                "carrefour_am",
                "data/products_carrefour_am.json",
                "data/normalized_db_carrefour_am.json",
            ],
            projectRoot
        );

        // 5. Sync Database
        console.log("=== STEP 5: Syncing Database ===");
        await runCommand("node", ["cmd/sync_db.js"], projectRoot);

        console.log("\n=== Full Pipeline Completed Successfully! ===");
        process.exit(0);
    } catch (error) {
        console.error("\nPipeline Failed:", error.message);
        process.exit(1);
    }
}

main();
