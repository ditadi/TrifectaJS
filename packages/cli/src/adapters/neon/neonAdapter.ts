import { Pool as NeonPool } from "@neondatabase/serverless";
import { errorLog, successLog, warningLog } from "../../log";
import type { DatabaseAdapter, DatabaseCheckResult, Result } from "../types";
import type {
    BranchCheckResult,
    NeonAdapterOptions,
    NeonAPIBranch,
    NeonAPIConnection,
    NeonAPIDatabase,
    NeonAPIListBranchesResponse,
    NeonAPIOperation,
    NeonAPIRole,
} from "./types";

export default class NeonAdapter implements DatabaseAdapter {
    private readonly NEON_API_URL = "https://console.neon.tech/api/v2";
    private headers: Record<string, string>;
    private apiKey: string;
    private projectId: string;
    private force: boolean;

    constructor(apiKey: string, projectId: string, force = false) {
        this.apiKey = apiKey;
        this.projectId = projectId;
        this.force = force;
        this.headers = this.createAPIHeaders();
    }

    /**
     * Create a branch with an endpoint for TrifectaJS
     */
    async createBranch(branchName: string): Promise<string> {
        const branchResult = await this.checkExistingBranch(branchName);
        if (!branchResult.success || !branchResult.data) {
            throw branchResult.error || new Error("Failed to check existing branches");
        }

        const { existingBranch, primaryBranchId } = branchResult.data;
        let branchId: string | undefined;

        if (existingBranch) {
            const handleResult = await this.handleExistingBranch(existingBranch);
            if (!handleResult.success) {
                throw handleResult.error || new Error("Failed to handle existing branch");
            }
            branchId = handleResult.data;
        }

        if (!branchId) {
            const createResult = await this.createBranchWithEndpoint(branchName, primaryBranchId);
            if (!createResult.success || !createResult.data) {
                throw createResult.error || new Error("Failed to create branch with endpoint");
            }
            branchId = createResult.data;
        }

        const connResult = await this.getConnectionString(branchId);
        if (!connResult.success || !connResult.data) {
            throw connResult.error || new Error("Failed to get connection string");
        }

        return connResult.data;
    }

    /**
     * Run TrifectaJS migrations
     */
    async runMigrations(connectionString: string): Promise<void> {
        warningLog("Connecting to database...");
        const pool = new NeonPool({
            connectionString,
            ssl: {
                rejectUnauthorized: false,
            },
        });

        try {
            warningLog("Running migrations...");
            await pool.query(`
              -- pgcrypto extension for encryption
              CREATE EXTENSION IF NOT EXISTS pgcrypto;
              
              -- Cache table
              CREATE TABLE IF NOT EXISTS trifecta_cache_entries (
                key TEXT PRIMARY KEY,
                value JSONB NOT NULL,
                expires_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
              );
              
              -- Index for expiration
              CREATE INDEX IF NOT EXISTS trifecta_cache_expires_at_idx 
              ON trifecta_cache_entries (expires_at)
              WHERE expires_at IS NOT NULL;
              
              -- Function for automatic cleanup of expired entries
              CREATE OR REPLACE FUNCTION trifecta_cache_cleanup_expired()
              RETURNS TRIGGER AS $$
              BEGIN
                DELETE FROM trifecta_cache_entries
                WHERE expires_at IS NOT NULL AND expires_at <= NOW();
                RETURN NULL;
              END;
              $$ LANGUAGE plpgsql;
              
              -- Trigger for automatic cleanup
              DROP TRIGGER IF EXISTS trifecta_cache_cleanup_trigger ON trifecta_cache_entries;
              CREATE TRIGGER trifecta_cache_cleanup_trigger
                AFTER INSERT OR UPDATE ON trifecta_cache_entries
                EXECUTE PROCEDURE trifecta_cache_cleanup_expired();
                
              -- Migrations version table
              CREATE TABLE IF NOT EXISTS trifecta_migrations (
                id SERIAL PRIMARY KEY,
                version TEXT NOT NULL,
                applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
              );
              
              -- Record initial migration
              INSERT INTO trifecta_migrations (version)
              VALUES ('0.1.0')
              ON CONFLICT DO NOTHING;
            `);
            successLog("Migrations completed successfully.");
        } catch (error) {
            errorLog(`Migration error: ${error}`);
            throw error;
        } finally {
            await pool.end();
        }
    }

