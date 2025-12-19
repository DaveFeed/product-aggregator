const { Scenes, Markup } = require("telegraf");
const Category = require("../../models/Category");
const Product = require("../../models/Product");
const { formatPrice, createCatalogKeyboard } = require("../utils");

const catalogScene = new Scenes.BaseScene("catalog");

catalogScene.enter(async (ctx) => {
    await showCategories(ctx, 1);
});

// Action to handle category selection -> Show Products
catalogScene.action(/cat:(\d+)/, async (ctx) => {
    const categoryId = parseInt(ctx.match[1]);
    await ctx.answerCbQuery();
    await showProducts(ctx, categoryId, 1);
});

// Category Pagination
catalogScene.action(/cat_page:(\d+)/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    await ctx.answerCbQuery();
    await showCategories(ctx, page, true);
});

// Product Pagination
catalogScene.action(/prod_page:(\d+):(\d+)/, async (ctx) => {
    const categoryId = parseInt(ctx.match[1]);
    const page = parseInt(ctx.match[2]);
    await ctx.answerCbQuery();
    await showProducts(ctx, categoryId, page, true);
});

// Back from products to category list
catalogScene.action("back_to_cats", async (ctx) => {
    await ctx.answerCbQuery();
    await showCategories(ctx, 1, true); // Go back to page 1 (or state? simple for now)
});

async function showCategories(ctx, page = 1, isEdit = false) {
    const pageSize = 10;
    const offset = (page - 1) * pageSize;

    const cats = await Category.query()
        .orderBy("name", "asc")
        .range(offset, offset + pageSize - 1);

    const total = cats.total;
    const totalPages = Math.ceil(total / pageSize);
    const items = cats.results;

    if (total === 0) {
        return ctx.reply("No categories found.");
    }

    // Build buttons
    const buttons = [];

    // Category items
    items.forEach((c) => {
        buttons.push([Markup.button.callback(`📂 ${c.name}`, `cat:${c.id}`)]);
    });

    // Pagination Controls
    const navRow = [];
    if (page > 1) {
        navRow.push(Markup.button.callback("⬅️ Prev", `cat_page:${page - 1}`));
    }
    if (page < totalPages) {
        navRow.push(Markup.button.callback("Next ➡️", `cat_page:${page + 1}`));
    }
    if (navRow.length > 0) buttons.push(navRow);

    buttons.push([Markup.button.callback("🔙 Main Menu", "exit_catalog")]);

    const title = `Catalog (Page ${page}/${totalPages})`;

    if (isEdit) {
        try {
            await ctx.editMessageText(title, Markup.inlineKeyboard(buttons));
        } catch (e) {}
    } else {
        await ctx.reply(title, Markup.inlineKeyboard(buttons));
    }
}

function escapeMarkdown(text) {
    if (!text) return "";
    return text.replace(/([_*\[\]`])/g, "\\$1");
}

async function showProducts(ctx, categoryId, page, isEdit = false) {
    const pageSize = 10;
    const offset = (page - 1) * pageSize;

    const cat = await Category.query().findById(categoryId);
    const catName = cat ? cat.name : "Products";

    const products = await Product.query()
        .where("category_id", categoryId)
        .orderBy("price", "asc")
        .range(offset, offset + pageSize - 1)
        .withGraphFetched("provider");

    const total = products.total;
    const totalPages = Math.ceil(total / pageSize);
    const items = products.results;

    if (total === 0) {
        if (isEdit)
            await ctx.editMessageText(
                `Category "${catName}" is empty.`,
                Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "back_to_cats")]])
            );
        else await ctx.reply(`Category "${catName}" is empty.`);
        return;
    }

    let message = `*${escapeMarkdown(catName)}* (Page ${page}/${totalPages}):\n\n`;
    items.forEach((p) => {
        const price = formatPrice(p.price);
        const title = escapeMarkdown(p.title);
        const providerName = escapeMarkdown(p.provider.name);
        message += `• [${providerName}] ${title} - ${price}\n`;
        message += `  [Link](${p.fetch_url})\n\n`;
    });

    // Product Pagination
    // Re-use logic but fix callback data format to match regex
    // regex: /prod_page:(\d+):(\d+)/
    const navRow = [];
    if (page > 1) navRow.push(Markup.button.callback("⬅️ Prev", `prod_page:${categoryId}:${page - 1}`));
    if (page < totalPages) navRow.push(Markup.button.callback("Next ➡️", `prod_page:${categoryId}:${page + 1}`));

    const buttons = [];
    if (navRow.length) buttons.push(navRow);
    buttons.push([Markup.button.callback("🔙 Back to Categories", "back_to_cats")]);

    if (isEdit) {
        try {
            await ctx.editMessageText(message, {
                parse_mode: "Markdown",
                disable_web_page_preview: true,
                ...Markup.inlineKeyboard(buttons),
            });
        } catch (e) {
            console.error("Edit error:", e);
        }
    } else {
        await ctx.reply(message, {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
            ...Markup.inlineKeyboard(buttons),
        });
    }
}

catalogScene.action("exit_catalog", (ctx) => {
    ctx.answerCbQuery();
    ctx.scene.leave();
    ctx.scene.enter("home");
});

module.exports = catalogScene;
