import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

/** User-supplied sites and feeds must never reach the app's private network. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    // Only global unicast; excludes loopback, link-local, unique-local, mapped IPv4,
    // multicast, transition tunnels and documentation ranges.
    const second = parseInt(canonical.split(":")[1] || "0", 16);
    return /^[23][0-9a-f]{3}:/.test(canonical) &&
      !(canonical.startsWith("2001:") && (second <= 0x1ff || second === 0xdb8)) &&
      !/^2002:/.test(canonical) && !/^3fff:/.test(canonical);
  }
  return false;
}

export function publicUrl(value: string | URL): URL {
  const url = new URL(value.toString());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Use a public http or https URL without embedded credentials");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host || host === "localhost" || /\.(?:localhost|local|internal|lan|home)$/.test(host) ||
    (isIP(host) ? !isPublicAddress(host) : !host.includes("."))) {
    throw new Error("Only public websites are supported; private network addresses are blocked");
  }
  url.hash = "";
  return url;
}

export interface PublicTextResponse {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
  headers: Record<string, string>;
}

/** Pin the connection to the checked DNS answer; validating then using fetch permits rebinding. */
export async function getPublicText(value: string | URL, opts: {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
  redirect?: "follow" | "error";
  beforeRequest?: (url: URL) => Promise<void>;
} = {}): Promise<PublicTextResponse> {
  const deadline = Date.now() + (opts.timeoutMs ?? 12_000);
  const maxBytes = opts.maxBytes ?? 600_000;
  let url = publicUrl(value);
  for (let hop = 0; hop <= 5; hop++) {
    await opts.beforeRequest?.(url);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Website request timed out");
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { dnsTimer = setTimeout(() => reject(new Error("Website lookup timed out")), remaining); }),
    ]).finally(() => clearTimeout(dnsTimer));
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      throw new Error("Only public websites are supported; private network addresses are blocked");
    }
    const address = addresses[0];
    const result = await new Promise<{ status: number; location?: string; contentType: string; text: string; headers: Record<string, string> }>((resolve, reject) => {
      const request = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = request(url, {
        method: opts.method ?? "GET",
        // No connection pooling: each new request pins its own checked DNS answer.
        agent: false,
        headers: { ...opts.headers, "Accept-Encoding": "identity" },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address: address.address, family: address.family }]);
          else callback(null, address.address, address.family);
        },
      }, (res) => {
        res.on("error", reject);
        res.on("aborted", () => reject(new Error("Website response was interrupted")));
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        const responseHeaders = Object.fromEntries(Object.entries(res.headers).filter((entry) => entry[1] !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value)]));
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          resolve({ status, location, contentType: "", text: "", headers: responseHeaders });
          res.destroy();
          return;
        }
        if (Number(res.headers["content-length"]) > maxBytes) {
          res.destroy(new Error("Website response is too large"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) res.destroy(new Error("Website response is too large"));
          else chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, contentType: res.headers["content-type"] ?? "", text: Buffer.concat(chunks).toString("utf8"), headers: responseHeaders }));
      });
      const timer = setTimeout(() => req.destroy(new Error("Website request timed out")), Math.max(1, deadline - Date.now()));
      req.on("error", reject);
      req.on("close", () => clearTimeout(timer));
      req.end(opts.body);
    });
    if (result.location) {
      if (opts.redirect === "error" || opts.method === "POST") throw new Error("This endpoint redirected; use its final URL directly");
      const target = publicUrl(new URL(result.location, url));
      if (target.origin !== url.origin && Object.keys(opts.headers ?? {}).some((key) => /authorization|cookie|payment|api.?key/i.test(key))) {
        throw new Error("Refusing to forward credentials to a redirected website");
      }
      url = target;
      continue;
    }
    return { url: url.toString(), status: result.status, ok: result.status >= 200 && result.status < 300, contentType: result.contentType, text: result.text, headers: result.headers };
  }
  throw new Error("Website redirected too many times");
}
