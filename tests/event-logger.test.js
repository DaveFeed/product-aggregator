const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

describe("EventLogger", () => {
    let knex, EventLogger, testUserId;

    before(async () => {
        require("dotenv").config();
        const Knex = require("knex");
        const { Model } = require("objection");
        const knexConfig = require("../knexfile");
        knex = Knex(knexConfig[process.env.NODE_ENV || "development"]);
        Model.knex(knex);
        EventLogger = require("../src/services/EventLogger");

        // Create a real test user to satisfy FK constraint.
        const [row] = await knex("users")
            .insert({ telegram_id: "evtlog_test_" + Date.now(), first_name: "EvtTest" })
            .returning("id");
        testUserId = row.id;
    });

    after(async () => {
        if (testUserId) {
            await knex("user_events").where("user_id", testUserId).del();
            await knex("users").where("id", testUserId).del();
        }
        // Destroy both the test knex and the singleton from database/connection.
        try {
            const connKnex = require("../src/database/connection");
            await connKnex.destroy();
        } catch {}
        await knex.destroy();
    });

    it("logs a search event without throwing", async () => {
        await EventLogger.log({
            userId: testUserId,
            eventType: "search",
            query: "milk",
            metadata: { source: "test" },
        });
        const rows = await knex("user_events")
            .where({ user_id: testUserId, event_type: "search" });
        assert.ok(rows.length >= 1, "should insert at least one search event");
    });

    it("logs a view event with product_id", async () => {
        await EventLogger.log({
            userId: testUserId,
            eventType: "view",
            productId: 1,
        });
        const rows = await knex("user_events")
            .where({ user_id: testUserId, event_type: "view" });
        assert.ok(rows.length >= 1);
    });

    it("logs an add_to_cart event", async () => {
        await EventLogger.log({
            userId: testUserId,
            eventType: "add_to_cart",
            productId: 42,
        });
        const rows = await knex("user_events")
            .where({ user_id: testUserId, event_type: "add_to_cart" });
        assert.ok(rows.length >= 1);
    });

    it("logs a purchase event", async () => {
        await EventLogger.log({
            userId: testUserId,
            eventType: "purchase",
            productId: 42,
        });
        const rows = await knex("user_events")
            .where({ user_id: testUserId, event_type: "purchase" });
        assert.ok(rows.length >= 1);
    });

    it("does not throw when DB insert fails (fire-and-forget)", async () => {
        // Invalid event_type should be caught silently by the CHECK constraint.
        await assert.doesNotReject(async () => {
            await EventLogger.log({
                userId: testUserId,
                eventType: "invalid_type_that_will_fail",
                metadata: { source: "test" },
            });
        });
    });
});
