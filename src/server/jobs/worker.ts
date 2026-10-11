import { hostname } from "node:os";
import { getDb } from "@/server/db/client";
import { claimNext, completeJob, failJob } from "@/server/jobs/queue";
import { HANDLERS } from "@/server/jobs/handlers";
import { tick } from "@/server/jobs/scheduler";

/**
 * Background worker: schedules due work, then drains the queue. Runs in-process with the
 * web server by default (instrumentation.ts) or standalone via `npm run worker`.
 */
type WorkerState = { started: boolean; busy: boolean; timer?: NodeJS.Timeout };
const state = ((globalThis as unknown as { __growtendrilWorker?: WorkerState }).__growtendrilWorker ??= { started: false, busy: false });

export async function runOnce(workerId: string, maxJobs = 5): Promise<number> {
  const db = await getDb();
  await tick(db);
  let n = 0;
  for (; n < maxJobs; n++) {
    const job = await claimNext(db, workerId);
    if (!job) break;
    const handler = HANDLERS[job.kind];
    try {
      if (!handler) throw new Error(`no handler for ${job.kind}`);
      await completeJob(db, job.id, await handler(db, job));
    } catch (e) {
      await failJob(db, job, (e as Error).message ?? String(e));
    }
  }
  return n;
}

export function startWorker(opts: { intervalMs?: number } = {}) {
  if (state.started) return;
  state.started = true;
  const workerId = `${hostname()}:${process.pid}`;
  const loop = async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      await runOnce(workerId);
    } catch (e) {
      console.error("[growtendril worker]", (e as Error).message);
    } finally {
      state.busy = false;
    }
  };
  state.timer = setInterval(loop, opts.intervalMs ?? 15_000);
  setTimeout(loop, 2_000);
  console.log(`[growtendril worker] started (${workerId})`);
}

/** Process queued work right away (e.g. after a user clicks "Run now"), without waiting for the interval. */
export function kickWorker() {
  if (!state.started || state.busy) return;
  state.busy = true;
  runOnce(`${hostname()}:${process.pid}`)
    .catch((e) => console.error("[growtendril worker]", (e as Error).message))
    .finally(() => (state.busy = false));
}
