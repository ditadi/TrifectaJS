import { neon, type QueryResultRow } from "@neondatabase/serverless";
import chalk from "chalk";
import { Pool, type PoolClient, type QueryResult } from "pg";

export interface ConnectionOptions {
    connectionString?: string;

    poolSize?: number;

    idleTimeoutMillis?: number;

    useServerless?: boolean;

    statementTimeout?: number;

    checkTables?: boolean;
}

export class DBConnection {
    private pool: Pool | null = null;
    private sqlFunction: ReturnType<typeof neon> | null = null;
    private readonly options: Required<ConnectionOptions>;

    constructor(options: ConnectionOptions = {}) {
        const connectionString = options.connectionString || process.env.TRIFECTA_CONNECTION_STRING;

        if (!connectionString) {
            throw new Error(
                "Connection string don't provided'. Use connectionString parameter or define the environment variable TRIFECTA_CONNECTION_STRING.\n" +
                    "Run 'npx @trifecta-js/cli init' to configure automatically the database",
            );
        }

        this.options = {
            connectionString,
            poolSize: 5,
            idleTimeoutMillis: 10000,
            useServerless: true,
            statementTimeout: 3000,
            checkTables: true,
            ...options,
        };

        if (this.options.useServerless) {
            this.sqlFunction = neon(this.options.connectionString);
        } else {
            this.pool = new Pool({
                connectionString: this.options.connectionString,
                max: this.options.poolSize,
                idleTimeoutMillis: this.options.idleTimeoutMillis,
                statement_timeout: this.options.statementTimeout,
            });

            if (this.options.checkTables) {
                this.checkTablesExist().catch((err) => {
                    console.error(chalk.red("TrifectaJS table verification error:"), err.message);
                    console.warn(
                        chalk.yellow(
                            'Run "npx @trifecta-js/cli migrate" to create the necessary tables.',
                        ),
                        err.message,
                    );
                });
            }
        }
    }

    private async checkTablesExist(): Promise<boolean> {
        try {
            const result = await this.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'trifecta_cache_entries'
                ) as exists
            `);

            const exists = result.rows[0]?.exists === true;
            if (!exists) {
                console.warn(chalk.yellow("TrifectaJS tables not found in the database."));
                console.warn(
                    chalk.yellow(
                        'Run "npx @trifecta-js/cli migrate" to create the necessary tables.',
                    ),
                );
            }
            return true;
        } catch (error) {
            throw new Error(`Table verification error: ${error}`);
        }
    }

    async query<T extends QueryResultRow = Record<string, unknown>>(
        text: string,
        params: unknown[] = [],
    ): Promise<QueryResult<T>> {
        if (this.sqlFunction) {
            try {
                const result = await this.sqlFunction(text, params);
                return {
                    rows: result as T[],
                    command: "",
                    rowCount: Array.isArray(result) ? result.length : 0,
                    oid: 0,
                    fields: [],
                };
            } catch (error) {
                throw new Error(`Error executing query (serverless): ${error}`);
            }
        } else if (this.pool) {
            try {
                return await this.pool.query<T>(text, params);
            } catch (error) {
                throw new Error(`Error executing query (pool): ${error}`);
            }
        } else {
            throw new Error("Database connection not initialized");
        }
    }

    async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
        if (!this.pool) {
            throw new Error("Transactions are only available with standard pool (not serverless)");
        }

        const client = await this.pool.connect();

        try {
            await client.query("BEGIN");
            const result = await callback(client);
            await client.query("COMMIT");
            return result;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    async close(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
        this.sqlFunction = null;
    }
}
