const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const cron = require("node-cron");
const { fork } = require("child_process");
const winston = require("winston");

// Configure logging
const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${message}`;
        }),
    ),
    transports: [new winston.transports.Console(), new winston.transports.File({ filename: "runner.log" })],
});

const CRONS_DIR = path.join(__dirname, "..", "crons");

function loadJobs() {
    if (!fs.existsSync(CRONS_DIR)) {
        logger.error(`Crons directory not found: ${CRONS_DIR}`);
        return;
    }

    const entries = fs.readdirSync(CRONS_DIR, { withFileTypes: true });

    entries.forEach((entry) => {
        if (entry.isDirectory()) {
            const jobDir = path.join(CRONS_DIR, entry.name);
            const configFile = path.join(jobDir, "config.yaml");
            const jobFile = path.join(jobDir, "job.js");

            if (fs.existsSync(configFile) && fs.existsSync(jobFile)) {
                try {
                    const configContent = fs.readFileSync(configFile, "utf8");
                    const config = yaml.load(configContent);

                    if (config.enabled) {
                        logger.info(`Scheduling job: ${config.name} with schedule: ${config.schedule}`);

                        cron.schedule(config.schedule, () => {
                            logger.info(`Starting job: ${config.name}`);

                            const child = fork(jobFile, [], {
                                cwd: jobDir,
                                env: { ...process.env, JOB_CONFIG: JSON.stringify(config) },
                            });

                            child.on("exit", (code) => {
                                logger.info(`Job ${config.name} finished with code ${code}`);
                            });

                            child.on("error", (err) => {
                                logger.error(`Job ${config.name} failed: ${err.message}`);
                            });
                        });
                    } else {
                        logger.info(`Job ${config.name} is disabled.`);
                    }
                } catch (err) {
                    logger.error(`Error loading job in ${entry.name}: ${err.message}`);
                }
            }
        }
    });
}

logger.info("Starting Cron Runner...");
loadJobs();
