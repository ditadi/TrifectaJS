import NeonAdapter, { createNeonAdapter } from "./neon/neonAdapter";
import type { NeonAdapterOptions } from "./neon/types";
import type { AdapterOptions, AdapterType, DatabaseAdapter } from "./types";

export function createAdapter(type: AdapterType, options: Partial<AdapterOptions> = {}): DatabaseAdapter {
    switch (type) {
        case "neon":
            return createNeonAdapter(options as NeonAdapterOptions);
        default:
            throw new Error(`Unsupported adapter type: ${type}`);
    }
}

export * from "./types";
export { NeonAdapter, createNeonAdapter };
