const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://yerevan-city.am";

// Simple test - scrape one category
async function testScrape() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        console.log("Testing with category ID 22...");
        await page.goto(`${BASE_URL}/shop/products/22`);
        await page.waitForTimeout(3000);

        // Scroll to load all products
        let count = 0;
        for (let i = 0; i < 10; i++) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(2000);
            const newCount = await page.$$eval("a.P-padding-products", (els) => els.length);
            console.log(`Scroll ${i + 1}: Found ${newCount} products`);
            if (newCount === count) break;
            count = newCount;
        }

        // Scrape products
        const products = await page.$$eval("a.P-padding-products", (links) => {
            return links.map((link) => {
                const subcategoryEl = link.querySelector("span");
                const subcategory = subcategoryEl ? subcategoryEl.innerText.trim() : "";

                const pTags = link.querySelectorAll("p");
                let title = "";
                for (const p of pTags) {
                    if (!p.querySelector("span")) {
                        title = p.innerText.trim();
                        break;
                    }
                }

                const priceEl = link.querySelector("p span");
                const price = priceEl ? priceEl.innerText.trim() : "N/A";

                const imgContainer = link.querySelector("div > div > div");
                let imageUrl = "";
                if (imgContainer) {
                    const bgImage = window.getComputedStyle(imgContainer).backgroundImage;
                    if (bgImage && bgImage !== "none") {
                        const match = bgImage.match(/url\(["']?([^"']*)["']?\)/);
                        if (match) imageUrl = match[1];
                    }
                }

                const productUrl = link.getAttribute("href");

                return { subcategory, title, price, imageUrl, productUrl };
            });
        });

        console.log(`\nScraped ${products.length} products`);
        console.log("Sample product:", JSON.stringify(products[0], null, 2));

        fs.writeFileSync("./data/test_yerevan_city.json", JSON.stringify(products, null, 2));
        console.log("Saved to ./data/test_yerevan_city.json");
    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        await browser.close();
    }
}

testScrape();
