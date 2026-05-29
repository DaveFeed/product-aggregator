const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://yerevan-city.am";

async function scrape() {
    const config = process.env.JOB_CONFIG
        ? JSON.parse(process.env.JOB_CONFIG)
        : { base_url: BASE_URL, output_dir: "./data" };

    const outputDir = path.resolve(config.output_dir || "./data");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const targetCategory = process.argv.find((arg) => arg.startsWith("--category="));
    const limitArg = process.argv.find((a) => a.startsWith("--limit="));
    const productLimit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;

    console.log(`Starting scrape for ${config.base_url}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    const stats = { productsScraped: 0, productsFailed: 0, priceParseFailed: 0 };

    try {
        console.log(`Navigating to ${BASE_URL}/shop/categories to find categories...`);
        await page.goto(`${BASE_URL}/shop/categories`);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(3000);

        // On /shop/categories each category tile is wrapped in <a href="/shop/products/{id}">
        // containing a <p> with the human-readable category name. Dedup by href because
        // the page lists categories twice (desktop + mobile layouts).
        const rawCategories = await page.$$eval("a[href^='/shop/products/']", (els) =>
            els
                .map((el) => {
                    const href = el.getAttribute("href");
                    const match = href && href.match(/^\/shop\/products\/(\d+)$/);
                    if (!match) return null;
                    // Prefer <p> inside; fallback to trimmed text content.
                    const p = el.querySelector("p");
                    const name = (p ? p.innerText : el.textContent || "").trim();
                    return name ? { href, categoryId: match[1], name } : null;
                })
                .filter(Boolean)
        );

        const uniqueByHref = new Map();
        for (const c of rawCategories) if (!uniqueByHref.has(c.href)) uniqueByHref.set(c.href, c);
        const finalCategories = Array.from(uniqueByHref.values()).map((c) => ({
            name: c.name,
            url: `${BASE_URL}${c.href}`,
        }));

        console.log(`Found ${finalCategories.length} categories.`);

        let categoriesToScrape = finalCategories;
        if (targetCategory) {
            const categoryName = targetCategory.split("=")[1];
            console.log(`Filtering for category: ${categoryName}`);
            categoriesToScrape = finalCategories.filter((c) => c.name === categoryName);
            if (categoriesToScrape.length === 0) {
                console.error(`Category '${categoryName}' not found!`);
                return;
            }
        }

        const allProducts = [];

        for (let i = 0; i < categoriesToScrape.length; i++) {
            const category = categoriesToScrape[i];
            console.log(
                `[${i + 1}/${categoriesToScrape.length}] Scraping category: ${category.name} (${category.url})`,
            );

            try {
                await page.goto(category.url);
                await page.waitForLoadState("domcontentloaded");
                await page.waitForTimeout(2000);
            } catch (e) {
                console.error(`Failed to load category ${category.name}: ${e.message}`);
                continue;
            }

            // Infinite scroll to load all products
            let previousProductCount = 0;
            let scrollAttempts = 0;
            const maxScrollAttempts = 20;

            console.log("  Loading products via infinite scroll...");
            while (scrollAttempts < maxScrollAttempts) {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(2000);
                const currentProductCount = await page.$$eval("a.P-padding-products", (els) => els.length);
                console.log(`  Scroll ${scrollAttempts + 1}: Found ${currentProductCount} products`);
                if (currentProductCount === previousProductCount) break;
                previousProductCount = currentProductCount;
                scrollAttempts++;
            }

            const productLinks = await page.$$("a.P-padding-products");
            console.log(`  Scraping ${productLinks.length} products...`);

            for (let j = 0; j < productLinks.length; j++) {
                if (productLimit > 0 && stats.productsScraped >= productLimit) break;
                try {
                    const link = productLinks[j];

                    let productUrl = await link.getAttribute("href");
                    if (productUrl && !productUrl.startsWith("http")) productUrl = BASE_URL + productUrl;

                    const productData = await link.evaluate((el) => {
                        // Promo badge (was mis-stored as "subcategory"); the first <span> holds "-13%" / "GLUTEN FREE" / etc.
                        const badgeEl = el.querySelector("span");
                        const promoBadge = badgeEl ? badgeEl.innerText.trim() : "";

                        // Title: <p> that does NOT contain a <span> (price wrappers have span children).
                        const pTags = el.querySelectorAll("p");
                        let title = "";
                        for (const p of pTags) {
                            if (!p.querySelector("span")) {
                                title = p.innerText.trim();
                                break;
                            }
                        }

                        // Prices: the price <p> holds both original and sale when on sale.
                        // Sale price: <span> inside the price <p>. Original: the <p>'s own text minus the span.
                        const priceP = el.querySelector("p:has(span)") || el.querySelector("p span")?.closest("p");
                        let currentPrice = null;
                        let originalPrice = null;
                        if (priceP) {
                            const span = priceP.querySelector("span");
                            if (span) {
                                currentPrice = span.innerText.trim();
                                // Text of <p> minus span text = original price text (may include \n separators)
                                const full = priceP.innerText;
                                const parts = full
                                    .split("\n")
                                    .map((s) => s.trim())
                                    .filter(Boolean);
                                // parts contains both numbers. If there are 2 parts, the one NOT equal to currentPrice is original.
                                if (parts.length >= 2) {
                                    const other = parts.find((p) => p !== currentPrice);
                                    if (other) originalPrice = other;
                                } else if (parts.length === 1) {
                                    currentPrice = parts[0];
                                }
                            } else {
                                currentPrice = priceP.innerText.trim();
                            }
                        }

                        // Unit from title regex. Prefer the LAST match — product size typically
                        // trails the title (e.g. "Коньяк Komitas 60л (кор.) 0.75л" → "0.75л", not "60л").
                        let unit = "";
                        const unitMatches = [
                            ...title.matchAll(
                                /(\d+(?:[.,]\d+)?)\s*(kg|g|pcs|l|ml|кг|г|л|мл|шт|կգ|գ|լ|մլ|հատ)(?![\p{L}])/gimu,
                            ),
                        ];
                        if (unitMatches.length) unit = unitMatches[unitMatches.length - 1][0];

                        // Image: try background-image first, then <img>.
                        const imgContainer = el.querySelector("div > div > div");
                        let imageUrl = "";
                        if (imgContainer) {
                            const bgImage = window.getComputedStyle(imgContainer).backgroundImage;
                            if (bgImage && bgImage !== "none") {
                                const m = bgImage.match(/url\(["']?([^"']*)["']?\)/);
                                if (m) imageUrl = m[1];
                            }
                            if (!imageUrl) {
                                const imgEl = imgContainer.querySelector("img");
                                if (imgEl) imageUrl = imgEl.src || imgEl.getAttribute("data-src") || "";
                            }
                        }

                        return { promoBadge, title, currentPrice, originalPrice, unit, imageUrl };
                    });

                    let imageUrl = productData.imageUrl;
                    if (imageUrl && !imageUrl.startsWith("http")) imageUrl = BASE_URL + imageUrl;

                    if (!productData.title || !productData.currentPrice) {
                        stats.productsFailed++;
                        continue;
                    }

                    allProducts.push({
                        category_name: category.name,
                        category_url: category.url,
                        promo_badge: productData.promoBadge,
                        title: productData.title,
                        price: productData.currentPrice,
                        original_price: productData.originalPrice,
                        unit: productData.unit,
                        image_url: imageUrl,
                        product_url: productUrl,
                    });
                    stats.productsScraped++;

                    if ((j + 1) % 50 === 0) console.log(`    Scraped ${j + 1}/${productLinks.length} products...`);
                } catch (e) {
                    stats.productsFailed++;
                    console.error(`  Error scraping product: ${e.message}`);
                }
            }

            console.log(`Finished category ${category.name}. Total products: ${productLinks.length}`);

            const outputPath = path.join(
                outputDir,
                targetCategory ? `products_${targetCategory.split("=")[1]}.json` : "products_yerevan_city.json",
            );
            fs.writeFileSync(outputPath, JSON.stringify(allProducts, null, 2), "utf-8");
        }

        const finalOutputPath = path.join(
            outputDir,
            targetCategory ? `products_${targetCategory.split("=")[1]}.json` : "products_yerevan_city.json",
        );
        fs.writeFileSync(finalOutputPath, JSON.stringify(allProducts, null, 2), "utf-8");
        console.log(
            `Scraped total ${allProducts.length} products (failed: ${stats.productsFailed}). Saved to ${finalOutputPath}`,
        );
    } catch (err) {
        console.error(`Global error: ${err.message}`);
        console.error(err.stack);
    } finally {
        await browser.close();
    }
}

if (require.main === module) scrape();

module.exports = scrape;
