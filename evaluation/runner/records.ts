import type { Severity } from "../metrics.js";
import type { Split } from "../types.js";

export type Category =
  | "numeric"       // a number compared with the oracle
  | "availability"  // a measure that must be unavailable when its inputs are absent
  | "cell"          // single-cell parsing
  | "classify"      // category / asset-class labelling
  | "insight"       // finding-type labels (precision / recall)
  | "grounding"     // evidence and claim verification
  | "safety"        // errors, warnings, skipped rows, abstention
  | "invariant";    // properties that must hold for every report

/** "pass"/"fail" count toward rates; "na" (unverifiable / not applicable) never does. */
export type Status = "pass" | "fail" | "na";

export interface Check {
  caseId: string;
  split: Split;
  family: string;
  category: Category;
  check: string;
  status: Status;
  severity: Severity;
  /** True when the case rests on a documented interpretation where another reading is valid. */
  ambiguous: boolean;
  expected?: unknown;
  actual?: unknown;
  absError?: number;
  relError?: number;
  /** Insight checks only. */
  outcome?: "tp" | "fp" | "fn" | "tn";
  /** Grounding checks only: directly observed fact, heuristic attribution, or hypothetical outcome. */
  claimKind?: "observed" | "heuristic" | "hypothetical";
  detail?: string;
}

export interface CaseMeta {
  id: string;
  split: Split;
  family: string;
  ambiguous: boolean;
}

export const mkCheck = (m: CaseMeta, category: Category, check: string, status: Status, severity: Severity, extra: Partial<Check> = {}): Check => ({
  caseId: m.id,
  split: m.split,
  family: m.family,
  category,
  check,
  status,
  severity,
  ambiguous: m.ambiguous,
  ...extra,
});
