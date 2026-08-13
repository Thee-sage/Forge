/**
 * Lightweight keyword categorizer used when a source row has no explicit category.
 * Deterministic and transparent — the matched keyword becomes traceable evidence.
 * Extend the map rather than adding branching logic.
 */

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  salary: ["salary", "payroll", "wages", "stipend"],
  income: ["interest", "dividend", "refund", "reimbursement", "cashback", "credit"],
  groceries: ["grocery", "groceries", "supermarket", "whole foods", "aldi", "walmart", "costco"],
  dining: ["restaurant", "cafe", "coffee", "starbucks", "mcdonald", "dining", "uber eats", "doordash"],
  transport: ["uber", "lyft", "taxi", "fuel", "gas station", "shell", "petrol", "metro", "transit", "parking"],
  housing: ["rent", "mortgage", "landlord", "lease"],
  utilities: ["electric", "water", "gas bill", "internet", "broadband", "utility", "phone", "mobile"],
  subscriptions: ["netflix", "spotify", "prime", "subscription", "hulu", "disney", "icloud", "youtube"],
  shopping: ["amazon", "target", "store", "mall", "clothing", "apparel", "best buy"],
  health: ["pharmacy", "doctor", "hospital", "clinic", "dental", "insurance"],
  travel: ["hotel", "airline", "flight", "airbnb", "booking", "expedia"],
  entertainment: ["cinema", "movie", "game", "concert", "event"],
  transfer: ["transfer", "atm", "withdrawal", "deposit"],
  fees: ["fee", "charge", "penalty", "overdraft"],
};

/** Return { category, keyword } for a description, or "uncategorized" with no keyword. */
export function categorize(description: string): { category: string; keyword?: string } {
  const text = description.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return { category, keyword: kw };
    }
  }
  return { category: "uncategorized" };
}
