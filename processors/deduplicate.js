const fs = require("fs");
const path = require("path");

const FILES = [
    { input: "data/products_sas.json", output: "data/products_sas_clean.json" },
    {
        input: "data/products_yerevan_city.json",
        output: "data/products_yerevan_city_clean.json",
    },
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
        let dups = 0;

        rawData.forEach((item) => {
            // Use product_url as unique key
            if (!item.product_url) return;

            const key = item.product_url;
            if (uniqueMap.has(key)) {
                dups++;
                // Optional: Merge logic if needed, but usually latest scraping is best,
                // or just keep the first one found.
                // We'll keep the first one found.
            } else {
                uniqueMap.set(key, item);
            }
        });

        const cleanedData = Array.from(uniqueMap.values());
        console.log(`  Original: ${rawData.length}`);
        console.log(`  Unique:   ${cleanedData.length}`);
        console.log(`  Duplicates removed: ${dups}`);

        fs.writeFileSync(path.join(process.cwd(), output), JSON.stringify(cleanedData, null, 2));
        console.log(`  Saved to ${output}`);
    });
}

run();
