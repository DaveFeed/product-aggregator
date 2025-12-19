const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://www.parma.am";

async function scrape() {
    // Load config
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
        console.log(`Navigating to ${BASE_URL}/en to find categories...`);
        await page.goto(`${BASE_URL}/en`);
        await page.waitForLoadState("domcontentloaded");

        // 1. Get Main Categories from Homepage
        const categoryLinks = await page.$$("a.popular--category-item");
        const categories = [];

        for (const link of categoryLinks) {
            let url = await link.getAttribute("href");
            const nameEl = await link.$(".popular--category-item-text");
            const name = nameEl ? await nameEl.innerText() : await link.innerText();

            if (url && !url.includes("javascript")) {
                if (!url.startsWith("http")) url = BASE_URL + url;
                categories.push({ name: name.trim(), url: url });
            }
        }
        console.log(`Found ${categories.length} main categories.`);

        const allProducts = [];

        // 2. Iterate Main Categories
        for (const mainCat of categories) {
            console.log(`Processing Main Category: ${mainCat.name} (${mainCat.url})`);

            try {
                await page.goto(mainCat.url);
                await page.waitForLoadState("domcontentloaded");

                // 3. Find Sub-categories
                const subCatLinks = await page.$$("a.menu_sections_item");
                let subCategories = [];

                for (const link of subCatLinks) {
                    let url = await link.getAttribute("href");
                    const name = await link.innerText();
                    if (url && !url.startsWith("http")) url = BASE_URL + url;
                    subCategories.push({
                        name: name.trim(),
                        url: url,
                        parent: mainCat.name,
                    });
                }

                if (subCategories.length === 0) {
                    subCategories.push({
                        name: mainCat.name,
                        url: mainCat.url,
                        parent: mainCat.name,
                    });
                }

                console.log(`Found ${subCategories.length} sub-categories in ${mainCat.name}`);

                for (const subCat of subCategories) {
                    console.log(`  Scraping Sub-category: ${subCat.name} (${subCat.url})`);
                    await page.goto(subCat.url);
                    await page.waitForLoadState("domcontentloaded");

                    try {
                        await page.waitForSelector("a.product_image", { timeout: 3000 });
                    } catch (e) {
                        console.log("    No products found (timeout).");
                        continue;
                    }

                    // 4. Scrape Products
                    let productElements = await page.$$("div.item-block");

                    if (productElements.length === 0) {
                        console.log("    'item-block' selector failed, trying fallback via product_image...");
                        productElements = await page.$$("a.product_image");
                    }

                    console.log(`    Found ${productElements.length} products.`);

                    for (const el of productElements) {
                        try {
                            let container = el;
                            const tagName = await el.evaluate((e) => e.tagName.toLowerCase());
                            if (tagName === "a") {
                                const parent = await el.$("xpath=..");
                                if (parent) container = parent;
                            }

                            // Title
                            const nameLink = await container.$("a.item_name");
                            const title = nameLink ? (await nameLink.innerText()).trim() : "";
                            const productUrlRel = nameLink ? await nameLink.getAttribute("href") : "";
                            const productUrl = productUrlRel
                                ? productUrlRel.startsWith("http")
                                    ? productUrlRel
                                    : BASE_URL + productUrlRel
                                : subCat.url;

                            // Image
                            let imgEl = await container.$("a.product_image img");
                            if (!imgEl && tagName === "a") {
                                imgEl = await container.$("img");
                            }

                            let imageUrl = "";
                            if (imgEl) {
                                imageUrl =
                                    (await imgEl.getAttribute("src")) || (await imgEl.getAttribute("data-src")) || "";
                                if (imageUrl && !imageUrl.startsWith("http")) imageUrl = BASE_URL + imageUrl;
                            }

                            // Price
                            const text = await container.innerText();
                            let price = "N/A";
                            let unit = "1 pcs";

                            const priceMatch = text.match(/([\d,.\s]+)\s*֏/);
                            if (priceMatch) {
                                price = priceMatch[1].replace(/\s/g, "");
                            }

                            const unitMatch = title.match(/(\d+(\.\d+)?)\s*(kg|g|pcs|l|ml|կգ|գ|լ|մլ|հատ)/i);
                            if (unitMatch) {
                                unit = unitMatch[0];
                            }

                            allProducts.push({
                                category_name: subCat.name,
                                category_url: subCat.url,
                                parent_category: mainCat.name,
                                title: title,
                                price: price,
                                unit: unit,
                                image_url: imageUrl,
                                product_url: productUrl,
                                add_to_cart_selector: "",
                            });
                        } catch (err) {
                            // ignore bad item
                        }
                    }
                }
            } catch (e) {
                console.error(`Error processing category ${mainCat.name}: ${e.message}`);
            }
        }

        // Save
        const outputPath = path.join(outputDir, "products_parma_am.json");
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
