import { runDemoStep, DEMO_STEPS } from "../src/server/demo/script";
import { ensureDemoUser, seedDemo } from "../src/server/demo/seed";
import { getDb } from "../src/server/db/client";

/** Runs the guided demo headlessly — useful for CI and for checking the loop end to end. */
const db = await getDb();
const userId = await ensureDemoUser(db);
const projectId = await seedDemo(db, { reset: true, ownerId: userId });
for (const st of DEMO_STEPS) {
  const r = await runDemoStep(db, projectId, st.step, userId);
  console.log(`\n== ${r.step}. ${r.title}`);
  for (const l of r.log) console.log(`  [${l.agent}] ${l.message}`);
}
process.exit(0);
