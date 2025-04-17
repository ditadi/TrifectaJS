export interface NeonAPIBranch {
    id: string;
    name: string;
    primary: boolean;
    operations: { id: string }[];
}

export interface NeonAPIOperation {
    id: string;
    action: string;
    status: string;
}

export interface NeonAPIDatabase {
    id: string;
    name: string;
}

export interface NeonAPIRole {
    id: string;
    name: string;
}

export interface NeonAPIConnection {
    uri: string;
}
