/** Standalone worker for production: run the web with GROWTENDRIL_WORKER=off and this as its own process. */
import "./env";
import { startWorker } from "../src/server/jobs/worker";

startWorker({ intervalMs: Number(process.env.WORKER_INTERVAL_MS ?? 10_000) });