    /**
     * Check database connection and schema
     */
    async runCheck(connectionString: string): Promise<DatabaseCheckResult> {
        const pool = new NeonPool({
            connectionString,
            ssl: {
                rejectUnauthorized: false,
            },
        });

        const requiredTables = ["trifecta_cache_entries", "trifecta_migrations"];

        try {
            await pool.query("SELECT 1");
            const tableQuery = `
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name IN ($1, $2)
            `;

            const tablesResult = await pool.query(tableQuery, [
                requiredTables[0],
                requiredTables[1],
            ]);

            const foundTables = tablesResult.rows.map((row) => row.table_name);
            const missingTables = requiredTables.filter((table) => !foundTables.includes(table));

            let version: string | undefined;
            if (foundTables.includes("trifecta_migrations")) {
                const versionQuery = `
                    SELECT version FROM trifecta_migrations 
                    ORDER BY applied_at DESC LIMIT 1
                `;

                const versionResult = await pool.query(versionQuery);
                if (versionResult.rows.length > 0) {
                    version = versionResult.rows[0].version;
                }
            }

            return {
                connection: true,
                tablesExist: missingTables.length === 0,
                version,
                missingTables: missingTables.length > 0 ? missingTables : undefined,
            };
        } catch (error) {
            return {
                connection: false,
                tablesExist: false,
            };
        } finally {
            await pool.end();
        }
    }

    /**
     * Check if branch already exists and get primary branch ID
     */
    private async checkExistingBranch(branchName: string): Promise<Result<BranchCheckResult>> {
        warningLog("Checking for existing branches...");

        const result = await this.fetchNeonAPI<NeonAPIListBranchesResponse>(
            `/projects/${this.projectId}/branches`,
            { method: "GET" },
        );

        if (!result.success || !result.data) {
            return {
                success: false,
                error: result.error || new Error("Failed to fetch branches"),
            };
        }

        const primaryBranch = result.data.branches.find((b) => b.primary === true);
        if (!primaryBranch) {
            return {
                success: false,
                error: new Error("Could not find primary branch"),
            };
        }

        const existingBranch = result.data.branches.find((b) => b.name === branchName);

        return {
            success: true,
            data: {
                existingBranch,
                primaryBranchId: primaryBranch.id,
            },
        };
    }

    /**
     * Handle existing branch - delete if force=true or return ID
     */
    private async handleExistingBranch(
        existingBranch: NeonAPIBranch,
    ): Promise<Result<string | undefined>> {
        warningLog(`Branch '${existingBranch.name}' already exists.`);

        if (this.force) {
            warningLog("Force flag enabled. Deleting existing branch...");

            const result = await this.fetchNeonAPI(
                `/projects/${this.projectId}/branches/${existingBranch.id}`,
                { method: "DELETE" },
            );

            if (!result.success) {
                return {
                    success: false,
                    error: result.error || new Error("Failed to delete branch"),
                };
            }

            successLog("Existing branch deleted successfully");
            return { success: true, data: undefined };
        }

        return {
            success: true,
            data: existingBranch.id,
        };
    }

    /**
     * Create a new branch with an endpoint
     */
    private async createBranchWithEndpoint(
        branchName: string,
        parentId: string,
    ): Promise<Result<string>> {
        warningLog("Creating new branch with endpoint...");

        const result = await this.fetchNeonAPI<{ branch: NeonAPIBranch }>(
            `/projects/${this.projectId}/branches`,
            {
                method: "POST",
                body: JSON.stringify({
                    branch: {
                        name: branchName,
                        parent_id: parentId,
                    },
                    endpoints: [
                        {
                            type: "read_write",
                        },
                    ],
                }),
            },
        );

        if (!result.success || !result.data) {
            return {
                success: false,
                error: result.error || new Error("Failed to create branch"),
            };
        }

        const { branch } = result.data;
        successLog(`Branch '${branch.name}' created successfully with endpoint.`);

        if (branch.operations && branch.operations.length > 0) {
            warningLog("Waiting for operations to complete...");
            for (const operation of branch.operations) {
                const opResult = await this.waitForOperation(operation.id);
                if (!opResult.success) {
                    return {
                        success: false,
                        error: opResult.error || new Error("Operation failed"),
                    };
                }
            }
        }

        return { success: true, data: branch.id };
    }

