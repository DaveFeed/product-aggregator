const { Markup } = require("telegraf");

const formatPrice = (price) => {
    if (!price) return "N/A";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "AMD",
        maximumFractionDigits: 0,
    })
        .format(Number(price))
        .replace("AMD", "֏");
};

const createPaginationKeyboard = (page, totalPages, actionPrefix) => {
    const buttons = [];

    if (page > 1) {
        buttons.push(Markup.button.callback("⬅️ Prev", `${actionPrefix}:prev:${page}`));
    }

    buttons.push(Markup.button.callback(`Page ${page}/${totalPages}`, "noop")); // Label only, maybe refresh?

    // Refresh button separate? Or middle is info?
    // User asked for [Next] [Refresh] [Back]
    // Let's create a row for nav and a row for refresh/back

    if (page < totalPages) {
        buttons.push(Markup.button.callback("Next ➡️", `${actionPrefix}:next:${page}`));
    }

    return buttons;
};

// Returns [ [Prev, Info, Next], [Refresh, Back] ]
const createCatalogKeyboard = (page, totalPages, categoryId) => {
    const navRow = [];
    if (page > 1) navRow.push(Markup.button.callback("⬅️", `catalog_nav:${categoryId}:${page - 1}`));
    navRow.push(Markup.button.callback(`${page}/${totalPages}`, "noop"));
    if (page < totalPages) navRow.push(Markup.button.callback("➡️", `catalog_nav:${categoryId}:${page + 1}`));

    const actionRow = [
        Markup.button.callback("🔄 Refresh", `catalog_nav:${categoryId}:${page}`),
        Markup.button.callback("🔙 Back", `catalog_back:${categoryId}`),
    ];

    return [navRow, actionRow];
};

const escapeMarkdown = (text) => {
    if (!text) return "";
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
};

module.exports = {
    formatPrice,
    createCatalogKeyboard,
    escapeMarkdown,
};
