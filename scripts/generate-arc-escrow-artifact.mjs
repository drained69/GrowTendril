import { readFile, writeFile } from "node:fs/promises";

const source = "contracts/out/OutcomeRewardsEscrow.sol/OutcomeRewardsEscrow.json";
const target = "packages/arc-growth-tools/src/escrow-artifact.ts";
const artifact = JSON.parse(await readFile(source, "utf8"));
const ranges = Object.values(artifact.deployedBytecode.immutableReferences).flat();
const body = [
  "// Generated from contracts/src/OutcomeRewardsEscrow.sol with Solc 0.8.30, optimizer 200, Cancun.",
  `export const OUTCOME_ESCROW_ABI = ${JSON.stringify(artifact.abi)} as const;`,
  `export const ESCROW_RUNTIME = ${JSON.stringify(artifact.deployedBytecode.object)};`,
  `export const ESCROW_IMMUTABLE_RANGES = ${JSON.stringify(ranges)};`,
  "",
].join("\n");
await writeFile(target, body);
console.log(`Updated ${target}`);
