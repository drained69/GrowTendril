/** Raw deployment network setting. GROWTENDRIL_NETWORK; the pre-rename GROWTHOS_NETWORK is still honoured. */
export function networkSetting(): string {
  return (process.env.GROWTENDRIL_NETWORK ?? process.env.GROWTHOS_NETWORK ?? "testnet").trim().toLowerCase();
}

/** Dependency-free read of the deployment network, safe to import from any server component. */
export function isMainnetEnv(): boolean {
  return networkSetting() === "mainnet";
}
