import { Pool } from "pg";
import { errorLog, successLog, warningLog } from "./log";
import type {
    NeonAPIBranch,
    NeonAPIConnection,
    NeonAPIDatabase,
    NeonAPIOperation,
    NeonAPIRole,
} from "./types";

interface NeonOptions {
    apiKey: string;
    projectId: string;
    branchName: string;
    force?: boolean;
    headers?: Record<string, string>;
    parentId?: string;
    existingBranch?: string;
}

const NEON_API_URL = "https://console.neon.tech/api/v2";

export async function createNeonBranch(options: NeonOptions): Promise<string> {
    const { apiKey, projectId, branchName, force } = options;
    const headers = createAPIHeaders(apiKey);

    const { existingBranch, primaryBranchId } = await checkExistingBranches(
        projectId,
        headers,
        branchName,
    );

    let branchId: string | undefined;

    if (existingBranch)
        branchId = await handleExistingBranch(existingBranch, projectId, headers, force);
    if (!branchId)
        branchId = await createBranchWithEndpoint(projectId, headers, branchName, primaryBranchId);

    const connectionString = await getConnectionString(branchId, projectId, headers);
    successLog("Connection string generated successfully.");
    return connectionString;
}

async function checkExistingBranches(
    projectId: string,
    headers: Record<string, string>,
    branchName: string,
) {
    warningLog("Checking for existing branches...");

    const existingBranchesResponse = await fetch(`${NEON_API_URL}/projects/${projectId}/branches`, {
        method: "GET",
        headers: headers,
    });

    if (!existingBranchesResponse.ok) {
        const error = await existingBranchesResponse.json();
        throw new Error(`Error listing branches: ${JSON.stringify(error)}`);
    }

    const branches = (await existingBranchesResponse.json()) as { branches: NeonAPIBranch[] };
    const existingBranch = branches.branches.find((b) => b.name === branchName);
    const primaryBranch = branches.branches.find((b) => b.primary === true);

    if (!primaryBranch) {
        throw new Error("Could not find primary branch");
    }

    return {
        existingBranch,
        primaryBranchId: primaryBranch.id,
    };
}

async function handleExistingBranch(
    existingBranch: NeonAPIBranch,
    projectId: string,
    headers: Record<string, string>,
    force = false,
) {
    warningLog(`Branch '${existingBranch.name}' already exists.`);

    if (force) {
        warningLog("Force flag enabled. Deleting existing branch...");

        const deleteBranchResponse = await fetch(
            `${NEON_API_URL}/projects/${projectId}/branches/${existingBranch.id}`,
            {
                method: "DELETE",
                headers: headers,
            },
        );

        if (!deleteBranchResponse.ok) {
            const error = await deleteBranchResponse.json();
            throw new Error(`Error deleting existing branch: ${JSON.stringify(error)}`);
        }

        successLog("Existing branch deleted successfully");
        return undefined;
    }

    return existingBranch.id;
}

async function createBranchWithEndpoint(
    projectId: string,
    headers: Record<string, string>,
    branchName: string,
    parentId: string,
): Promise<string> {
    warningLog("Creating new branch with endpoint...");

    const createBranchResponse = await fetch(`${NEON_API_URL}/projects/${projectId}/branches`, {
        method: "POST",
        headers: headers,
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
    });

    if (!createBranchResponse.ok) {
        const error = await createBranchResponse.json();
        throw new Error(`Error creating branch: ${JSON.stringify(error)}`);
    }

    const newBranch = (await createBranchResponse.json()) as { branch: NeonAPIBranch };
    const { id, name, operations } = newBranch.branch;
    successLog(`Branch '${name}' created successfully with endpoint.`);

    if (operations && operations.length > 0) {
        warningLog("Waiting for operations to complete...");
        for (const operation of operations) {
            await waitForOperation(operation.id, projectId, headers);
        }
    }

    return id;
}

async function getConnectionString(
    branchId: string,
    projectId: string,
    headers: Record<string, string>,
): Promise<string> {
    warningLog("Getting database and role information");

    const dbResponse = await fetch(
        `${NEON_API_URL}/projects/${projectId}/branches/${branchId}/databases`,
        {
            headers: headers,
        },
    );

    if (!dbResponse.ok) {
        const error = await dbResponse.json();
        throw new Error(`Error getting database list: ${JSON.stringify(error)}`);
    }

    const dbList = (await dbResponse.json()) as { databases: NeonAPIDatabase[] };

    if (!dbList.databases || dbList.databases.length === 0) {
        throw new Error("No databases found in the branch");
    }

    const defaultDB = dbList.databases[0]?.name;

    const rolesResponse = await fetch(
        `${NEON_API_URL}/projects/${projectId}/branches/${branchId}/roles`,
        { headers: headers },
    );

    if (!rolesResponse.ok) {
        const error = await rolesResponse.json();
        throw new Error(`Error getting roles: ${JSON.stringify(error)}`);
    }

    const rolesList = (await rolesResponse.json()) as { roles: NeonAPIRole[] };
    if (!rolesList || rolesList.roles.length === 0) {
        throw new Error("No roles found for the branch");
    }

    const defaultRole = rolesList.roles[0]?.name;

    warningLog("Generating connection string...");

    const connectionResponse = await fetch(
        `${NEON_API_URL}/projects/${projectId}/connection_uri?` +
            `branch_id=${branchId}&database_name=${defaultDB}&role_name=${defaultRole}`,
        { headers: headers },
    );

    if (!connectionResponse.ok) {
        const error = await connectionResponse.json();
        throw new Error(`Error getting connection URI: ${JSON.stringify(error)}`);
    }

    const connectionData = (await connectionResponse.json()) as NeonAPIConnection;
    if (!connectionData.uri) {
        throw new Error("No connection URI found in response");
    }

    return connectionData.uri;
}

async function waitForOperation(
    operationId: string,
    projectId: string,
    headers: Record<string, string>,
): Promise<void> {
    let isComplete = false;
    let attemps = 0;
    const maxAttempts = 30;

    while (!isComplete && attemps < maxAttempts) {
        attemps++;

        const operationsResponse = await fetch(
            `${NEON_API_URL}/projects/${projectId}/operations/${operationId}`,
            { headers: headers },
        );

        if (operationsResponse.ok) {
            const data = (await operationsResponse.json()) as { operation: NeonAPIOperation };
            if (data.operation.status === "finished") {
                isComplete = true;
                successLog(`Operation completed:${data.operation.action}`);
            } else if (data.operation.status === "failed") {
                throw new Error(`Operation failed: ${data.operation.action}`);
            } else {
                process.stdout.write(".");
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        } else {
            throw new Error("Failed to check operations status");
        }
    }

    if (!isComplete) {
        throw new Error("Timed out waiting for operation to complete");
    }
}

export async function runMigrations(connectionString: string): Promise<void> {
    warningLog("Connecting to database...");
    const pool = new Pool({
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

function createAPIHeaders(apiKey: string) {
    return {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
    };
}
