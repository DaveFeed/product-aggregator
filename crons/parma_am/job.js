const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://www.parma.am";

function cleanCategoryName(raw) {
    if (!raw) return "";
    // Parma decorates subcategory links with a leading count badge inside the <a>:
    // "143\n\nVegetables". Strip leading digits + whitespace (including newlines).
    return raw.replace(/^\s*\d+\s+/s, "").replace(/\s+/g, " ").trim();
}

function extractUnitFromTitle(title) {
    if (!title) return "";
    // Prefer the last numeric-unit match — product size tends to trail the title.
    const matches = [
        ...title.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|g|pcs|l|ml|կգ|գ|լ|մլ|հատ|кг|г|л|мл|шт)(?![\p{L}])/gimu),
    ];
    if (matches.length) return matches[matches.length - 1][0];
    // Heuristic: naked "kg" suffix — treat as per-kg pricing without a quantity
    if (/\bkg\b/i.test(title) || /\s*կգ\b/i.test(title) || /\s*кг\b/i.test(title)) return "per kg";
    return "";
}

async function scrape() {
    const config = process.env.JOB_CONFIG
        ? JSON.parse(process.env.JOB_CONFIG)
        : { base_url: BASE_URL, output_dir: "./data" };

    const outputDir = path.resolve(config.output_dir || "./data");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const targetCategory = process.argv.find((arg) => arg.startsWith("--category="));
    const limitArg = process.argv.find((a) => a.startsWith("--limit="));
    const productLimit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;

    console.log(`Starting scrape for ${BASE_URL}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    const stats = { productsScraped: 0, productsFailed: 0 };

    try {
        console.log(`Navigating to ${BASE_URL}/en to find categories...`);
        await page.goto(`${BASE_URL}/en`);
        await page.waitForLoadState("domcontentloaded");

        // Main categories
        const categoryLinks = await page.$$("a.popular--category-item");
        const categories = [];
        for (const link of categoryLinks) {
            let url = await link.getAttribute("href");
            const nameEl = await link.$(".popular--category-item-text");
            const rawName = nameEl ? await nameEl.innerText() : await link.innerText();
            const name = cleanCategoryName(rawName);
            if (url && !url.includes("javascript") && name) {
                if (!url.startsWith("http")) url = BASE_URL + url;
                categories.push({ name, url });
            }
        }
        console.log(`Found ${categories.length} main categories.`);

        let mainCategoriesToScrape = categories;
        if (targetCategory) {
            const categoryName = targetCategory.split("=")[1];
            console.log(`Filtering for category: ${categoryName}`);
            mainCategoriesToScrape = categories.filter((c) => c.name === categoryName);
            if (mainCategoriesToScrape.length === 0) {
                console.error(`Category '${categoryName}' not found. Available: ${categories.map((c) => c.name).join(", ")}`);
                return;
            }
        }

        const allProducts = [];
        const seenProductUrls = new Set();

        for (const mainCat of mainCategoriesToScrape) {
            if (productLimit > 0 && stats.productsScraped >= productLimit) break;
            console.log(`Processing Main Category: ${mainCat.name} (${mainCat.url})`);

            try {
                await page.goto(mainCat.url);
                await page.waitForLoadState("domcontentloaded");

                const subCatLinks = await page.$$("a.menu_sections_item");
                let subCategories = [];

                for (const link of subCatLinks) {
                    let url = await link.getAttribute("href");
                    const rawName = await link.innerText();
                    const name = cleanCategoryName(rawName);
                    if (!url || !name) continue;
                    if (!url.startsWith("http")) url = BASE_URL + url;
                    subCategories.push({ name, url, parent: mainCat.name });
                }

                if (subCategories.length === 0) {
                    subCategories.push({ name: mainCat.name, url: mainCat.url, parent: mainCat.name });
                }
                console.log(`Found ${subCategories.length} sub-categories in ${mainCat.name}`);

                for (const subCat of subCategories) {
                    if (productLimit > 0 && stats.productsScraped >= productLimit) break;
                    console.log(`  Scraping Sub-category: ${subCat.name} (${subCat.url})`);
                    await page.goto(subCat.url);
                    await page.waitForLoadState("domcontentloaded");

                    try {
                        await page.waitForSelector("a.product_image", { timeout: 3000 });
                    } catch (e) {
                        console.log("    No products found (timeout).");
                        continue;
                    }

                    let productElements = await page.$$("div.item-block");
                    if (productElements.length === 0) {
                        console.log("    'item-block' selector failed, trying fallback via product_image...");
                        productElements = await page.$$("a.product_image");
                    }
                    console.log(`    Found ${productElements.length} products.`);

                    for (const el of productElements) {
                        if (productLimit > 0 && stats.productsScraped >= productLimit) break;
                        try {
                            let container = el;
                            const tagName = await el.evaluate((e) => e.tagName.toLowerCase());
                            if (tagName === "a") {
                                const parent = await el.$("xpath=..");
                                if (parent) container = parent;
                            }

                            const nameLink = await container.$("a.item_name");
                            const title = nameLink ? (await nameLink.innerText()).trim() : "";
                            const productUrlRel = nameLink ? await nameLink.getAttribute("href") : "";
                            const productUrl = productUrlRel
                                ? productUrlRel.startsWith("http")
                                    ? productUrlRel
                                    : BASE_URL + productUrlRel
                                : subCat.url;

                            // Dedup across subcategories by product_url: same product often
                            // appears in multiple subcategories on Parma.
                            if (seenProductUrls.has(productUrl)) continue;

                            let imgEl = await container.$("a.product_image img");
                            if (!imgEl && tagName === "a") imgEl = await container.$("img");
                            let imageUrl = "";
                            if (imgEl) {
                                imageUrl =
                                    (await imgEl.getAttribute("src")) || (await imgEl.getAttribute("data-src")) || "";
                                if (imageUrl && !imageUrl.startsWith("http")) imageUrl = BASE_URL + imageUrl;
                            }

                            const text = await container.innerText();
                            let price = null;
                            const priceMatch = text.match(/([\d,.\s]+)\s*֏/);
                            if (priceMatch) price = priceMatch[1].replace(/[\s,]/g, "");
                            if (!price || parseFloat(price) <= 0) {
                                stats.productsFailed++;
                                continue;
                            }

                            const unit = extractUnitFromTitle(title);

                            // Extract external product ID from URL slug suffix "_NNNNN"
                            const extIdMatch = productUrl.match(/_(\d+)(?:$|[?#])/);
                            const externalId = extIdMatch ? extIdMatch[1] : null;

                            if (!title) {
                                stats.productsFailed++;
                                continue;
                            }

                            seenProductUrls.add(productUrl);
                            allProducts.push({
                                category_name: subCat.name,
                                category_url: subCat.url,
                                parent_category: mainCat.name,
                                title,
                                price,
                                unit,
                                image_url: imageUrl,
                                product_url: productUrl,
                                external_product_id: externalId,
                                add_to_cart_selector: "",
                            });
                            stats.productsScraped++;
                        } catch (err) {
                            stats.productsFailed++;
                        }
                    }
                }
            } catch (e) {
                console.error(`Error processing category ${mainCat.name}: ${e.message}`);
            }
        }

        const outputPath = path.join(
            outputDir,
            targetCategory ? `products_${targetCategory.split("=")[1]}.json` : "products_parma_am.json"
        );
        fs.writeFileSync(outputPath, JSON.stringify(allProducts, null, 2), "utf-8");
        console.log(
            `Scraped total ${allProducts.length} items (failed: ${stats.productsFailed}, duplicates skipped: ${seenProductUrls.size - allProducts.length + stats.productsFailed}). Saved to ${outputPath}`
        );
    } catch (err) {
        console.error(`Global error: ${err.message}`);
    } finally {
        await browser.close();
    }
}

if (require.main === module) scrape();

module.exports = scrape;
