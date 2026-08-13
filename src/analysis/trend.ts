import { monthKey, type FinancialModel } from "../core/model.js";
import { formatMoney, formatPercent, safeDiv } from "../core/money.js";
import { metric, type AnalysisResult, type Finding } from "../core/result.js";

/**
 * Behavioural-change detection: which spending categories rose or fell most between the
 * earlier and recent halves of the covered period. Surfaces *changes*, which the
 * reasoning engine correlates with cash-flow shifts.
 */
export function analyzeTrends(model: FinancialModel): AnalysisResult {
  const cur = model.currency;
  const months = [...new Set(model.transactions.map((t) => monthKey(t.date)))].sort();
  const findings: Finding[] = [];

  if (months.length < 2) {
    return {
      module: "trend",
      title: "Trends & Changes",
      metrics: [metric("categoriesChanged", "Categories changed", 0, "count")],
      findings: [
        { severity: "info", message: "Need at least two months of data to detect trends.", evidence: [] },
      ],
      evidence: [],
    };
  }

  const mid = Math.floor(months.length / 2);
  const earlyMonths = new Set(months.slice(0, mid));
  const recentMonths = new Set(months.slice(mid));

  const early = new Map<string, number>();
  const recent = new Map<string, number>();
  for (const t of model.transactions) {
    if (t.direction !== "outflow") continue;
    const mk = monthKey(t.date);
    const bucket = earlyMonths.has(mk) ? early : recentMonths.has(mk) ? recent : undefined;
    if (bucket) bucket.set(t.category, (bucket.get(t.category) ?? 0) + t.amount);
  }

  // Normalize to per-month averages so unequal halves compare fairly.
  const earlyN = earlyMonths.size || 1;
  const recentN = recentMonths.size || 1;
  const categories = new Set([...early.keys(), ...recent.keys()]);
  const changes = [...categories]
    .map((c) => {
      const e = (early.get(c) ?? 0) / earlyN;
      const r = (recent.get(c) ?? 0) / recentN;
      return { category: c, early: e, recent: r, delta: r - e, pct: safeDiv(r - e, e || r || 1) };
    })
    .filter((c) => Math.abs(c.delta) > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  for (const c of changes.slice(0, 5)) {
    if (Math.abs(c.pct) < 0.25 || Math.abs(c.delta) < 1) continue;
    const rising = c.delta > 0;
    findings.push({
      severity: rising && c.pct > 0.5 ? "warning" : "notice",
      message: `Monthly "${c.category}" spending ${rising ? "rose" : "fell"} ${formatPercent(Math.abs(c.pct))} (${formatMoney(c.early, cur)} → ${formatMoney(c.recent, cur)} per month).`,
      evidence: [
        { label: "earlier avg", detail: formatMoney(c.early, cur), value: c.early },
        { label: "recent avg", detail: formatMoney(c.recent, cur), value: c.recent },
      ],
    });
  }

  return {
    module: "trend",
    title: "Trends & Changes",
    metrics: [
      metric("categoriesChanged", "Categories changed", changes.length, "count"),
      metric("biggestRise", "Biggest monthly rise", changes.find((c) => c.delta > 0)?.delta ?? 0, "currency"),
      metric("biggestDrop", "Biggest monthly drop", changes.find((c) => c.delta < 0)?.delta ?? 0, "currency"),
    ],
    findings,
    evidence: changes.slice(0, 8).map((c) => ({
      label: c.category,
      detail: `${formatMoney(c.early, cur)} → ${formatMoney(c.recent, cur)} /mo (${formatPercent(c.pct)})`,
      value: c.delta,
    })),
  };
}
