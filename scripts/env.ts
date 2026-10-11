/**
 * Loads .env / .env.local the same way `next dev` and `next start` do. Standalone scripts run with
 * `tsx`, which does not read env files on its own, so import this FIRST in any script that needs
 * credentials or the app's database:   import "./env";
 */
import nextEnv from "@next/env"; // CommonJS package: take the default export under ESM

const { loadedEnvFiles } = nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
export const loadedEnv = loadedEnvFiles.map((f) => f.path);
