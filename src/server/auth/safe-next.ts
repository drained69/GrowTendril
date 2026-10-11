const BASE = "http://growthos.invalid";

/**
 * Post-login redirect target: same-origin paths only. Rejects protocol-relative ("//x"),
 * backslash forms browsers treat as "//" ("/\x"), control characters, and anything that
 * resolves to another origin. Returns the normalized path or the fallback.
 */
export function safeNext(n: unknown, fallback = "/app"): string {
  if (typeof n !== "string" || !n || n.length > 2000) return fallback;
  if (!n.startsWith("/") || n.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(n)) return fallback;
  try {
    const u = new URL(n, BASE);
    if (u.origin !== BASE) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}