    /**
     * Get connection string for a branch
     */
    private async getConnectionString(branchId: string): Promise<Result<string>> {
        warningLog("Getting database and role information");

        const dbResult = await this.fetchNeonAPI<{ databases: NeonAPIDatabase[] }>(
            `/projects/${this.projectId}/branches/${branchId}/databases`,
            {},
        );

        if (!dbResult.success || !dbResult.data) {
            return {
                success: false,
                error: dbResult.error || new Error("Failed to fetch databases"),
            };
        }

        if (!dbResult.data.databases || dbResult.data.databases.length === 0) {
            return {
                success: false,
                error: new Error("No databases found in the branch"),
            };
        }

        const defaultDB = dbResult.data.databases[0]?.name;

        const rolesResult = await this.fetchNeonAPI<{ roles: NeonAPIRole[] }>(
            `/projects/${this.projectId}/branches/${branchId}/roles`,
            {},
        );

        if (!rolesResult.success || !rolesResult.data) {
            return {
                success: false,
                error: rolesResult.error || new Error("Failed to fetch roles"),
            };
        }

        if (!rolesResult.data.roles || rolesResult.data.roles.length === 0) {
            return {
                success: false,
                error: new Error("No roles found for the branch"),
            };
        }

        const defaultRole = rolesResult.data.roles[0]?.name;

        warningLog("Generating connection string...");
        const connResult = await this.fetchNeonAPI<NeonAPIConnection>(
            `/projects/${this.projectId}/connection_uri?` +
                `branch_id=${branchId}&database_name=${defaultDB}&role_name=${defaultRole}`,
            {},
        );

        if (!connResult.success || !connResult.data) {
            return {
                success: false,
                error: connResult.error || new Error("Failed to get connection URI"),
            };
        }

        if (!connResult.data.uri) {
            return {
                success: false,
                error: new Error("No connection URI found in response"),
            };
        }

        return { success: true, data: connResult.data.uri };
    }

    /**
     * Wait for an operation to complete
     */
    private async waitForOperation(operationId: string): Promise<Result<void>> {
        let isComplete = false;
        let attempts = 0;
        let delay = 1000;
        const maxAttempts = 30;

        while (!isComplete && attempts < maxAttempts) {
            attempts++;

            const result = await this.fetchNeonAPI<{ operation: NeonAPIOperation }>(
                `/projects/${this.projectId}/operations/${operationId}`,
                {},
            );

            if (!result.success || !result.data) {
                return {
                    success: false,
                    error: result.error || new Error("Failed to check operation status"),
                };
            }

            const { operation } = result.data;

            if (operation.status === "finished") {
                isComplete = true;
                successLog(`Operation completed: ${operation.action}`);
            } else if (operation.status === "failed") {
                return {
                    success: false,
                    error: new Error(`Operation failed: ${operation.action}`),
                };
            } else {
                process.stdout.write(".");

                delay = Math.min(delay * 2, 16000);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        if (!isComplete) {
            return {
                success: false,
                error: new Error("Timed out waiting for operation to complete"),
            };
        }

        return { success: true };
    }

    /**
     * Create API headers with authentication
     */
    private createAPIHeaders(): Record<string, string> {
        return {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
        };
    }

    /**
     * Fetch from Neon API with security checks
     */
    private async fetchNeonAPI<T>(
        endpoint: string,
        options: RequestInit & { body?: string },
    ): Promise<Result<T>> {
        try {
            const response = await fetch(`${this.NEON_API_URL}${endpoint}`, {
                ...options,
                headers: this.headers,
                redirect: "manual",
            });

            if (response.status >= 300 && response.status < 400) {
                return {
                    success: false,
                    error: new Error(
                        `Redirect detected to ${response.headers.get("location")}. Aborted for security.`,
                    ),
                };
            }

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    success: false,
                    error: new Error(`API error (${response.status}): ${errorText}`),
                };
            }

            const data = (await response.json()) as T;
            return {
                success: true,
                data,
            };
        } catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err : new Error(String(err)),
            };
        }
    }
}

/**
 * Create a Neon adapter
 */
export function createNeonAdapter(options: Partial<NeonAdapterOptions> = {}): NeonAdapter {
    return new NeonAdapter(options.apiKey || "", options.projectId || "", options.force || false);
}
