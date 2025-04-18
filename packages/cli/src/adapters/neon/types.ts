import type { BaseAdapterOptions } from "../types";

/**
 * Neon Adapter configuration
 */
export interface NeonAdapterOptions extends BaseAdapterOptions {
    apiKey: string;
    projectId: string;
    branchName: string;
    force?: boolean;
}

/**
 * Neon API branch information
 */
export interface NeonAPIBranch {
    id: string;
    name: string;
    primary: boolean;
    operations?: Array<{ id: string; action: string }>;
}

/**
 * Neon API database information
 */
export interface NeonAPIDatabase {
    name: string;
}

/**
 * Neon API role information
 */
export interface NeonAPIRole {
    name: string;
}

/**
 * Neon API operation information
 */
export interface NeonAPIOperation {
    id: string;
    status: string;
    action: string;
}

/**
 * Neon API connection information
 */
export interface NeonAPIConnection {
    uri: string;
}

export interface BranchCheckResult {
    existingBranch?: NeonAPIBranch;
    primaryBranchId: string;
}

export interface NeonAPIListBranchesResponse {
    branches: NeonAPIBranch[];
}
