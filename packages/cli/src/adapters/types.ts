import type { NeonAdapterOptions } from "./neon/types";

/**
 * Common interface for all database adapters
 */
export interface DatabaseAdapter {
    /**
     * Create a branch or environment for TrifectaJS
     */
    createBranch(branchName: string, force?: boolean): Promise<string>;

    /**
     * Run TrifectaJS migrations on the database
     */
    runMigrations(connectionString: string): Promise<void>;

    /**
     * Check database connection and schema
     */
    runCheck(connectionString: string): Promise<DatabaseCheckResult>;
}

/**
 * Result of database check operation
 */
export interface DatabaseCheckResult {
    connection: boolean;
    tablesExist: boolean;
    version?: string;
    missingTables?: string[];
}

/**
 * Supported database adapters
 */
export type AdapterType = "neon" | "postgres";

export interface BaseAdapterOptions {
    connectionString?: string;
}

export type AdapterOptions = NeonAdapterOptions;

/**
 * Generic result type for operations that can succeed or fail
 */
export interface Result<T = void> {
    success: boolean;
    data?: T;
    error?: Error;
}
