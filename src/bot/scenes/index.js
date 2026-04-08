const { Scenes } = require("telegraf");
const stage = new Scenes.Stage([
    require("./home.scene"),
    require("./search.scene"),
    require("./catalog.scene"),
    require("./settings.scene"),
]);

module.exports = stage;
