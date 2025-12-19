const Knex = require("knex");
const { Model } = require("objection");
const knexConfig = require("../../knexfile");

const knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
Model.knex(knex);

module.exports = knex;
