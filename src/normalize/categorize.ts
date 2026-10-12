/**
 * Lightweight keyword categorizer used when a source row has no explicit category.
 * Deterministic and transparent — the matched keyword becomes traceable evidence.
 *
 * Three rules govern a match. They exist because the previous "first substring hit wins,
 * in map order" behaviour produced misreadings that no amount of extra keywords could fix
 * (D23):
 *
 *  1. **Token boundaries.** A keyword matches whole words only, so "water" no longer
 *     claims "Waterfront hotel stay" for utilities. Punctuation counts as a boundary, so
 *     "Rent-a-car" is read as the three tokens it is.
 *  2. **Longest match wins**, ties broken by declaration order below. Specificity, not map
 *     position, decides: "gas bill" beats "gas", "credit card" beats "credit",
 *     "rent-a-car" beats "rent". This is what lets a general keyword stay general.
 *  3. **Direction, when known.** Money leaving an account is never income and money
 *     arriving is never a spending category. A keyword whose category contradicts the
 *     direction is skipped rather than reinterpreted, so "Interest charge" on an outflow
 *     cannot become income. With no direction supplied the gate is inactive and the
 *     heuristic behaves as a pure function of the text.
 *
 * Prefer extending the map, or adding a more specific phrase, over adding branching logic.
 */

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  salary: ["salary", "payroll", "wages", "stipend"],
  income: ["interest", "dividend", "refund", "reimbursement", "cashback", "credit"],
  groceries: ["grocery", "groceries", "supermarket", "whole foods", "aldi", "walmart", "costco"],
  dining: ["restaurant", "cafe", "coffee", "starbucks", "mcdonald", "dining", "uber eats", "doordash"],
  // "gas" is fuel in a consumer ledger; the utility is "gas bill" / "natural gas", and rule 2
  // lets the longer phrase win. A hired car is transport however the vendor words it.
  transport: ["uber", "lyft", "taxi", "fuel", "gas", "gas station", "shell", "petrol", "diesel", "metro", "transit", "parking", "rent-a-car", "rental car", "car rental", "car hire"],
  housing: ["rent", "mortgage", "landlord", "lease"],
  utilities: ["electric", "water", "gas bill", "natural gas", "internet", "broadband", "utility", "phone", "mobile"],
  subscriptions: ["netflix", "spotify", "prime", "subscription", "hulu", "disney", "icloud", "youtube"],
  shopping: ["amazon", "target", "store", "mall", "clothing", "apparel", "best buy"],
  health: ["pharmacy", "doctor", "hospital", "clinic", "dental", "insurance"],
  travel: ["hotel", "airline", "flight", "airbnb", "booking", "expedia"],
  // Paid-entry venues. "water park" outranks utilities' "water" by rule 2.
  entertainment: ["cinema", "movie", "game", "concert", "event", "water park", "theme park", "amusement park"],
  // A payment to one's own card moves money between accounts; it is not new income.
  transfer: ["transfer", "atm", "withdrawal", "deposit", "credit card"],
  // Bank charges are named after what they are levied on, so the phrase is the signal.
  fees: ["fee", "charge", "penalty", "overdraft", "interest charge", "interest fee", "finance charge"],
};

/** Categories that can only describe money coming in. */
const INFLOW_ONLY = new Set(["salary", "income"]);
/** Categories that can only describe money going out. `transfer` is deliberately neither. */
const OUTFLOW_ONLY = new Set([
  "groceries", "dining", "transport", "housing", "utilities",
  "subscriptions", "shopping", "health", "travel", "entertainment", "fees",
]);

/** Reduce to lower-case words separated by single spaces, padded so every token has edges. */
function tokenized(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * The forms of a keyword that count as the same word. Rule 1 matches whole tokens, which on its
 * own meant a plural in the description no longer matched a singular keyword — "Bank charges"
 * and "Monthly account fees" fell through to `uncategorized`, which substring matching had
 * caught. Only the final word is inflected, and the *keyword's own* length is what rule 2
 * compares, so pluralisation never changes which keyword wins.
 */
function wordForms(kw: string): string[] {
  const forms = [kw];
  forms.push(kw.endsWith("s") ? kw.slice(0, -1) : `${kw}s`);
  return forms;
}

function contradicts(category: string, direction?: "inflow" | "outflow"): boolean {
  if (direction === undefined) return false;
  return direction === "outflow" ? INFLOW_ONLY.has(category) : OUTFLOW_ONLY.has(category);
}

/**
 * Return { category, keyword } for a description, or "uncategorized" with no keyword.
 * `direction` is optional; supply it where known so rule 3 can apply.
 */
export function categorize(
  description: string,
  direction?: "inflow" | "outflow",
): { category: string; keyword?: string } {
  const text = tokenized(description);
  let best: { category: string; keyword: string; length: number } | undefined;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (contradicts(category, direction)) continue;
    for (const kw of keywords) {
      if (!wordForms(kw).some((form) => text.includes(tokenized(form)))) continue;
      // The declared keyword's own length decides precedence, not the form that matched.
      const length = tokenized(kw).length - 2;
      if (best === undefined || length > best.length) best = { category, keyword: kw, length };
    }
  }

  return best ? { category: best.category, keyword: best.keyword } : { category: "uncategorized" };
}
