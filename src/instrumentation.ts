/** Starts the in-process job worker alongside the Node.js server (disable with GROWTENDRIL_WORKER=off). */
export async function register() {
  // The literal NEXT_RUNTIME comparison lets Next drop the worker (and its Node-only deps) from the edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if ((process.env.GROWTENDRIL_WORKER ?? process.env.GROWTHOS_WORKER) === "off") return;
    const { startWorker } = await import("@/server/jobs/worker");
    startWorker({ intervalMs: Number(process.env.WORKER_INTERVAL_MS) || undefined });
  }
}
