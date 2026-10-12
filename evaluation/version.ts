/**
 * Versions of everything that determines an evaluation result. Bump the relevant constant
 * whenever the corresponding artefact changes, so two reports are comparable only when
 * their versions match.
 */
export const EVALUATOR_VERSION = "1.0.3";
/** Bump when any case in evaluation/datasets/{dev,heldout} changes. Checked against MANIFEST.json. */
export const DATASET_VERSION = "1.1.0";
/** Bump when a labelling rubric (docs/ACCURACY_VALIDATION.md §5) changes. */
export const RUBRIC_VERSION = "1.1.0";
/** Bump when a formula in evaluation/oracle/** or a tolerance in metrics.ts changes. */
export const ORACLE_VERSION = "1.1.0";
/** The accuracy target the framework reports against. It is a threshold, never a result. */
export const TARGET_RATE = 0.98;
