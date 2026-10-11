/** All money is integer micro-USDC. 1 USDC = 1_000_000 micro. */
export const MICRO = 1_000_000;

export function toMicro(usdc: number | string): number {
  const s = typeof usdc === "number" ? usdc.toFixed(6) : usdc.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`invalid USDC amount: ${usdc}`);
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  if (/[^0]/.test(frac.slice(6))) throw new Error("USDC amounts support at most 6 decimal places");
  const micro = BigInt(whole) * BigInt(MICRO) + BigInt((frac + "000000").slice(0, 6));
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("USDC amount exceeds safe precision");
  return Number(neg ? -micro : micro);
}

/** Decimal string with exactly the needed precision ("0.01", "150", "3.89"). */
export function microToDecimal(micro: number): string {
  const neg = micro < 0;
  const abs = Math.abs(Math.round(micro));
  const whole = Math.floor(abs / MICRO);
  const frac = String(abs % MICRO).padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** Display formatting: 2 decimals for normal amounts, up to 6 for sub-cent nanopayments. */
export function fmtUsdc(micro: number | null | undefined, opts: { unit?: boolean } = {}): string {
  if (micro == null) return "—";
  const usdc = micro / MICRO;
  const abs = Math.abs(usdc);
  const digits = abs !== 0 && abs < 0.01 ? 6 : abs < 1 && abs !== 0 ? 3 : 2;
  const s = usdc.toLocaleString("en-US", { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits });
  return opts.unit === false ? s : `${s} USDC`;
}
