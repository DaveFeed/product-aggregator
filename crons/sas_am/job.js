const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://www.sas.am";
const ADD_TO_CART_SELECTOR = "button.addTocart";

async function handleAgeVerification(page) {
    try {
        const yesButton = await page.$(".js-yes-button");
        if (yesButton && (await yesButton.isVisible())) {
            console.log("  Found age verification popup. Clicking 'Yes'...");
            await yesButton.click();
            await page.waitForTimeout(500);
        }
    } catch (e) {
        console.log("  Error checking age verification: " + e.message);
    }
}

function parsePriceLine(line) {
    // Example lines: "36 420 / 1 kg", "2 950 ֏", "1 200 / 1 pc"
    const num = parseFloat((line.match(/([\d\s]+[.,]?\d*)/)?.[1] || "0").replace(/[\s,]/g, ""));
    const lower = line.toLowerCase();
    let kind = null;
    if (/\/\s*1?\s*kg\b/.test(lower) || /kg\b/.test(lower)) kind = "per_kg";
    else if (/\/\s*1?\s*pcs?\b|\/\s*1?\s*hat\b|\bpc\b|\bpcs\b|\bhat\b/.test(lower)) kind = "per_pc";
    return { num, kind };
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

    console.log(`Starting scrape for ${config.base_url}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    const stats = { productsScraped: 0, productsFailed: 0, priceParseFailed: 0 };

    try {
        console.log(`Navigating to ${BASE_URL}/en to find categories...`);
        await page.goto(`${BASE_URL}/en`);
        await page.waitForLoadState("domcontentloaded");

        const categoryLinks = await page.$$("a.main-menu__link-level-3");
        const categories = [];
        const seenUrls = new Set();

        for (const link of categoryLinks) {
            let url = await link.getAttribute("href");
            const name = await link.textContent();
            if (url && !seenUrls.has(url)) {
                if (!url.startsWith("http")) url = BASE_URL + url;
                categories.push({ name: name.trim(), url });
                seenUrls.add(url);
            }
        }
        console.log(`Found ${categories.length} categories.`);

        let categoriesToScrape = categories;
        if (targetCategory) {
            const categoryName = targetCategory.split("=")[1];
            console.log(`Filtering for category: ${categoryName}`);
            categoriesToScrape = categories.filter((c) => c.name === categoryName);
            if (categoriesToScrape.length === 0) {
                console.error(`Category '${categoryName}' not found!`);
                return;
            }
        }

        const allProducts = [];

        for (let i = 0; i < categoriesToScrape.length; i++) {
            const category = categoriesToScrape[i];
            console.log(
                `[${i + 1}/${categoriesToScrape.length}] Scraping category: ${category.name} (${category.url})`
            );

            try {
                await page.goto(category.url);
                await handleAgeVerification(page);
            } catch (e) {
                console.error(`Failed to load category ${category.name}: ${e.message}`);
                continue;
            }

            let pageNum = 1;
            let categoryProductsCount = 0;

            while (true) {
                if (productLimit > 0 && stats.productsScraped >= productLimit) break;
                console.log(`  Scraping page ${pageNum}...`);

                try {
                    await page.waitForLoadState("domcontentloaded");
                    await page.waitForSelector("a.product__cover-link", {
                        state: "attached",
                        timeout: 10000,
                    });
                } catch (e) {
                    console.log("  No products found or timeout on this page.");
                    break;
                }

                const productLinks = await page.$$("a.product__cover-link");
                console.log(`  Found ${productLinks.length} products on page ${pageNum}.`);

                if (productLinks.length === 0) break;

                for (const link of productLinks) {
                    if (productLimit > 0 && stats.productsScraped >= productLimit) break;

                    try {
                        let productUrl = await link.getAttribute("href");
                        if (productUrl && !productUrl.startsWith("http")) productUrl = BASE_URL + productUrl;

                        const parent = await link.evaluateHandle(
                            (el) => el.closest(".product") || el.closest(".product-item") || el.parentElement
                        );

                        // Image
                        const imageEl = await parent.$(".product__image");
                        let imageUrl = "";
                        if (imageEl) {
                            imageUrl = (await imageEl.getAttribute("data-src")) || (await imageEl.getAttribute("src")) || "";
                            if (imageUrl && !imageUrl.startsWith("http")) imageUrl = BASE_URL + imageUrl;
                        }

                        // Title
                        const titleEl = await parent.$(".product__name");
                        const title = titleEl ? (await titleEl.innerText()).trim() : "";
                        if (!title) {
                            stats.productsFailed++;
                            continue;
                        }

                        // Price parsing — clean pipeline instead of the old contradictory logic:
                        //  1. Collect all price lines from the price container.
                        //  2. Classify each as per_kg or per_pc.
                        //  3. Prefer per_pc (pay price when both exist), fall back to per_kg, then raw.
                        let displayPrice = null;
                        const pricingMetadata = {};
                        const priceEl = await parent.$(".product__price, .price, .product-item__price");
                        if (priceEl) {
                            const rawPrice = await priceEl.innerText();
                            const lines = rawPrice
                                .split("\n")
                                .map((l) => l.trim())
                                .filter((l) => l);

                            for (const line of lines) {
                                const { num, kind } = parsePriceLine(line);
                                if (num <= 0) continue;
                                if (kind === "per_kg") pricingMetadata.per_kg = num;
                                else if (kind === "per_pc") pricingMetadata.per_pc = num;
                                else if (displayPrice == null) displayPrice = num;
                            }
                            if (pricingMetadata.per_pc != null) displayPrice = pricingMetadata.per_pc;
                            else if (pricingMetadata.per_kg != null) displayPrice = pricingMetadata.per_kg;

                            if (displayPrice == null) {
                                // Fallback: strip everything but digits/decimal and try to parseFloat.
                                const cleaned = rawPrice.replace(/[^\d.]/g, "");
                                const n = parseFloat(cleaned);
                                if (!isNaN(n) && n > 0) displayPrice = n;
                            }
                        }
                        if (displayPrice == null || displayPrice <= 0) stats.priceParseFailed++;

                        // Unit (display string, e.g. "1 kg")
                        let unit = "";
                        const unitEl = await parent.$(".product__unit, .product-item__unit");
                        if (unitEl) unit = (await unitEl.innerText()).trim();

                        allProducts.push({
                            category_name: category.name,
                            category_url: category.url,
                            title,
                            price: displayPrice != null ? String(displayPrice) : null,
                            unit,
                            image_url: imageUrl,
                            product_url: productUrl,
                            add_to_cart_selector: ADD_TO_CART_SELECTOR,
                            metadata: { pricing: pricingMetadata },
                        });
                        categoryProductsCount++;
                        stats.productsScraped++;
                    } catch (e) {
                        stats.productsFailed++;
                        console.error(`  Error scraping a product: ${e.message}`);
                    }
                }

                // Next page
                const nextButton = await page.$("a.pagination__arrow.pagination__arrow--right");
                if (nextButton) {
                    try {
                        await handleAgeVerification(page);
                        await nextButton.click();
                        await page.waitForLoadState("networkidle");
                        pageNum++;
                    } catch (e) {
                        console.log("  Click failed, retrying after checking popup...");
                        await handleAgeVerification(page);
                        try {
                            await nextButton.click();
                            await page.waitForLoadState("networkidle");
                            pageNum++;
                        } catch (e2) {
                            console.log("  Could not click next page. Finishing category.");
                            break;
                        }
                    }
                } else {
                    break;
                }
            }
            console.log(`Finished category ${category.name}. Total products: ${categoryProductsCount}`);

            // Incremental save
            const outputPath = path.join(
                outputDir,
                targetCategory ? `products_${targetCategory.split("=")[1]}.json` : "products_sas.json"
            );
            fs.writeFileSync(outputPath, JSON.stringify(allProducts, null, 2), "utf-8");
        }

        const finalOutputPath = path.join(
            outputDir,
            targetCategory ? `products_${targetCategory.split("=")[1]}.json` : "products_sas.json"
        );
        fs.writeFileSync(finalOutputPath, JSON.stringify(allProducts, null, 2), "utf-8");
        console.log(
            `Scraped total ${allProducts.length} products (failed: ${stats.productsFailed}, price-parse-failed: ${stats.priceParseFailed}). Saved to ${finalOutputPath}`
        );
    } catch (err) {
        console.error(`Global error: ${err.message}`);
    } finally {
        await browser.close();
    }
}

if (require.main === module) scrape();

module.exports = scrape;
