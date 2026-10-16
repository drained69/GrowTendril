/** Create a fresh, standalone Arc toolkit source tree without the private application history. */
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination) throw new Error("Usage: node scripts/export-arc-toolkit.mjs <empty-output-directory>");
const root = resolve(import.meta.dirname, "..");
const packageRoot = join(root, "packages/arc-growth-tools");
if (destination === root || destination.startsWith(`${root}/`)) throw new Error("Export outside the private application repository");
await mkdir(destination, { recursive: true });
if ((await readdir(destination)).length) throw new Error("Output directory must be empty; refusing to overwrite another repository");

for (const name of ["README.md", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "package.json", "package-lock.json", "tsconfig.json", "src", "tests", "examples", "LICENSES", ".github"]) {
  await cp(join(packageRoot, name), join(destination, name), { recursive: true, filter: source => !source.split("/").includes("node_modules") });
}
for (const name of ["foundry.toml", "src", "test", "deployments"]) {
  const target = join(destination, "contracts", name);
  await mkdir(join(destination, "contracts"), { recursive: true });
  await cp(join(root, "contracts", name), target, { recursive: true });
}
await writeFile(join(destination, ".gitignore"), "node_modules/\ndist/\ncontracts/out/\ncontracts/cache/\n.env\n.env.*\n*.log\n");
console.log(`Prepared standalone Arc toolkit source at ${destination}`);
