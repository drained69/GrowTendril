import { headers } from "next/headers";

/** Never build email or OAuth links from an untrusted forwarded host. */
export async function appOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (process.env.NODE_ENV === "production" && url.protocol !== "https:")) {
      throw new Error("APP_URL must be the app's public HTTPS origin (for example https://growtendril.xyz)");
    }
    return url.origin;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Set APP_URL to the app's public HTTPS origin before using email or Google sign-in");
  const h = await headers();
  const url = new URL(`http://${h.get("host") || "localhost:3000"}`);
  if (!(["localhost", "127.0.0.1", "[::1]"] as string[]).includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Set APP_URL when accessing development through a public hostname");
  }
  return url.origin;
}
