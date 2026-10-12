import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { devDataset } from "./dev.js";
import { heldoutDataset } from "./heldout.js";
import { DATASET_VERSION } from "../../version.js";

/**
 * Deterministically (re)generates datasets/{dev,heldout}/dataset.json and MANIFEST.json.
 * Regenerating the held-out split after measurement has started invalidates its status as a
 * held-out set: bump DATASET_VERSION and say why in the report.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

const files: Record<string, { sha256: string; pipeline: number; cells: number; classify: number }> = {};
for (const [name, ds] of [["dev", devDataset], ["heldout", heldoutDataset]] as const) {
  const text = JSON.stringify(ds, null, 1) + "\n";
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "dataset.json"), text);
  files[`${name}/dataset.json`] = { sha256: sha(text), pipeline: ds.pipeline.length, cells: ds.cells.length, classify: ds.classify.length };
}
const manifest = { datasetVersion: DATASET_VERSION, files };
writeFileSync(join(root, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
