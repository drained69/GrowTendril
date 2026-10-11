import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:http", () => ({ request: mocks.request }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { getPublicText, isPublicAddress, publicUrl } from "@/server/security/public-http";

describe("public-only outbound requests", () => {
  beforeEach(() => { mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); });
  afterEach(() => { vi.clearAllMocks(); });

  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "100.64.0.1", "198.18.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "2001::1", "2001:db8::1", "2002:7f00:1::1"])("rejects private/reserved IP %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"])("permits public IP %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each(["http://localhost:3000", "http://127.1", "http://2130706433", "http://0x7f000001", "http://[::ffff:127.0.0.1]", "http://host.internal", "https://user:secret@example.com", "file:///etc/passwd"])("rejects unsafe URL %s", (url) => {
    expect(() => publicUrl(url)).toThrow();
  });

  it("blocks a hostname if any DNS answer is private before opening a socket", async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(getPublicText("https://example.com")).rejects.toThrow(/private network/);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  function respond(status: number, headers: Record<string, string>, body = "") {
    mocks.request.mockImplementationOnce((_url, options, handler) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
      req.destroy = (error) => { req.emit("error", error); req.emit("close"); };
      req.end = () => queueMicrotask(() => {
        const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; destroy: (error?: Error) => void };
        res.statusCode = status;
        res.headers = headers;
        let destroyed = false;
        res.destroy = (error) => { destroyed = true; if (error) res.emit("error", error); req.emit("close"); };
        handler(res);
        if (!destroyed) { res.emit("data", Buffer.from(body)); if (!destroyed) res.emit("end"); req.emit("close"); }
      });
      // Verify the transport receives the original hostname but uses the checked address.
      options.lookup("example.com", {}, (error: unknown, address: string, family: number) => {
        expect(error).toBeNull(); expect(address).toBe("93.184.216.34"); expect(family).toBe(4);
      });
      return req;
    });
  }

  it("pins DNS to the validated public address and reads a bounded response", async () => {
    respond(200, { "content-type": "text/plain" }, "Hello");
    expect(await getPublicText("https://example.com")).toMatchObject({ ok: true, text: "Hello", url: "https://example.com/" });
    expect(mocks.lookup).toHaveBeenCalledOnce();
  });

  it("checks every redirect and refuses private destinations", async () => {
    respond(302, { location: "http://169.254.169.254/latest/meta-data/" });
    await expect(getPublicText("https://example.com")).rejects.toThrow(/private network/);
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it("rejects payment redirects even when the destination is public", async () => {
    respond(302, { location: "https://other.example/" });
    await expect(getPublicText("https://example.com", { redirect: "error", headers: { "Payment-Signature": "private-proof" } })).rejects.toThrow(/redirected/);
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it("never forwards authorization on cross-origin redirects", async () => {
    respond(302, { location: "https://other.example/" });
    await expect(getPublicText("https://example.com", { headers: { Authorization: "Bearer private-key" } })).rejects.toThrow(/forward credentials/);
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it("aborts oversized chunked responses instead of buffering unlimited content", async () => {
    respond(200, {}, "123456");
    await expect(getPublicText("https://example.com", { maxBytes: 5 })).rejects.toThrow(/too large/);
  });

  it("rejects advertised oversized responses without an unhandled error", async () => {
    respond(200, { "content-length": "10" }, "1234567890");
    await expect(getPublicText("https://example.com", { maxBytes: 5 })).rejects.toThrow(/too large/);
  });
});
