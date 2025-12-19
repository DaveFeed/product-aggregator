const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://www.carrefour.am";

async function scrape() {
    const config = process.env.JOB_CONFIG
        ? JSON.parse(process.env.JOB_CONFIG)
        : {
              base_url: BASE_URL,
              output_dir: "./data",
          };

    const outputDir = path.resolve(config.output_dir || "./data");
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`Starting scrape for ${BASE_URL}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    try {
        console.log(`Navigating to ${BASE_URL}/en...`);
        await page.goto(`${BASE_URL}/en`);
        await page.waitForLoadState("domcontentloaded");

        // 1. Get Main Categories
        // Using nav menu or slider. Let's try to get from menu if possible, or common slider links.
        // Selector for top nav items: ul.ui-menu > li.level0
        // But subagent used slider. Let's try to find "Everyday Products" menu or links.
        // Let's use a broad selector for category links that contain '/everyday-products/'

        // Attempting to open menu or find visible links.
        // Let's grab links from the main navigation "Everyday Products" if it exists, or just find all category links on home.
        // A robust way mapping: a.category-item-link ? Or just hrefs.

        // Subagent found links like: https://www.carrefour.am/en/everyday-products/meat-and-meat-products
        // We can fetch all links starting with /en/everyday-products/ and filtering for depth.

        // Let's grab all links on homepage and filter.
        const hrefs = await page.$$eval("a", (as) => as.map((a) => a.href));

        // Filter for category-like URLs
        // Typical pattern: /en/everyday-products/[category-slug]
        // Avoid product links (usually have .html? or just deeper?)
        // Actually Carrefour structure: /en/everyday-products/meat-and-meat-products
        // Products: /en/everyday-products/meat-and-meat-products/pork-fillet-tgt-frozen-approx-500g.html (often ends in .html)

        const categoryLinks = new Set();
        hrefs.forEach((href) => {
            if (href.includes("/everyday-products/") && !href.endsWith(".html")) {
                // Determine depth
                // Format: .../everyday-products/[category]
                // We want to avoid .../everyday-products/[category]/[subcategory]
                const relativePath = href.split("/everyday-products/")[1];
                if (!relativePath) return; // Main page

                // Check for slashes. If no slashes (or just trailing), it's depth 1.
                // "meat-products" -> depth 1
                // "meat-products/" -> depth 1
                // "meat-products/pork" -> depth 2

                const cleanPath = relativePath.replace(/\/$/, ""); // Remove trailing slash
                if (!cleanPath.includes("/")) {
                    categoryLinks.add(href);
                }
            }
        });

        const categories = Array.from(categoryLinks).map((url) => ({
            url: url,
            name: url.split("/").pop().replace(/-/g, " "), // naive name extraction
        }));

        console.log(`Found ${categories.length} potential categories.`);

        const allProducts = [];
        const visitedUrls = new Set();

        for (const cat of categories) {
            if (visitedUrls.has(cat.url)) continue;
            visitedUrls.add(cat.url);

            console.log(`Processing Category: ${cat.name} (${cat.url})`);

            try {
                await page.goto(cat.url);
                await page.waitForLoadState("domcontentloaded");

                // Check for Subcategories?
                // Carrefour might show products directly or subcats.
                // If products present, scrape.
                // Pagination loop

                let hasNextPage = true;
                let pageNum = 1;

                while (hasNextPage) {
                    console.log(`  Scraping Page ${pageNum}...`);

                    // Wait for products
                    try {
                        await page.waitForSelector("li.product-item", { timeout: 5000 });
                    } catch (e) {
                        console.log("    No products found on this page.");
                        break;
                    }

                    const items = await page.$$("li.product-item");
                    console.log(`    Found ${items.length} items.`);

                    for (const item of items) {
                        try {
                            const titleEl = await item.$("a.product-item-link");
                            const title = titleEl ? (await titleEl.innerText()).trim() : "";
                            const url = titleEl ? await titleEl.getAttribute("href") : "";

                            const priceEl = await item.$(".price");
                            const priceText = priceEl ? await priceEl.innerText() : "";
                            // Price: "3 390 ֏"
                            let price = priceText.replace(/[^\d.]/g, "").replace(/\./g, ""); // "3390"
                            // Handle decimals if needed? usually int in AMD.
                            // Wait, replace . if thousands separator? formatted like 3,390?
                            // Subagent saw "3,390". So replace ",".
                            // Let's just keep digits.

                            const unitEl = await item.$(".price-unit-description");
                            // e.g. "/ kg" or "/ pcs"
                            let unitText = unitEl ? await unitEl.innerText() : "";
                            let unit = unitText.replace("/", "").trim() || "1 pcs";

                            const imgEl = await item.$("a.product-item-photo img");
                            const img = imgEl ? await imgEl.getAttribute("src") : "";

                            if (title && price && url) {
                                allProducts.push({
                                    category_name: cat.name,
                                    category_url: cat.url,
                                    title: title,
                                    price: price,
                                    unit: unit,
                                    image_url: img,
                                    product_url: url,
                                    currency: "AMD",
                                });
                            }
                        } catch (err) {}
                    }

                    // Check Next Page
                    const nextBtn = await page.$("a.action.next");
                    if (nextBtn) {
                        // Check if next button is visible/enabled?
                        // Usually exists if next page.
                        const nextUrl = await nextBtn.getAttribute("href");
                        if (nextUrl) {
                            await page.goto(nextUrl);
                            await page.waitForLoadState("domcontentloaded");
                            pageNum++;
                        } else {
                            hasNextPage = false;
                        }
                    } else {
                        hasNextPage = false;
                    }

                    // Safety break
                    if (pageNum > 20) hasNextPage = false;
                }
            } catch (e) {
                console.error(`Error processing cat ${cat.name}: ${e.message}`);
            }
        }

        // Save
        const outputPath = path.join(outputDir, "products_carrefour_am.json");
        fs.writeFileSync(outputPath, JSON.stringify(allProducts, null, 2), "utf-8");
        console.log(`Scraped total ${allProducts.length} items. Saved to ${outputPath}`);
    } catch (err) {
        console.error(`Global error: ${err.message}`);
    } finally {
        await browser.close();
    }
}

if (require.main === module) {
    scrape();
}

module.exports = scrape;
