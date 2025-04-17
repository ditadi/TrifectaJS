import chalk from "chalk";
import { Command } from "commander";
import * as dotenv from "dotenv";
import inquirer from "inquirer";
import ora from "ora";
import { createNeonBranch, runMigrations } from "./neon";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { errorLog, infoLog, successLog, warningLog } from "./log";

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
    .option("-k, --api-key <key>", "Neon API Key")
    .option("-p, --project-id <id>", "Neon project ID")
    .option("-b, --branch-name <n>", "Branch name for TrifectaJS", "trifectajs")
    .option("-f, --force", "Force recreation of branch if it exists")
    .action(async (options) => {
        const spinner = ora("Initializing TrifectaJS...").start();
        try {
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

            spinner.text = "Creating Neon branch...";
            const connectionString = await createNeonBranch({
                apiKey: options.apiKey || apiKey,
                projectId: options.projectId || projectId,
                branchName: options.branchName,
                force: options.force,
            });

            spinner.text = "Running migrations...";

            await runMigrations(connectionString);

            spinner.succeed("TrifectaJS initialized successfully!");
            successLog("\nConnection string for TrifectaJS:");
            infoLog(connectionString);
            warningLog("\nAdd to your .env with the name TRIFECTA_CONNECTION_STRING");
        } catch (error) {
            spinner.fail("Failed to initialize TrifectaJS");

            errorLog(`\nError: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        }
    });

program
    .command("migrate")
    .description("Run TrifectaJS migrations")
    .option("-c, --connection <string>", "PostgreSQL/Neon connection string")
    .action(async (options) => {
        const spinner = ora("Preparing migrations...").start();
        try {
            const connectionString = options.connection || process.env.TRIFECTA_CONNECTION_STRING;

            if (!connectionString) {
                spinner.fail("Connection string not provided");
                console.log(chalk.yellow("\nUse:"));
                console.log("  - Option --connection");
                console.log("  - Environment variable TRIFECTA_CONNECTION_STRING");
                process.exit(1);
            }

            spinner.text = "Running migrations...";
            await runMigrations(connectionString);

            spinner.succeed("Migrations executed successfully!");
        } catch (error) {
            spinner.fail("Failed to run migrations");
            console.error(
                chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`),
            );
            process.exit(1);
        }
    });

program
    .command("check")
    .description("Check TrifectaJS configuration")
    .action(async () => {
        const spinner = ora("Checking TrifectaJS configuration...").start();

        try {
            const connectionString = process.env.TRIFECTA_CONNECTION_STRING;

            if (!connectionString) {
                spinner.warn("TRIFECTA_CONNECTION_STRING not found in environment variables");
                console.log(
                    chalk.yellow("\nMake sure to set TRIFECTA_CONNECTION_STRING in your .env file"),
                );
            } else {
                spinner.succeed("TRIFECTA_CONNECTION_STRING found in environment variables");
            }
        } catch (error) {
            spinner.fail("Configuration check failed");
            console.error(
                chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`),
            );
            process.exit(1);
        }
    });

program.parse();
