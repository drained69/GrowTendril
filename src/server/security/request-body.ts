/** Reject large request streams before allocating their full contents. Limits are bytes. */
export class RequestBodyError extends Error {
  constructor(message: string, public readonly status: 400 | 413) { super(message); }
}

export async function readRequestBody(req: Request, maxBytes: number): Promise<string> {
  const length = req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new RequestBodyError("invalid content length", 400);
  if (length && Number(length) > maxBytes) throw new RequestBodyError("request too large", 413);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyError("request too large", 413);
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("invalid request body", 400);
  } finally {
    reader.releaseLock();
  }
}
