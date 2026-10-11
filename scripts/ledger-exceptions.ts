/**
 * Review where the books and Arc disagree: payments into the billing address that matched no
 * invoice, and wallet payouts that don't match what was approved.
 *
 *   npm run ledger:exceptions                          open items (scan billing first)
 *   npm run ledger:exceptions -- --all                 include resolved items
 *   npm run ledger:exceptions -- resolve <id> "note"   close one with what you found
 *
 * Against production: railway run npm run ledger:exceptions
 */
import { getDb } from "../src/server/db/client";
import { fmtUsdc } from "../src/lib/money";
import { EXCEPTION_LABEL, exceptionsFor, resolveException, type ExceptionKind } from "../src/server/domain/reconcile/exceptions";
import { reconcileBillingPayments } from "../src/server/domain/reconcile/billing";

const args = process.argv.slice(2);
const db = await getDb();

if (args[0] === "resolve") {
  const [, id, ...note] = args;
  if (!id || !note.length) {
    console.error('Usage: npm run ledger:exceptions -- resolve <id> "what you found"');
    process.exit(1);
  }
  const ok = await resolveException(db, { id, userId: "operator-cli", resolution: note.join(" ") });
  console.log(ok ? `Resolved ${id}` : `${id} is not open (already resolved, or no such id)`);
  process.exit(0);
}

const scan = await reconcileBillingPayments(db).catch((e: Error) => ({ error: e.message }));
console.log("Billing scan:", scan);

const rows = await exceptionsFor(db, { status: args.includes("--all") ? undefined : "open", limit: 200 });
if (!rows.length) {
  console.log("Nothing open. The books match Arc.");
  process.exit(0);
}
for (const e of rows) {
  console.log(`\n${e.id}  [${e.status}] ${e.scope}${e.projectId ? ` · workspace ${e.projectId}` : ""} · ${e.createdAt.toISOString()}`);
  console.log(`  ${EXCEPTION_LABEL[e.kind as ExceptionKind] ?? e.kind}${e.amountMicro != null ? ` · ${fmtUsdc(e.amountMicro)}` : ""}`);
  console.log(`  ${e.detail}`);
  if (e.resolution) console.log(`  Resolved: ${e.resolution}`);
}
process.exit(0);
