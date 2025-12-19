const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");

function analyze() {
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("normalized_db_") && f.endsWith(".json"));

    const allCategories = [];

    files.forEach((file) => {
        const provider = file.replace("normalized_db_", "").replace(".json", "");
        const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));

        if (data.categories) {
            data.categories.forEach((cat) => {
                allCategories.push({
                    provider,
                    original: cat.name,
                    en: cat.name_en,
                    unified: cat.unified_category,
                    url: cat.url,
                    product_count: countProductsForCategory(data.products, cat.id),
                });
            });
        }
    });

    const grouped = {};
    allCategories.forEach((c) => {
        const key = c.unified || "Other";
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(c);
    });

    console.log(`Total Categories: ${allCategories.length}`);
    console.log(`Unified Groups: ${Object.keys(grouped).length}`);
    console.log("------------------------------------------------");

    Object.keys(grouped).forEach((key) => {
        console.log(`\nGroup: ${key} (${grouped[key].length} items)`);
        if (key === "Other") {
            // Print details for Other to help user/me fix them
            grouped[key].forEach((c) => {
                console.log(`  - [${c.provider}] ${c.original} (${c.en}) [${c.product_count} products]`);
            });
        } else {
            // Just summary for defined groups
            console.log(
                `  (Examples: ${grouped[key]
                    .slice(0, 3)
                    .map((c) => c.en || c.original)
                    .join(", ")}...)`,
            );
        }
    });
}

function countProductsForCategory(products, catId) {
    if (!products) return 0;
    return products.filter((p) => p.category_id === catId).length;
}

analyze();
