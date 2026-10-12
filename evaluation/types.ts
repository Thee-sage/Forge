/** Case schema for the evaluation datasets (JSON-serialisable; amounts are exact decimal strings). */

export type Split = "dev" | "heldout";
export type AssetClassLabel =
  | "equity" | "fixed_income" | "cash" | "real_estate" | "commodity" | "crypto" | "alternative" | "unknown";

/** What a correct reading of one transaction row is. `amount` is signed: negative = outflow. */
export interface TruthTxn {
  date: string; // ISO YYYY-MM-DD
  amount: string; // exact decimal, signed
  category: string;
  description: string;
}

export interface TruthHolding {
  symbol: string;
  value: string; // exact decimal, > 0
  assetClass: AssetClassLabel;
}

export interface Truth {
  currency: string;
  txns: TruthTxn[];
  holdings: TruthHolding[];
}

export interface ScenarioJson {
  incomePct?: string;
  expensePct?: string;
  recurringExpense?: { amount: string; category: string };
  oneOffExpense?: { amount: string; category: string };
}

export type AmountFormat = "signed" | "debitcredit" | "parens" | "symbol";
export type DateFormat = "iso" | "dmy" | "mdy" | "long";

export interface InputSpec {
  amountFormat?: AmountFormat;
  dateFormat?: DateFormat;
  /** Omit the Category column so Forge must infer it (truth category is the human label). */
  omitCategory?: boolean;
  /** Raw category cell text per row (index-aligned); default = truth category. */
  categoryText?: string[];
  /** Per-row currency column values (index-aligned with truth.txns); omitted = no column. */
  currencyColumn?: string[];
  /** Verbatim file contents; when present they replace the rendered CSV (for hostile inputs). */
  rawTransactionsCsv?: string;
  rawHoldingsCsv?: string;
  /** Raw asset-class strings for holdings (index-aligned); default = canonical class name. */
  holdingClassText?: string[];
  /** Verbatim file name (extension matters) for ingestion-failure cases. */
  transactionsFileName?: string;
}

export interface SkipExpectation {
  table: "transactions" | "holdings";
  row: number; // 0-based data-row index in that table
  reason: string; // regex source the recorded reason must match
}

export interface Expectations {
  /** Compute and compare oracle metrics from `truth` (default true). */
  metrics?: boolean;
  skipped?: SkipExpectation[];
  /** Each regex must match at least one normalization warning. */
  warnings?: string[];
  /** No normalization warning may match any of these. */
  forbiddenWarnings?: string[];
  /** The pipeline must throw an error whose constructor name equals this. */
  error?: string;
  /** Metrics (module.key) that must be unavailable: absent, or a zero accompanied by an explanatory info finding. */
  unavailable?: string[];
  /**
   * Unsafe/ambiguous input where a safe refusal is the correct behaviour. Passes when ANY holds:
   * the named error is thrown, the row is skipped with a recorded reason, or a warning matches.
   * Fails when none does (i.e. Forge silently proceeded).
   */
  abstain?: { error?: string; row?: { table: "transactions" | "holdings"; index: number }; warning?: string };
  /** Every scenario in the case must be rejected with a ForgeError (invalid scenario inputs). */
  scenarioMustReject?: boolean;
}

export interface PipelineCase {
  id: string;
  split: Split;
  family: string;
  tags: string[];
  description: string;
  /** If true the expected value rests on a documented interpretation where another is valid. */
  ambiguous?: boolean;
  note?: string;
  /** Declared unsupported by Forge (documented limitation): reported, never scored. */
  declaredUnsupported?: string;
  truth: Truth;
  input?: InputSpec;
  scenarios?: ScenarioJson[];
  expect?: Expectations;
  /** Finding-type labels (see rubric). Absent key = ungraded. */
  labels?: Record<string, boolean>;
  /** Hand-calculated reference values (module.key -> number) used to cross-check the oracle itself. */
  hand?: Record<string, number>;
}

/** Cell-level parsing benchmark: one raw cell and the correct reading. */
export interface CellCase {
  id: string;
  split: Split;
  family: "cell";
  kind: "amount" | "date";
  raw: string;
  /** Exact decimal string (signed) / ISO date the cell means, or null when it must be rejected (skipped with reason). */
  expected: string | null;
  /** Other readings that are also acceptable (e.g. a safe rejection of an ambiguous format). */
  acceptAlso?: (string | null)[];
  ambiguous?: boolean;
  note?: string;
}

/** Classification benchmark (human-labelled). */
export interface ClassifyCase {
  id: string;
  split: Split;
  family: "classify";
  kind: "category" | "assetClass";
  text: string;
  expected: string;
  ambiguous?: boolean;
  note?: string;
}

export type AnyCase = PipelineCase | CellCase | ClassifyCase;

export interface Dataset {
  version: string;
  split: Split;
  pipeline: PipelineCase[];
  cells: CellCase[];
  classify: ClassifyCase[];
}
