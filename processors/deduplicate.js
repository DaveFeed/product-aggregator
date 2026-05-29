const fs = require("fs");
const path = require("path");

const FILES = [
    { input: "data/products_sas.json", output: "data/products_sas_clean.json" },
    { input: "data/products_yerevan_city.json", output: "data/products_yerevan_city_clean.json" },
    { input: "data/products_parma_am.json", output: "data/products_parma_am_clean.json" },
    { input: "data/products_carrefour_am.json", output: "data/products_carrefour_am_clean.json" },
];

function run() {
    FILES.forEach(({ input, output }) => {
        const inputPath = path.join(process.cwd(), input);
        if (!fs.existsSync(inputPath)) {
            console.log(`Skipping ${input}, file not found.`);
            return;
        }

        console.log(`Processing ${input}...`);
        const rawData = JSON.parse(fs.readFileSync(inputPath, "utf8"));
        const uniqueMap = new Map();
        const categoriesSeen = new Map();
        let dups = 0;

        rawData.forEach((item) => {
            if (!item.product_url) return;
            const key = item.product_url;
            if (uniqueMap.has(key)) {
                dups++;
                // Record category sightings so we can track many-to-many later.
                const seen = categoriesSeen.get(key);
                if (item.category_name && !seen.includes(item.category_name)) seen.push(item.category_name);
            } else {
                uniqueMap.set(key, item);
                categoriesSeen.set(key, item.category_name ? [item.category_name] : []);
            }
        });

        // Attach categories_seen array to each item for downstream many-to-many handling.
        const cleanedData = Array.from(uniqueMap.entries()).map(([url, item]) => ({
            ...item,
            categories_seen: categoriesSeen.get(url) || [],
        }));

        console.log(`  Original: ${rawData.length}`);
        console.log(`  Unique:   ${cleanedData.length}`);
        console.log(`  Duplicates removed: ${dups}`);

        fs.writeFileSync(path.join(process.cwd(), output), JSON.stringify(cleanedData, null, 2));
        console.log(`  Saved to ${output}`);
    });
}

if (require.main === module) run();

module.exports = run;
