import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";

/**
 * Outbound fetch for URLs a user (or a page a user pointed at) controls: product sites, robots.txt,
 * RSS feeds. Blocks SSRF into the deployment's network:
 *  - http/https only, no embedded credentials, common web ports only
 *  - every hop's host is resolved and *all* addresses must be public; the check runs inside the
 *    socket's DNS lookup, so the address we vet is the address we connect to (no rebinding window)
 *  - redirects are followed manually (max 3) and each target is re-validated
 *  - overall timeout and a cap on decompressed body size
 */

export class UnsafeUrlError extends Error {}

const blocked = new BlockList();
const V4: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT (also Alibaba metadata 100.100.100.200)
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
  ["168.63.129.16", 32], // Azure wireserver
];
const V6: [string, number][] = [
  ["::", 96], // unspecified, loopback, IPv4-compatible
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds IPv4)
  ["fc00::", 7], // unique local (incl. AWS metadata fd00:ec2::254)
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
];
for (const [net, prefix] of V4) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of V6) blocked.addSubnet(net, prefix, "ipv6");

/** True for any address that is not plainly public unicast. Non-IP input counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "").split("%")[0];
  const v = isIP(addr);
  if (v === 4) return blocked.check(addr, "ipv4");
  if (v === 6) {
    // IPv4-mapped forms can smuggle an IPv4 address; reject them outright. (Not a BlockList rule:
    // Node matches IPv4 lookups against ::ffff:0:0/96, which would block every IPv4 address.)
    if (/^(0{0,4}:){0,5}:?ffff:/i.test(addr) || /^::(ffff:)?\d+\.\d+\.\d+\.\d+$/i.test(addr)) return true;
    return blocked.check(addr, "ipv6");
  }
  return true;
}

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const BLOCKED_HOST = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

/** Static checks on a URL (no DNS). Throws UnsafeUrlError with a user-presentable reason. */
export function checkUrl(input: string | URL): URL {
  let u: URL;
  try {
    u = new URL(String(input));
  } catch {
    throw new UnsafeUrlError("invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError("only http and https URLs are allowed");
  if (u.username || u.password) throw new UnsafeUrlError("URLs with embedded credentials are not allowed");
  if (!ALLOWED_PORTS.has(u.port)) throw new UnsafeUrlError(`port ${u.port} is not allowed`);
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || BLOCKED_HOST.test(host)) throw new UnsafeUrlError(`${host || "empty host"} is not a public host`);
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new UnsafeUrlError(`${host} is a private or reserved address`);
  } else if (!host.includes(".")) throw new UnsafeUrlError(`${host} is not a public host`);
  return u;
}

function resolveAll(host: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => dnsLookup(host, { all: true, verbatim: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))));
}

/** checkUrl + DNS: every address the host resolves to must be public. Use to validate URLs at save time. */
export async function assertPublicUrl(input: string | URL): Promise<URL> {
  const u = checkUrl(input);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return u;
  let addrs: LookupAddress[];
  try {
    addrs = await resolveAll(host);
  } catch {
    throw new UnsafeUrlError(`${host} does not resolve`);
  }
  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) throw new UnsafeUrlError(`${host} resolves to a private or reserved address`);
  return u;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** Socket-level lookup: resolves, vets every address, and hands the vetted ones to the connection. */
function guardedLookup(hostname: string, options: { all?: boolean; family?: number }, callback: LookupCb) {
  dnsLookup(hostname, { all: true, verbatim: true, family: options.family ?? 0 }, (err, addrs) => {
    if (err) return callback(err, "");
    if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) return callback(new UnsafeUrlError(`${hostname} resolves to a private or reserved address`), "");
    if (options.all) callback(null, addrs);
    else callback(null, addrs[0].address, addrs[0].family);
  });
}

export interface SafeResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

function once(u: URL, headers: Record<string, string>, signal: AbortSignal, maxBytes: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method: "GET", headers: { "Accept-Encoding": "gzip, deflate, br", ...headers }, lookup: guardedLookup as never, signal, agent: false });
    req.on("error", reject);
    req.on("response", (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ status, headers: res.headers, body: "", truncated: false });
      }
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      let stream: Readable = res;
      if (enc === "gzip" || enc === "x-gzip") stream = res.pipe(zlib.createGunzip());
      else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
      else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      const done = () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), truncated });
      stream.on("data", (c: Buffer) => {
        if (truncated) return;
        const room = maxBytes - size;
        if (c.length >= room) {
          chunks.push(c.subarray(0, room));
          size = maxBytes;
          truncated = true;
          res.destroy();
          done();
          return;
        }
        chunks.push(c);
        size += c.length;
      });
      stream.on("end", () => !truncated && done());
      stream.on("error", (e) => !truncated && reject(e));
      if (stream !== res) res.on("error", (e) => !truncated && reject(e));
    });
    req.end();
  });
}

/** GET a user-supplied URL safely. Throws UnsafeUrlError for blocked targets; network errors propagate. */
export async function safeFetch(input: string | URL, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const { headers = {}, timeoutMs = 10_000, maxBytes = 2_000_000, maxRedirects = 3 } = opts;
  const signal = AbortSignal.timeout(timeoutMs);
  let u = checkUrl(input);
  for (let hop = 0; ; hop++) {
    const r = await once(u, headers, signal, maxBytes);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      if (hop >= maxRedirects) throw new UnsafeUrlError(`too many redirects (max ${maxRedirects})`);
      u = checkUrl(new URL(String(r.headers.location), u));
      continue;
    }
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.headers)) if (v !== undefined) flat[k] = Array.isArray(v) ? v.join(", ") : v;
    return { url: u.toString(), status: r.status, ok: r.status >= 200 && r.status < 300, headers: flat, body: r.body, truncated: r.truncated };
  }
}
