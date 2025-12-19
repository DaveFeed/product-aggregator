const { Scenes } = require("telegraf");
const homeScene = require("./home.scene");
const searchScene = require("./search.scene");
const catalogScene = require("./catalog.scene");
const settingsScene = require("./settings.scene");

const stage = new Scenes.Stage([homeScene, searchScene, catalogScene, settingsScene]);

module.exports = stage;
