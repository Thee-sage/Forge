# Forge — Financial Reasoning Engine

Forge is a modular **Financial Reasoning Engine** that transforms structured financial
data into actionable, **explainable** insights. Unlike conventional budgeting or
expense-tracking apps, Forge focuses on understanding financial *relationships*,
identifying risks, and assisting decision-making — not merely visualizing transactions.

> **Status:** early development (v0.1.0). Built as a TypeScript/Node engine with a CLI.

---

## What it does

1. **Ingests** structured financial data from multiple sources (CSV, Excel).
2. **Normalizes** heterogeneous inputs into one **unified financial model**.
3. **Analyzes** the model through specialized modules — financial health, cash flow,
   expenditure patterns, asset allocation, portfolio concentration, anomalies and trends.
4. **Reasons** about the results, explaining *why* an outcome occurred by correlating
   multiple data points.
5. **Simulates** scenarios — the impact of hypothetical events like an income change,
   an unexpected expense, or a shift in investment allocation.

Forge is an **analysis engine**, not a replacement for financial professionals. Every
insight is evidence-based and traceable back to the underlying data.

---

## Quick start

```bash
# Install dependencies
npm install

# Run against a file (dev mode, no build needed)
npm run forge -- analyze samples/personal_transactions.csv
npm run forge -- analyze samples/household_workbook.xlsx    # a real two-sheet workbook

# Or open the same report in a browser (local, http://127.0.0.1:4173)
npm run web

# Build a distributable CLI
npm run build
node dist/cli/index.js analyze samples/personal_transactions.csv
```

### Example commands

```bash
forge analyze <file>              # full pipeline: ingest → normalize → analyze → reason
forge inspect <file>              # show detected format + normalized records
forge scenario <file> --income -20%   # what-if simulation
forge serve --port 4173           # local web interface (upload, read, simulate)
```

### Measuring accuracy

```bash
npm run validate:accuracy -- --out <dir>   # independent benchmark: oracle vs the real pipeline
npm run validate:accuracy:compare -- --baseline <dir> --latest <dir> --out <file.md>
```

Forge ships an independent, reproducible evaluation (exact-arithmetic oracle, frozen dev/held-out
datasets, labelled insights, evidence-grounding and data-safety checks). It reports separate measures
with confidence intervals — **not** a single accuracy figure — and states what it cannot establish.
Both baselines reproduce from a commit, so the "before" figures are evidence rather than
recollection. See [docs/ACCURACY_VALIDATION.md](docs/ACCURACY_VALIDATION.md).

Every held-out measure currently reaches a point estimate of 100 %, which is a statement about this
benchmark and not about Forge on your data. The samples are synthetic, the labelled sets are a few
dozen items, and most confidence bounds are too wide to support a 98 % claim — the report says so
for each measure, and §10 lists what the whole exercise cannot establish.

### The web interface

`forge serve` starts a local, single-user server (binds `127.0.0.1`; no accounts, no
database, nothing persisted) and hosts a browser client for the same engine: drop in
CSV/XLSX files, read the report across Overview / Cash Flow / Spending / Portfolio /
Risks / Scenarios / Data, and move the scenario sliders to re-run `simulate()`.

**It renders; it does not analyse.** Every figure is computed by the engine and formatted
by one pure, unit-tested adapter (`buildReportView`) before it reaches the page, so the
browser cannot invent a number the engine did not produce. Where a measure is missing —
no health score, no holdings, no anomalies over threshold — the interface says so and
gives the engine's reason instead of showing a zero. See
[DECISIONS.md D16](docs/DECISIONS.md).

---

## Documentation

| Document | Purpose |
| --- | --- |
| [docs/PROJECT_SCOPE.md](docs/PROJECT_SCOPE.md) | What Forge is and is **not** — the boundary. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, data flow, and design decisions. |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | **The engine ↔ interface contract** — canonical domain model + analysis outputs. |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architectural decision record (rationale). |
| [docs/ALGORITHM_REFERENCE.md](docs/ALGORITHM_REFERENCE.md) | Every metric's formula, units, assumptions, missing-data behaviour and known discrepancies. |
| [docs/ACCURACY_VALIDATION.md](docs/ACCURACY_VALIDATION.md) | The accuracy benchmark: method, rubric, defects found, measured results, limitations. |
| [docs/PROJECT_RULES.md](docs/PROJECT_RULES.md) | Engineering rules and conventions. |
| [docs/memory/PROJECT_STATE.md](docs/memory/PROJECT_STATE.md) | Current progress — read this first when resuming. |
| [docs/memory/SESSION_LOG.md](docs/memory/SESSION_LOG.md) | Chronological log of work done. |

---

## Tech stack

- **Language:** TypeScript (ESM), Node.js ≥ 20
- **CLI:** commander
- **Web:** `node:http` + vanilla client assets (no additional runtime dependency)
- **Ingestion:** SheetJS (`xlsx`) for Excel + CSV
- **Output:** chalk
- **Tests:** vitest

## License

MIT
