/** Dependency-free read of the deployment network, safe to import from any server component. */
export function isMainnetEnv(): boolean {
  return (process.env.GROWTHOS_NETWORK ?? "testnet").trim().toLowerCase() === "mainnet";
}
