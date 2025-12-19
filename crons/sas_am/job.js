const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://www.sas.am";

async function handleAgeVerification(page) {
    try {
        const yesButton = await page.$(".js-yes-button");
        if (yesButton && (await yesButton.isVisible())) {
            console.log("  Found age verification popup. Clicking 'Yes'...");
            await yesButton.click();
            // Wait for it to disappear
            await page.waitForTimeout(500);
        }
    } catch (e) {
        console.log("  Error checking age verification: " + e.message);
    }
}

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

    console.log(`Starting scrape for ${config.base_url}`);

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

        // Extract categories
        const categoryLinks = await page.$$("a.main-menu__link-level-3");
        const categories = [];
        const seenUrls = new Set();

        for (const link of categoryLinks) {
            let url = await link.getAttribute("href");
            const name = await link.textContent();

            if (url && !seenUrls.has(url)) {
                if (!url.startsWith("http")) {
                    url = BASE_URL + url;
                }
                categories.push({ name: name.trim(), url: url });
                seenUrls.add(url);
            }
        }

        console.log(`Found ${categories.length} categories.`);

        // Filter categories if argument provided
        const targetCategory = process.argv.find((arg) => arg.startsWith("--category="));
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

                if (productLinks.length === 0) {
                    break;
                }

                for (const link of productLinks) {
                    try {
                        let productUrl = await link.getAttribute("href");
                        if (productUrl && !productUrl.startsWith("http")) {
                            productUrl = BASE_URL + productUrl;
                        }

                        // Find parent element
                        const parent = await link.evaluateHandle(
                            (el) => el.closest(".product") || el.closest(".product-item") || el.parentElement
                        );

                        // Image
                        const imageEl = await parent.$(".product__image");
                        let imageUrl = "";
                        if (imageEl) {
                            imageUrl = await imageEl.getAttribute("data-src");
                            if (!imageUrl) {
                                imageUrl = await imageEl.getAttribute("src");
                            }
                            if (imageUrl && !imageUrl.startsWith("http")) {
                                imageUrl = BASE_URL + imageUrl;
                            }
                        }

                        // Title
                        const titleEl = await parent.$(".product__name");
                        const title = titleEl ? await titleEl.innerText() : "Unknown";

                        // Price extraction using specific selectors
                        let price = "N/A";
                        let unit = "";

                        // Try finding price element
                        const priceEl = await parent.$(".product__price, .price, .product-item__price");
                        if (priceEl) {
                            let rawPrice = await priceEl.innerText();
                            // Fix: Split by '/' or newline to separate price from unit info/other text
                            // "36 420 / 1 kg" -> "36 420 "
                            // "2 950 AMD\n1 pcs" -> "2 950 AMD"
                            const parts = rawPrice.split(/[\n\/]/);
                            if (parts.length > 0) {
                                rawPrice = parts[0];
                            }

                            // Remove non-numeric characters except dots and commas
                            price = rawPrice.replace(/[^\d.,]/g, "").trim();

                            // Handle cases where price might be 0 but valid? No, user said 0 is wrong.
                            // If price is 0, we treat it as N/A unless we verify it's free.
                        }

                        // Try finding unit element
                        const unitEl = await parent.$(".product__unit, .product-item__unit");
                        if (unitEl) {
                            unit = (await unitEl.innerText()).trim();
                        }

                        // Fallback: Parse text if selectors failed or price is 0
                        if (!price || price === "0" || price === "N/A") {
                            const parentText = await parent.innerText();
                            // Try to find a line with AMD that looks like a main price
                            // Avoid "1 kg = 5000 AMD" lines if possible.
                            // This is risky, but better than nothing if selectors fail.
                        }

                        // Add to cart
                        const addToCartBtn = await parent.$(".addTocart");
                        const addToCartSelector = addToCartBtn ? "button.addTocart" : "";

                        // Detail page fallback for missing/zero price
                        if ((!price || price === "0" || price === "") && productUrl) {
                            console.log(`  Price 0/N/A for ${title}. Checking detail page: ${productUrl}`);
                            try {
                                const detailPage = await context.newPage();
                                await detailPage.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

                                const detailPriceEl = await detailPage.$(
                                    ".product__price .price__text, .product__price, .price"
                                );
                                if (detailPriceEl) {
                                    let rawDetailPrice = await detailPage.innerText(".product__price");
                                    const dParts = rawDetailPrice.split(/[\n\/]/);
                                    if (dParts.length > 0) rawDetailPrice = dParts[0];
                                    price = rawDetailPrice.replace(/[^\d.,]/g, "").trim();
                                    console.log(`  Found price on detail page: ${price}`);
                                } else {
                                    console.log("  No price on detail page either.");
                                }
                                await detailPage.close();
                            } catch (err) {
                                console.error(`  Failed to check detail page: ${err.message}`);
                            }
                        }

                        allProducts.push({
                            category_name: category.name,
                            category_url: category.url,
                            title: title.trim(),
                            price: price,
                            unit: unit,
                            image_url: imageUrl,
                            product_url: productUrl,
                            add_to_cart_selector: addToCartSelector,
                        });
                        categoryProductsCount++;
                    } catch (e) {
                        console.error(`  Error scraping a product: ${e.message}`);
                    }
                }

                // Next page
                const nextButton = await page.$("a.pagination__arrow.pagination__arrow--right");
                if (nextButton) {
                    try {
                        // Check for age verification popup overlay before clicking next
                        await handleAgeVerification(page);

                        await nextButton.click();
                        await page.waitForLoadState("networkidle");
                        pageNum++;
                    } catch (e) {
                        // One more try for overlay interference
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
        console.log(`Scraped total ${allProducts.length} products. Saved to ${finalOutputPath}`);
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
