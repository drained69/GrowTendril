/** Load the same env files as Next.js before standalone scripts import app modules. */
import nextEnv from "@next/env";

const { loadedEnvFiles } = nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
export const loadedEnv = loadedEnvFiles.map((file) => file.path);
