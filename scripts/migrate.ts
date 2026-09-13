import { parseArgs } from "node:util";
import { dataRoot } from "../src/paths.ts";
import { migrateLegacy, previewMigration, rollbackMigration } from "../src/migration.ts";

const { values } = parseArgs({ options: {
  source: { type: "string" }, "data-root": { type: "string" },
  apply: { type: "boolean", default: false }, rollback: { type: "string" },
} });
try {
  const root = dataRoot(values["data-root"]);
  if (values.rollback) {
    if (!values.apply) throw new Error("Rollback requires --apply and refuses destinations changed since migration");
    await rollbackMigration(root, values.rollback);
    console.log(`Rolled back migration ${values.rollback}. Originals preserved.`);
  } else {
    if (!values.source) throw new Error("Usage: npm run migrate -- --source /absolute/checkout [--data-root /absolute/data] [--apply]");
    const preview = previewMigration(values.source, root);
    console.log(JSON.stringify(preview, null, 2));
    if (values.apply) console.log(`Migration complete: ${await migrateLegacy(preview)}. Originals preserved.`);
    else console.log("Preview only. Add --apply to copy and validate. No workers or network calls will start.");
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
