import { fileURLToPath } from "node:url";

/**
 * A path under the repository root, where data/, evals/, .index/ and .models/ live. This file sits at the
 * same depth in src/ and dist/, so the same relative step works for both.
 */
export const repoPath = (p = "") => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
