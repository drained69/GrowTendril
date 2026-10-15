import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, encodeDeployData, formatEther, getAddress, http, type Hex } from "viem";
import { arc, arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { isOutcomeEscrowCode, OUTCOME_ESCROW_ABI } from "../packages/arc-growth-tools/dist/escrow.js";

const networkIndex = process.argv.indexOf("--network");
const networkName = networkIndex === -1 ? "testnet" : process.argv[networkIndex + 1];
if (networkName !== "testnet" && networkName !== "mainnet") throw new Error("Use --network testnet or --network mainnet");
const chain = networkName === "mainnet" ? arc : arcTestnet;
const rpc = networkName === "mainnet"
  ? process.env.ARC_MAINNET_RPC || "https://rpc.mainnet.arc.io"
  : process.env.ARC_TESTNET_RPC || "https://rpc.testnet.arc.io";
const explorer = networkName === "mainnet" ? "https://explorer.arc.io" : "https://explorer.testnet.arc.io";
const USDC = getAddress("0x3600000000000000000000000000000000000000");
const HOLD = 72n * 60n * 60n;
const broadcast = process.argv.includes("--broadcast");
if (process.argv.some((arg, index) => arg.startsWith("--") && !["--check", "--broadcast"].includes(arg) && !(arg === "--network" && networkIndex === index))) {
  throw new Error("Usage: npm run arc:escrow:deploy -- [--network testnet|mainnet] [--check | --broadcast]");
}

// Use a dedicated key if provided. The local .env fallback exists for an operator-controlled
// development wallet; neither the secret nor signed transaction bytes are ever logged.
let key = process.env.ARC_DEPLOYER_PRIVATE_KEY;
if (!key) {
  const lines = (await readFile(".env", "utf8").catch(() => "")).split(/\r?\n/);
  key = lines.find(line => line.startsWith("PRIVATE_KEY="))?.slice("PRIVATE_KEY=".length).trim().replace(/^['"]|['"]$/g, "");
}
if (!key || !/^0x[\da-f]{64}$/i.test(key)) throw new Error("Set ARC_DEPLOYER_PRIVATE_KEY to an EVM wallet key, or configure a local .env PRIVATE_KEY");
const account = privateKeyToAccount(key as Hex);
key = undefined;
const artifact = JSON.parse(await readFile("contracts/out/OutcomeRewardsEscrow.sol/OutcomeRewardsEscrow.json", "utf8")) as { bytecode: { object: Hex } };
const client = createPublicClient({ chain, transport: http(rpc, { timeout: 15_000, retryCount: 1 }) });
if (await client.getChainId() !== chain.id) throw new Error(`RPC is not Arc ${networkName}`);
if (!await client.getCode({ address: USDC })) throw new Error(`Arc ${networkName} USDC interface is unavailable`);
const balance = await client.getBalance({ address: account.address });
const data = encodeDeployData({ abi: OUTCOME_ESCROW_ABI, bytecode: artifact.bytecode.object, args: [USDC,HOLD] });
const estimatedGas = await client.estimateGas({ account: account.address, data });
const gasPrice = await client.getGasPrice();
const estimatedCost = estimatedGas * gasPrice;
console.log(JSON.stringify({ network: `Arc ${networkName}`, chainId: chain.id, deployer: account.address, gasUsdc: formatEther(balance), estimatedGas: estimatedGas.toString(), gasPriceWei: gasPrice.toString(), estimatedCostUsdc: formatEther(estimatedCost), token: USDC, refundHoldSeconds: HOLD.toString(), mode: broadcast ? "broadcast" : "check" }));
if (!broadcast) process.exit(0);
if (balance < estimatedCost * 2n) throw new Error("Deployer balance is below twice the estimated deployment cost");

const wallet = createWalletClient({ account, chain, transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });
const hash = await wallet.deployContract({ abi: OUTCOME_ESCROW_ABI, bytecode: artifact.bytecode.object, args: [USDC,HOLD] });
console.log(JSON.stringify({ status: "submitted", txHash: hash, explorer: `${explorer}/tx/${hash}` }));
const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deployment transaction did not produce a contract");
const code = await client.getCode({ address: receipt.contractAddress });
if (!code || !isOutcomeEscrowCode(code)) throw new Error(`Deployment exists but runtime does not match the reviewed build: ${receipt.contractAddress}`);
const readAbi = [{ type: "function", name: "token", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }, { type: "function", name: "refundHold", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" }] as const;
const [token,hold] = await Promise.all([
  client.readContract({ address: receipt.contractAddress, abi: readAbi, functionName: "token" }),
  client.readContract({ address: receipt.contractAddress, abi: readAbi, functionName: "refundHold" }),
]);
if (token.toLowerCase() !== USDC.toLowerCase() || hold !== HOLD) throw new Error("Deployment configuration does not match expected token and hold");
console.log(JSON.stringify({ status: "deployed", address: receipt.contractAddress, txHash: hash, explorer: `${explorer}/address/${receipt.contractAddress}`, sourceVerified: false }));
