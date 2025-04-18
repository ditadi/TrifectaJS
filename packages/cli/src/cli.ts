import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import * as dotenv from "dotenv";
import inquirer from "inquirer";
import ora from "ora";
import { type AdapterType, createAdapter } from "./adapters";
import { errorLog, infoLog, plainLog, successLog, warningLog } from "./log";

const SUPPORTED_ADAPTERS: AdapterType[] = ["neon"];

function loadEnv() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const rootDir = dirname(__dirname);

    dotenv.config({ path: join(rootDir, ".env") });
}

loadEnv();

const program = new Command();

program.name("trifecta").description("CLI for TrifectaJS configuration").version("0.1.0");

program
    .command("init")
    .description("Initiliaze TrifectaJS infrastructure")
    .option(
        "-a, --adapter <adapter>",
        `Database adapter to use (${SUPPORTED_ADAPTERS.join(", ")})`,
        "neon",
    )
    .option("-k, --api-key <key>", "Neon API Key")
    .option("-p, --project-id <id>", "Neon project ID")
    .option("-b, --branch-name <n>", "Branch name for TrifectaJS", "trifectajs")
    .option("-f, --force", "Force recreation of branch if it exists")
    .action(async (options) => {
        const spinner = ora("Initializing TrifectaJS...").start();

        try {
            if (!SUPPORTED_ADAPTERS.includes(options.adapter as AdapterType)) {
                spinner.fail(`Unsupported adapter: ${options.adapter}`);
                errorLog(`Supported adapters: ${SUPPORTED_ADAPTERS.join(", ")}`);
                process.exit(1);
            }

            if (options.adapter === "neon") {
                const apiKey = options.apiKey || process.env.NEON_API_KEY;
                const projectId = options.projectId || process.env.NEON_PROJECT_ID;

                if (!apiKey || !projectId) {
                    spinner.stop();

                    const answers = await inquirer.prompt([
                        {
                            type: "input",
                            name: "apiKey",
                            message: "Enter your Neon API Key:",
                            when: !apiKey,
                            validate: (input) => (input ? true : "API Key is required"),
                        },
                        {
                            type: "input",
                            name: "projectId",
                            message: "Enter your Neon project ID:",
                            when: !projectId,
                            validate: (input) => (input ? true : "Project ID is required"),
                        },
                    ]);

                    if (answers.apiKey) options.apiKey = answers.apiKey;
                    if (answers.projectId) options.projectId = answers.projectId;

                    spinner.start("Initializing TrifectaJS...");
                }

                spinner.text = `Creating branch using ${options.adapter} adapter...`;
                const adapterApiKey = options.apiKey || apiKey;
                const adapterProjectId = options.projectId || projectId;

                const adapter = createAdapter("neon", {
                    apiKey: adapterApiKey,
                    projectId: adapterProjectId,
                    branchName: options.branchName,
                    force: options.force,
                });

                const connectionString = await adapter.createBranch(options.branchName);

                spinner.text = "Running migrations...";
                await adapter.runMigrations(connectionString);
                spinner.succeed("TrifectaJS initialized successfully!");
                successLog("\nConnection string for TrifectaJS:");
                infoLog(connectionString);
                warningLog("\nAdd to your .env with the name TRIFECTA_CONNECTION_STRING");
            }
        } catch (err) {
            spinner.fail("Failed to initialize TrifectaJS");
            errorLog(`\nError: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });

program
    .command("migrate")
    .description("Run TrifectaJS migrations")
    .option("-c, --connection <string>", "PostgreSQL/Neon connection string")
    .option(
        "-a, --adapter <adapter>",
        `Database adapter to use (${SUPPORTED_ADAPTERS.join(", ")})`,
        "neon",
    )
    .action(async (options) => {
        const spinner = ora("Preparing migrations...").start();
        try {
            const connectionString = options.connection || process.env.TRIFECTA_CONNECTION_STRING;

            if (!connectionString) {
                spinner.fail("Connection string not provided");
                warningLog("\nUse:");
                plainLog("  - Option --connection");
                plainLog("  - Environment variable TRIFECTA_CONNECTION_STRING");
                process.exit(1);
            }

            if (!SUPPORTED_ADAPTERS.includes(options.adapter as AdapterType)) {
                spinner.fail(`Unsupported adapter: ${options.adapter}`);
                errorLog(`Supported adapters: ${SUPPORTED_ADAPTERS.join(", ")}`);
                process.exit(1);
            }

            const adapter = createAdapter(options.adapter as AdapterType);

            spinner.text = "Running migrations...";
            await adapter.runMigrations(connectionString);

            spinner.succeed("Migrations executed successfully!");
        } catch (error) {
            spinner.fail("Failed to run migrations");
            errorLog(`\nError: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        }
    });

program
    .command("check")
    .description("Check TrifectaJS configuration")
    .option(
        "-a, --adapter <adapter>",
        `Database adapter to use (${SUPPORTED_ADAPTERS.join(", ")})`,
        "neon",
    )
    .action(async (options) => {
        const spinner = ora("Checking TrifectaJS configuration...").start();

        try {
            const connectionString = process.env.TRIFECTA_CONNECTION_STRING;

            if (!connectionString) {
                spinner.warn("TRIFECTA_CONNECTION_STRING not found in environment variables");
                warningLog("\nMake sure to set TRIFECTA_CONNECTION_STRING in your .env file");
                return;
            }
            spinner.succeed("TRIFECTA_CONNECTION_STRING found in environment variables");

            if (!SUPPORTED_ADAPTERS.includes(options.adapter as AdapterType)) {
                spinner.fail(`Unsupported adapter: ${options.adapter}`);
                errorLog(`Supported adapters: ${SUPPORTED_ADAPTERS.join(", ")}`);
                process.exit(1);
            }

            const adapter = createAdapter(options.adapter as AdapterType);

            spinner.start("Testing database connection and schema...");

            const checkResult = await adapter.runCheck(connectionString);

            if (!checkResult.connection) {
                spinner.fail("Failed to connect to the database");
                errorLog("Could not establish connection to the database");
                return;
            }

            spinner.succeed("Database connection successful");

            if (!checkResult.tablesExist) {
                spinner.warn("Some TrifectaJS tables are missing");
                if (checkResult.missingTables && checkResult.missingTables.length > 0) {
                    warningLog(`Missing tables: ${checkResult.missingTables.join(", ")}`);
                }
                warningLog("Run 'trifecta migrate' to create all required tables");
            } else {
                spinner.succeed("All required TrifectaJS tables exist");

                if (checkResult.version) {
                    successLog(`Current migration version: ${checkResult.version}`);
                }
            }
        } catch (error) {
            spinner.fail("Configuration check failed");
            errorLog(`\nError: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        }
    });

program.parse();
