/*
 * Forge web client.
 *
 * This file renders; it does not analyse. Every figure it shows arrives from the server
 * already computed by the engine and formatted by `src/web/viewmodel.ts`. The only
 * numbers it touches are the scenario sliders, and those are sent back to the engine to
 * be simulated rather than resolved here.
 */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- state */

  var SCREENS = [
    { key: "overview", label: "Overview", kicker: "Report", title: "Overview" },
    { key: "cashflow", label: "Cash Flow", kicker: "Analysis", title: "Cash Flow" },
    { key: "spending", label: "Spending", kicker: "Analysis", title: "Spending" },
    { key: "portfolio", label: "Portfolio", kicker: "Analysis", title: "Portfolio" },
    { key: "risks", label: "Risks", kicker: "Investigation", title: "Risks & Findings" },
    { key: "scenarios", label: "Scenarios", kicker: "Simulation", title: "Scenarios" },
    { key: "data", label: "Data", kicker: "Provenance", title: "Data" }
  ];
  var SCREENS2 = [
    { key: "states", label: "Not assessed", kicker: "Reference", title: "What could not be assessed" },
    { key: "upload", label: "Replace dataset", kicker: "Ingestion", title: "Upload" }
  ];

  var PIPELINE = ["Raw data", "Normalization", "Analysis", "Evidence", "Reasoning", "Decision support"];

  var state = {
    screen: "upload",
    view: null,
    reportId: null,
    selected: null,
    sevFilter: "all",
    upload: "idle", // idle | running | error
    error: null,
    pending: [],
    scenario: null,
    scIncome: 0,
    scExpenses: 0,
    scBusy: false
  };

  var root = document.getElementById("root");
  var fileInput = document.getElementById("file-input");

  /* ---------------------------------------------------------------- helpers */

  function esc(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tone(t) {
    return "t-" + (t || "neutral");
  }

  function bgTone(t) {
    return "bg-" + (t || "neutral");
  }

  function pct(scale) {
    var n = Math.max(0, Math.min(1, Number(scale) || 0));
    return (n * 100).toFixed(1) + "%";
  }

  function screenMeta(key) {
    var all = SCREENS.concat(SCREENS2);
    for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
    return SCREENS[0];
  }

  function selectedFinding() {
    var list = state.view ? state.view.findings : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === state.selected) return list[i];
    return list[0] || null;
  }

  function go(screen) {
    state.screen = screen;
    if (screen === "upload") state.upload = "idle";
    render();
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------- transport */

  function post(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().then(function (payload) {
        if (!res.ok) {
          var err = new Error(payload.error || "Request failed");
          err.kind = payload.kind || "Error";
          throw err;
        }
        return payload;
      });
    });
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error("Could not read " + file.name));
      };
      reader.onload = function () {
        var result = String(reader.result);
        resolve({ name: file.name, base64: result.slice(result.indexOf(",") + 1) });
      };
      reader.readAsDataURL(file);
    });
  }

  function receiveReport(payload) {
    state.view = payload.view;
    state.reportId = payload.reportId;
    state.selected = payload.view.findings.length ? payload.view.findings[0].id : null;
    state.scIncome = Math.round(payload.view.scenarioBase.income);
    state.scExpenses = Math.round(payload.view.scenarioBase.expenses);
    state.scenario = null;
    state.sevFilter = "all";
    state.upload = "idle";
    state.error = null;
    state.pending = [];
    go("overview");
    refreshScenario();
  }

  function failed(err) {
    state.upload = "error";
    state.error = { message: err.message, kind: err.kind || "Error" };
    state.screen = "upload";
    render();
  }

  function analyzeFiles(files) {
    if (!files.length) return;
    state.pending = files.map(function (f) {
      return f.name;
    });
    state.upload = "running";
    state.error = null;
    render();
    Promise.all(files.map(readFileAsBase64))
      .then(function (encoded) {
        return post("/api/analyze", { files: encoded });
      })
      .then(receiveReport)
      .catch(failed);
  }

  function analyzeSamples() {
    state.pending = ["bundled sample dataset"];
    state.upload = "running";
    state.error = null;
    render();
    post("/api/samples", {}).then(receiveReport).catch(failed);
  }

  function refreshScenario() {
    if (!state.reportId || !state.view) return;
    var base = state.view.scenarioBase;
    var incomePct = base.income > 0 ? state.scIncome / base.income - 1 : 0;
    var expensePct = base.expenses > 0 ? state.scExpenses / base.expenses - 1 : 0;
    state.scBusy = true;
    post("/api/scenario", { reportId: state.reportId, incomePct: incomePct, expensePct: expensePct })
      .then(function (view) {
        state.scenario = view;
        state.scBusy = false;
        if (state.screen === "scenarios") render();
      })
      .catch(function (err) {
        state.scBusy = false;
        state.scenario = null;
        state.error = { message: err.message, kind: err.kind };
        if (state.screen === "scenarios") render();
      });
  }

  var scenarioTimer = null;
  function scenarioChanged() {
    if (scenarioTimer) clearTimeout(scenarioTimer);
    scenarioTimer = setTimeout(refreshScenario, 180);
  }

  /* ---------------------------------------------------------------- upload screen */

  function uploadScreen() {
    var body;
    if (state.upload === "running") {
      body =
        '<div style="padding:34px 36px;">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;">' +
        '<h4 style="font-size:16px;margin:0;">Running the pipeline</h4>' +
        '<span class="mono" style="font-size:11px;color:var(--f-tx3);">' +
        esc(state.pending.join(", ")) +
        "</span></div>" +
        '<div class="progress"><span style="width:66%"></span></div>' +
        PIPELINE.map(function (label, i) {
          return (
            '<div class="pipe-row"><span class="kicker ' +
            (i < 3 ? "t-positive" : "t-accent") +
            '">' +
            (i < 3 ? "Reading" : "Queued") +
            '</span><span style="font-size:12.5px;">' +
            esc(label) +
            "</span></div>"
          );
        }).join("") +
        "</div>";
    } else if (state.upload === "error") {
      body =
        '<div style="padding:34px 36px;">' +
        '<div style="display:flex;align-items:center;gap:9px;margin-bottom:12px;">' +
        '<span class="bg-critical" style="width:8px;height:8px;border-radius:1px;"></span>' +
        '<span class="kicker t-critical">' +
        esc(state.error ? state.error.kind : "Error") +
        "</span></div>" +
        '<h4 style="font-size:18px;line-height:1.3;margin:0 0 10px;">' +
        esc(state.error ? state.error.message : "") +
        "</h4>" +
        '<p style="font-size:13px;color:var(--f-tx2);max-width:66ch;margin:0 0 16px;">Forge stopped rather than producing a partial or assumed result. Nothing was inferred to work around the problem.</p>' +
        '<div style="display:flex;gap:10px;margin-top:20px;">' +
        '<button class="btn btn-primary" data-act="pick">Upload different files</button>' +
        (state.view ? '<button class="btn" data-act="go" data-screen="data">Inspect current sources</button>' : "") +
        "</div></div>";
    } else {
      body =
        '<div class="dropzone-idle">' +
        '<div class="drop-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4"></path><path d="M7 9l5-5 5 5"></path><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"></path></svg></div>' +
        '<h4 style="font-size:17px;font-weight:500;margin:0 0 6px;letter-spacing:-0.01em;">Upload financial data</h4>' +
        '<p style="font-size:13px;color:var(--f-tx3);margin:0 0 22px;">Drop files here, or select them from disk.</p>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
        '<button class="btn btn-primary" data-act="pick">Select files</button>' +
        '<button class="btn" data-act="samples">Use sample dataset</button>' +
        (state.view ? '<button class="btn" data-act="go" data-screen="overview">Back to report</button>' : "") +
        "</div>" +
        '<div class="formats"><span>CSV</span><span style="color:var(--f-line2);">/</span><span>XLSX</span>' +
        '<span style="color:var(--f-line2);">/</span><span>Several sources per report</span>' +
        '<span style="color:var(--f-line2);">/</span><span>Single currency</span></div>' +
        "</div>";
    }

    return (
      '<div class="upload-shell">' +
      '<div class="upload-head"><span class="brandmark">FORGE</span>' +
      '<span class="kicker">Financial Reasoning Engine</span>' +
      (state.view ? '<a href="#" data-act="go" data-screen="overview" style="margin-left:auto;" class="kicker">Back to report &rarr;</a>' : "") +
      "</div>" +
      '<div class="upload-body"><div class="upload-inner">' +
      '<div class="kicker t-accent" style="margin-bottom:14px;">Ingestion</div>' +
      '<h1 class="editorial">Turn financial data into explainable insights.</h1>' +
      '<p class="lede">Forge normalizes statements and holdings into one model, runs deterministic analysis over it, and reports what it found. Every conclusion carries the evidence it was drawn from.</p>' +
      '<div class="dropzone" id="dropzone">' +
      body +
      "</div>" +
      '<div class="pipeline">' +
      PIPELINE.map(function (label, i) {
        return (
          '<span class="pipe-step' +
          (i >= 3 ? " on" : "") +
          '">' +
          esc(label) +
          "</span>" +
          (i === PIPELINE.length - 1 ? "" : '<span class="pipe-arrow">&rarr;</span>')
        );
      }).join("") +
      "</div></div></div>" +
      '<div class="upload-foot">Deterministic analysis &middot; no figure shown in Forge is calculated by the interface</div>' +
      "</div>"
    );
  }

  /* ---------------------------------------------------------------- shell */

  function rail() {
    var v = state.view;
    return (
      '<div class="rail">' +
      '<div class="rail-head"><div class="brandmark">FORGE</div>' +
      '<div class="kicker navlabel" style="margin-top:3px;">Reasoning engine</div></div><hr>' +
      "<nav>" +
      SCREENS.map(function (s, i) {
        var badge = s.key === "risks" ? String(v.findings.length) : s.key === "data" ? String(v.data.sources.length) : "";
        return (
          '<a href="#" data-act="go" data-screen="' +
          s.key +
          '" class="' +
          (state.screen === s.key ? "on" : "") +
          '"><span class="num">' +
          ("0" + (i + 1)) +
          '</span><span class="navlabel">' +
          esc(s.label) +
          '</span><span class="badge">' +
          esc(badge) +
          "</span></a>"
        );
      }).join("") +
      "</nav><hr><nav>" +
      SCREENS2.map(function (s) {
        return (
          '<a href="#" data-act="go" data-screen="' +
          s.key +
          '" class="' +
          (state.screen === s.key ? "on" : "") +
          '"><span class="num">&middot;</span><span class="navlabel">' +
          esc(s.label) +
          "</span><span></span></a>"
        );
      }).join("") +
      "</nav>" +
      '<div class="rail-foot"><div class="kicker" style="color:var(--f-tx2);margin-bottom:4px;">Report</div>' +
      "<div>forge_report &middot; " +
      esc(v.meta.currency || "—") +
      "</div><div>" +
      esc(v.meta.rangeLabel) +
      " &middot; " +
      esc(v.meta.months) +
      "P</div>" +
      '<div style="margin-top:8px;"><a href="#" data-act="go" data-screen="upload" style="font-size:10px;">Replace dataset</a></div></div>' +
      "</div>"
    );
  }

  function topbar() {
    var s = screenMeta(state.screen);
    return (
      '<div class="topbar"><div class="ctx"><span class="kick">' +
      esc(s.kicker) +
      "</span><h2>" +
      esc(s.title) +
      '</h2><span class="meta">' +
      esc(state.view.meta.contextMeta) +
      "</span></div>" +
      '<a href="#" class="kicker mobnav" data-act="next">Next &rarr;</a></div>'
    );
  }

  /* ---------------------------------------------------------------- screens */

  function tileHtml(t) {
    return (
      '<div class="tile"><div class="head"><span class="kicker">' +
      esc(t.label) +
      '</span><span class="kicker">' +
      esc(t.op) +
      '</span></div><div class="fig">' +
      esc(t.value) +
      '</div><div class="foot"><span class="delta ' +
      tone(t.deltaTone) +
      '">' +
      esc(t.delta) +
      '</span><span class="sub">' +
      esc(t.sub) +
      "</span></div>" +
      (t.bar
        ? '<div class="bar"><span class="' + bgTone(t.bar.tone) + '" style="width:' + esc(t.bar.pct) + '"></span></div>'
        : "") +
      "</div>"
    );
  }

  function bandHtml() {
    var v = state.view;
    return (
      '<div class="band"><div class="band-row">' +
      v.band.map(tileHtml).join("") +
      '</div><div class="relations">' +
      v.relations
        .map(function (r) {
          return (
            '<div class="relation"><div class="line"><span class="kicker">' +
            esc(r.label) +
            '</span><span class="val">' +
            esc(r.value) +
            '</span><span class="delta ' +
            tone(r.tone) +
            '">' +
            esc(r.delta) +
            '</span></div><div class="note">' +
            esc(r.note) +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>"
    );
  }

  function findingsList() {
    var v = state.view;
    var visible = v.findings.filter(function (f) {
      return state.sevFilter === "all" || f.severity === state.sevFilter;
    });
    var sel = selectedFinding();

    var rows = visible.length
      ? visible
          .map(function (f) {
            var on = sel && f.id === sel.id;
            return (
              '<div class="finding ' +
              (on ? "on" : "") +
              '" data-act="pick" data-id="' +
              esc(f.id) +
              '"><div class="top"><span class="dot ' +
              bgTone(f.tone) +
              '"></span><span class="sev ' +
              tone(f.tone) +
              '">' +
              esc(f.severityLabel) +
              '</span><span class="rid">' +
              esc(f.id) +
              '</span></div><div class="headline">' +
              esc(f.headline) +
              '</div><div class="expl">' +
              esc(f.explanation) +
              '</div><div class="bar"><span>CONF ' +
              esc(f.confidence) +
              '</span><span style="color:var(--f-line2);">|</span><span>' +
              esc(f.drivers.length) +
              ' DRIVERS</span><span class="cta">' +
              (on ? "Shown" : "Why?") +
              "</span></div></div>"
            );
          })
          .join("")
      : '<div class="panel-pad" style="color:var(--f-tx3);font-size:12.5px;">No insight at this severity. Forge emits an insight only when the data supports one — an empty list is a result, not a gap.</div>';

    return (
      '<div class="panel"><div class="panel-head"><span>' +
      (state.screen === "risks" ? "Flagged risks &amp; findings" : "Key findings") +
      '</span><span class="right mono">' +
      visible.length +
      "/" +
      v.findings.length +
      " &middot; by severity</span></div>" +
      rows +
      "</div>"
    );
  }

  function detailPanel() {
    var f = selectedFinding();
    if (!f) {
      return (
        '<div class="panel"><div class="panel-head"><span>Why Forge reached this conclusion</span></div>' +
        '<div class="detail"><p class="expl">No insight was produced for this dataset. Every reasoning rule requires evidence and a non-zero basis; none fired. Nothing was invented to fill the panel.</p></div></div>'
      );
    }
    return (
      '<div class="panel"><div class="panel-head"><span>Why Forge reached this conclusion</span>' +
      '<span class="right mono">' +
      esc(f.id) +
      "</span></div>" +
      '<div class="detail">' +
      '<div style="display:flex;align-items:center;gap:9px;margin-bottom:9px;"><span class="dot ' +
      bgTone(f.tone) +
      '" style="width:7px;height:7px;border-radius:1px;"></span><span class="sev kicker ' +
      tone(f.tone) +
      '">' +
      esc(f.severityLabel) +
      "</span></div>" +
      '<h3 class="editorial">' +
      esc(f.headline) +
      "</h3>" +
      '<p class="expl">' +
      esc(f.explanation) +
      "</p>" +
      '<div class="steps">' +
      '<div><div class="step-head"><span class="n">01</span><span class="t">Evidence</span></div>' +
      '<div class="grid g-evidence"><div class="h">Measure</div><div class="h">Detail</div><div class="h r">Module</div><div class="h r">Value</div>' +
      f.evidence
        .map(function (e) {
          return (
            '<div class="c">' +
            esc(e.label) +
            '</div><div class="c" style="color:var(--f-tx);">' +
            esc(e.detail) +
            '</div><div class="c n t-muted">' +
            esc(e.module) +
            '</div><div class="c n">' +
            esc(e.value) +
            "</div>"
          );
        })
        .join("") +
      "</div></div>" +
      '<div><div class="step-head"><span class="n">02</span><span class="t">Drivers</span></div>' +
      f.drivers
        .map(function (d) {
          return '<div class="driver"><span class="m">&rsaquo;</span><span>' + esc(d) + "</span></div>";
        })
        .join("") +
      "</div>" +
      '<div><div class="step-head"><span class="n">03</span><span class="t">Traceability</span></div>' +
      '<p style="margin:0;font-size:13px;color:var(--f-tx);max-width:64ch;">Produced by rule <span class="mono">' +
      esc(f.id) +
      "</span> from " +
      esc(f.basis.length) +
      " analysis module(s). Every row above is data the engine read, not a restatement of the conclusion.</p></div>" +
      "</div>" +
      '<div class="detail-foot"><div>' +
      '<div class="kicker" style="margin-bottom:9px;">Confidence</div>' +
      '<div style="display:flex;align-items:baseline;gap:9px;"><span class="mono" style="font-size:19px;">' +
      esc(f.confidence) +
      '</span><span class="kicker">' +
      esc(f.confidenceLabel) +
      "</span></div>" +
      '<div class="ticks">' +
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
        .map(function (i) {
          return '<span class="' + (i < f.confidenceTicks ? "on" : "") + '"></span>';
        })
        .join("") +
      "</div></div><div>" +
      '<div class="kicker" style="margin-bottom:9px;">Basis</div><div class="chips">' +
      f.basis
        .map(function (b) {
          return '<span class="chip">analyses.' + esc(b) + "</span>";
        })
        .join("") +
      '</div><div style="margin-top:12px;"><a href="#" class="kicker" data-act="go" data-screen="data">Inspect underlying data &rarr;</a></div>' +
      "</div></div></div></div>"
    );
  }

  function overviewScreen() {
    return bandHtml() + '<div class="split">' + findingsList() + detailPanel() + "</div>";
  }

  function risksScreen() {
    var v = state.view;
    return (
      '<div class="ledger">' +
      v.severityLedger
        .map(function (s) {
          var on = state.sevFilter === s.key;
          return (
            '<button data-act="sev" data-sev="' +
            esc(s.key) +
            '" class="' +
            (on ? "on" : "") +
            '" style="border-left-color:' +
            (on ? "currentColor" : "transparent") +
            ';"><span class="dot ' +
            bgTone(s.tone) +
            '"></span><span><span class="lbl ' +
            tone(s.tone) +
            '">' +
            esc(s.label) +
            '</span><span class="note">' +
            esc(s.note) +
            '</span></span><span class="count ' +
            (s.count === 0 ? "t-muted" : "t-neutral") +
            '">' +
            s.count +
            "</span></button>"
          );
        })
        .join("") +
      '</div><div class="split">' +
      findingsList() +
      detailPanel() +
      "</div>"
    );
  }

  function cashflowScreen() {
    var cf = state.view.cashflow;
    var n = Math.max(1, cf.months.length);
    var cols = "repeat(" + n + ", minmax(0,1fr))";

    if (cf.months.length === 0) {
      return (
        '<div class="state"><div class="title">No monthly cash-flow series is available.</div>' +
        "<p>" + esc(cf.note) + "</p></div>"
      );
    }

    return (
      '<div class="split"><div class="panel">' +
      '<div class="panel-head"><span>Inflow against outflow &middot; ' +
      cf.months.length +
      ' month(s)</span><span class="legend"><span><span class="swatch-in"></span>Inflow</span><span><span class="swatch-out"></span>Outflow</span></span></div>' +
      '<div style="padding:16px 14px;">' +
      '<div class="chart" style="grid-template-columns:' +
      cols +
      '">' +
      cf.months
        .map(function (m) {
          return (
            '<div class="pair" title="' +
            esc(m.label + " — in " + m.inflow + ", out " + m.outflow) +
            '"><div class="in" style="height:' +
            pct(m.inflowScale) +
            '"></div><div class="out" style="height:' +
            pct(m.outflowScale) +
            '"></div></div>'
          );
        })
        .join("") +
      '</div><div class="chart-labels" style="grid-template-columns:' +
      cols +
      '">' +
      cf.months
        .map(function (m) {
          return (
            '<div><div class="m">' +
            esc(m.label) +
            '</div><div class="net ' +
            tone(m.tone) +
            '">' +
            esc(m.net) +
            '</div><div class="rate">' +
            esc(m.rate) +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>" +
      '<div style="border-top:1px solid var(--f-line);padding:12px 14px;font-size:12.5px;color:var(--f-tx2);">' +
      esc(cf.note) +
      "</div></div>" +
      '<div class="panel"><div class="panel-head"><span>Period comparison</span></div><div class="panel-pad">' +
      (cf.compare.length
        ? '<div class="grid g-compare"><div class="h">Measure</div><div class="h r">Earlier half</div><div class="h r">Recent half</div><div class="h r">Change</div>' +
          cf.compare
            .map(function (c) {
              return (
                '<div class="c">' +
                esc(c.label) +
                '</div><div class="c n t-muted">' +
                esc(c.earlier) +
                '</div><div class="c n">' +
                esc(c.recent) +
                '</div><div class="c n ' +
                tone(c.tone) +
                '">' +
                esc(c.change) +
                "</div>"
              );
            })
            .join("") +
          "</div>"
        : '<p style="margin:0;font-size:12.5px;color:var(--f-tx3);">A period-over-period comparison needs at least two months of transactions.</p>') +
      "</div></div></div>"
    );
  }

  function spendingScreen() {
    var sp = state.view.spending;
    return (
      '<div class="split"><div class="panel">' +
      '<div class="panel-head"><span>By category &middot; whole period</span><span class="right mono">TOTAL ' +
      esc(sp.total) +
      "</span></div>" +
      '<div class="panel-pad"><div class="grid g-cats"><div class="h">Category</div><div class="h r">Amount</div><div class="h r">Share</div>' +
      sp.rows
        .map(function (c) {
          return (
            '<div class="c">' +
            esc(c.label) +
            '<div class="minibar"><span class="' +
            (c.flagged ? "bg-high" : "bg-muted") +
            '" style="width:' +
            pct(c.scale) +
            '"></span></div></div><div class="c n">' +
            esc(c.amount) +
            '</div><div class="c n t-muted">' +
            esc(c.share) +
            "</div>"
          );
        })
        .join("") +
      "</div></div></div>" +
      '<div class="panel"><div class="panel-head"><span>Explaining the change</span></div><div class="panel-pad">' +
      '<p style="margin:0 0 18px;font-size:13px;color:var(--f-tx2);max-width:62ch;">' +
      esc(sp.note) +
      "</p>" +
      '<div class="kicker" style="margin-bottom:10px;">Outliers &amp; category shifts</div>' +
      (sp.anomalies.length
        ? sp.anomalies
            .map(function (a) {
              return (
                '<div class="anomaly"><div class="line"><span class="lbl">' +
                esc(a.label) +
                '</span><span class="tag ' +
                tone(a.tone) +
                '">' +
                esc(a.tag) +
                '</span><span class="amt">' +
                esc(a.amount) +
                '</span></div><div class="note">' +
                esc(a.note) +
                "</div></div>"
              );
            })
            .join("")
        : '<p style="margin:0;font-size:12.5px;color:var(--f-tx3);">Nothing crossed the outlier threshold. Forge reports that as a result rather than an empty panel.</p>') +
      "</div></div></div>"
    );
  }

  function portfolioScreen() {
    var p = state.view.portfolio;
    if (p.holdings.length === 0) {
      return (
        '<div class="state"><div class="title">No holdings detected in this dataset.</div>' +
        "<p>Asset allocation and concentration analysis are unavailable. Add a holdings table to enable them.</p></div>"
      );
    }
    return (
      '<div class="cols-2" style="margin-bottom:14px;">' +
      '<div class="panel"><div class="panel-head"><span>Asset allocation</span><span class="right mono">TOTAL ' +
      esc(p.total) +
      '</span></div><div style="padding:8px 14px 14px;">' +
      p.allocation
        .map(function (a) {
          return (
            '<div class="alloc"><div class="line"><span style="font-size:12.5px;color:var(--f-tx2);">' +
            esc(a.label) +
            '</span><span class="pct">' +
            esc(a.pct) +
            '</span><span class="val">' +
            esc(a.value) +
            '</span></div><div class="minibar"><span class="' +
            (a.isCash ? "bg-muted" : "bg-accent") +
            '" style="width:' +
            pct(a.scale) +
            '"></span></div></div>'
          );
        })
        .join("") +
      '<div style="font-size:11.5px;color:var(--f-tx3);margin-top:10px;">Invested ' +
      esc(p.invested) +
      " &middot; cash is held outside the concentration measure.</div></div></div>" +
      '<div class="panel"><div class="panel-head"><span>Concentration</span>' +
      (p.concentrationFlagged
        ? '<span class="tag t-high">Threshold exceeded</span>'
        : '<span class="tag t-positive">Within threshold</span>') +
      '</div><div style="padding:8px 14px 14px;">' +
      p.concentration
        .map(function (c) {
          return (
            '<div class="conc"><div><div style="font-size:12.5px;color:var(--f-tx2);">' +
            esc(c.label) +
            '</div><div class="note">' +
            esc(c.note) +
            '</div></div><div class="val ' +
            tone(c.tone) +
            '">' +
            esc(c.value) +
            "</div></div>"
          );
        })
        .join("") +
      '<div style="margin-top:12px;"><a href="#" class="kicker" data-act="go" data-screen="risks">Why this was flagged &rarr;</a></div>' +
      "</div></div></div>" +
      '<div class="panel"><div class="panel-head"><span>Holdings</span></div><div class="panel-pad">' +
      '<div class="grid g-holdings"><div class="h">#</div><div class="h">Holding</div><div class="h">Class</div><div class="h r">Value</div><div class="h r">Weight</div>' +
      p.holdings
        .map(function (h) {
          return (
            '<div class="c mono" style="font-size:10px;color:var(--f-tx3);">' +
            esc(h.rank) +
            '</div><div class="c" style="color:var(--f-tx);">' +
            esc(h.label) +
            '</div><div class="c" style="font-size:11.5px;color:var(--f-tx3);">' +
            esc(h.cls) +
            '</div><div class="c n">' +
            esc(h.value) +
            '</div><div class="c"><div class="n ' +
            tone(h.tone) +
            '">' +
            esc(h.pct) +
            '</div><div class="minibar" style="height:2px;"><span class="' +
            (h.tone === "high" ? "bg-high" : "bg-accent") +
            '" style="height:2px;width:' +
            pct(h.scale) +
            '"></span></div></div>'
          );
        })
        .join("") +
      "</div></div></div>"
    );
  }

  function scenariosScreen() {
    var v = state.view;
    var base = v.scenarioBase;
    var sc = state.scenario;
    var incMax = Math.max(1, Math.round(base.income * 1.5));
    var expMax = Math.max(1, Math.round(base.expenses * 1.5));

    if (base.income === 0 && base.expenses === 0) {
      return (
        '<div class="state"><div class="title">Scenario simulation needs transaction data.</div>' +
        "<p>This dataset has no monthly inflow or outflow to vary, so there is nothing to re-run the pipeline against.</p></div>"
      );
    }

    return (
      '<div class="split scenario-layout" style="grid-template-columns:300px minmax(0,1fr);">' +
      '<div class="panel"><div class="panel-head"><span>What if?</span></div><div style="padding:16px 14px 14px;">' +
      sliderHtml("income", "Mean monthly inflow", state.scIncome, 0, incMax, base.income) +
      sliderHtml("expenses", "Mean monthly outflow", state.scExpenses, 0, expMax, base.expenses) +
      '<button class="btn" style="width:100%;" data-act="sc-reset">Reset to reported values</button>' +
      '<p style="font-size:11.5px;color:var(--f-tx3);margin:16px 0 0;">The engine applies the change to every transaction in the normalized model and re-runs the full analysis. Prices, returns and inflation are not modelled.</p>' +
      "</div></div>" +
      '<div class="panel"><div class="panel-head"><span>Current &middot; scenario &middot; change</span>' +
      '<span class="right mono">' +
      (state.scBusy ? "simulating…" : sc ? esc(sc.description) : "") +
      "</span></div><div class=\"panel-pad\">" +
      (sc
        ? '<div class="grid g-scenario"><div class="h">Measure</div><div class="h r">Current</div><div class="h r">Scenario</div><div class="h r">Change</div>' +
          sc.rows
            .map(function (r) {
              return (
                '<div class="c">' +
                esc(r.label) +
                '</div><div class="c n t-muted">' +
                esc(r.current) +
                '</div><div class="c n" style="font-size:15px;">' +
                esc(r.scenario) +
                '</div><div class="c n ' +
                tone(r.tone) +
                '">' +
                esc(r.change) +
                "</div>"
              );
            })
            .join("") +
          '</div><div class="verdict" style="border-left-color:var(--f-' +
          (sc.verdictTone === "critical" ? "crit" : sc.verdictTone === "high" ? "high" : "pos") +
          ');"><span class="kicker ' +
          tone(sc.verdictTone) +
          '" style="padding-top:2px;">Engine reading</span><p>' +
          esc(sc.explanation) +
          "</p></div>"
        : '<p style="margin:0;font-size:12.5px;color:var(--f-tx3);">Running the scenario…</p>') +
      "</div></div></div>"
    );
  }

  function sliderHtml(key, label, value, min, max, reported) {
    return (
      '<div style="margin-bottom:22px;">' +
      '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px;">' +
      '<span style="font-size:12.5px;color:var(--f-tx2);">' +
      esc(label) +
      '</span><span class="mono" style="font-size:15px;">' +
      esc(Math.round(value).toLocaleString("en-US")) +
      "</span></div>" +
      '<input type="range" data-act="slider" data-key="' +
      key +
      '" min="' +
      min +
      '" max="' +
      max +
      '" step="1" value="' +
      Math.round(value) +
      '">' +
      '<div style="display:flex;justify-content:space-between;" class="mono"><span style="font-size:9.5px;color:var(--f-tx3);">' +
      min +
      '</span><span style="font-size:9.5px;color:var(--f-tx3);">reported ' +
      esc(Math.round(reported).toLocaleString("en-US")) +
      '</span><span style="font-size:9.5px;color:var(--f-tx3);">' +
      max.toLocaleString("en-US") +
      "</span></div></div>"
    );
  }

  function dataScreen() {
    var d = state.view.data;
    return (
      '<div class="facts">' +
      d.facts
        .map(function (f) {
          return (
            '<div class="fact"><div class="kicker" style="margin-bottom:5px;">' +
            esc(f.label) +
            '</div><div class="v ' +
            tone(f.tone) +
            '">' +
            esc(f.value) +
            "</div></div>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="panel" style="margin-bottom:14px;"><div class="panel-head"><span>Sources</span></div><div class="panel-pad">' +
      '<div class="grid g-sources"><div class="h">File</div><div class="h">Format</div><div class="h r">Rows</div><div class="h r">Parsed</div><div class="h r">Skipped</div><div class="h r">Range</div>' +
      d.sources
        .map(function (s) {
          return (
            '<div class="c mono" style="font-size:11.5px;color:var(--f-tx);">' +
            esc(s.name) +
            '</div><div class="c" style="font-size:11.5px;color:var(--f-tx3);">' +
            esc(s.kind) +
            '</div><div class="c n">' +
            esc(s.rows) +
            '</div><div class="c n t-positive">' +
            esc(s.parsed) +
            '</div><div class="c n ' +
            (s.skipped === "0" ? "t-muted" : "t-high") +
            '">' +
            esc(s.skipped) +
            '</div><div class="c n" style="font-size:11px;color:var(--f-tx3);">' +
            esc(s.range) +
            "</div>"
          );
        })
        .join("") +
      "</div></div></div>" +
      '<div class="cols-2"><div class="panel"><div class="panel-head"><span>Normalization warnings</span></div>' +
      '<div style="padding:6px 14px 14px;">' +
      (d.warnings.length
        ? d.warnings
            .map(function (w) {
              return (
                '<div class="warn"><span class="lv ' +
                tone(w.tone) +
                '">' +
                esc(w.level) +
                '</span><span class="tx">' +
                esc(w.text) +
                "</span></div>"
              );
            })
            .join("")
        : '<p style="margin:10px 0;font-size:12.5px;color:var(--f-tx3);">No warnings. Every row in every source was parsed without ambiguity.</p>') +
      "</div></div>" +
      '<div class="panel"><div class="panel-head"><span>What exactly was analyzed</span></div><div class="panel-pad">' +
      '<p style="margin:0 0 12px;font-size:13px;color:var(--f-tx2);max-width:62ch;">' +
      esc(d.summary) +
      "</p>" +
      '<div style="border-top:1px solid var(--f-line);padding-top:10px;" class="mono" style="font-size:10.5px;color:var(--f-tx3);">deterministic &middot; re-running on the same input reproduces this report exactly</div>' +
      "</div></div></div>"
    );
  }

  function statesScreen() {
    var list = state.view.unavailable;
    return (
      '<p style="margin:0 0 14px;font-size:13px;color:var(--f-tx2);max-width:72ch;">When an analysis cannot run, Forge states what is missing and why the measure is unavailable. It never substitutes a zero for an unknown.</p>' +
      (list.length
        ? '<div class="cols-2">' +
          list
            .map(function (e) {
              return (
                '<div class="state"><div class="kicker" style="margin-bottom:9px;">' +
                esc(e.tag) +
                '</div><div class="title">' +
                esc(e.title) +
                "</div><p>" +
                esc(e.body) +
                "</p></div>"
              );
            })
            .join("") +
          "</div>"
        : '<div class="state"><div class="title">Every analysis module ran on this dataset.</div><p>Nothing was withheld for missing data.</p></div>') +
      (state.error
        ? '<div class="state error-card" style="margin-top:14px;">' +
          '<div style="display:flex;align-items:center;gap:9px;margin-bottom:9px;"><span class="bg-critical" style="width:8px;height:8px;border-radius:1px;"></span>' +
          '<span class="kicker t-critical">' +
          esc(state.error.kind) +
          "</span></div>" +
          '<div class="title">' +
          esc(state.error.message) +
          "</div></div>"
        : "")
    );
  }

  /* ---------------------------------------------------------------- render */

  var RENDERERS = {
    overview: overviewScreen,
    risks: risksScreen,
    cashflow: cashflowScreen,
    spending: spendingScreen,
    portfolio: portfolioScreen,
    scenarios: scenariosScreen,
    data: dataScreen,
    states: statesScreen
  };

  function render() {
    if (state.screen === "upload" || !state.view) {
      root.innerHTML = uploadScreen();
      wireDropzone();
      return;
    }
    var renderer = RENDERERS[state.screen] || overviewScreen;
    root.innerHTML =
      '<div class="app">' + rail() + '<div style="min-width:0;">' + topbar() + '<div class="screen-body">' + renderer() + "</div></div></div>";
  }

  /* ---------------------------------------------------------------- events */

  function wireDropzone() {
    var zone = document.getElementById("dropzone");
    if (!zone) return;
    ["dragenter", "dragover"].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.add("dragging");
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.remove("dragging");
      });
    });
    zone.addEventListener("drop", function (e) {
      analyzeFiles(Array.prototype.slice.call(e.dataTransfer.files));
    });
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) return;
    var act = el.getAttribute("data-act");
    if (act === "slider") return;
    e.preventDefault();

    if (act === "go") go(el.getAttribute("data-screen"));
    else if (act === "pick") {
      if (el.hasAttribute("data-id")) {
        state.selected = el.getAttribute("data-id");
        render();
      } else fileInput.click();
    } else if (act === "samples") analyzeSamples();
    else if (act === "sev") {
      var next = el.getAttribute("data-sev");
      state.sevFilter = state.sevFilter === next ? "all" : next;
      render();
    } else if (act === "sc-reset") {
      state.scIncome = Math.round(state.view.scenarioBase.income);
      state.scExpenses = Math.round(state.view.scenarioBase.expenses);
      render();
      refreshScenario();
    } else if (act === "next") {
      var i = 0;
      for (var k = 0; k < SCREENS.length; k++) if (SCREENS[k].key === state.screen) i = k;
      go(SCREENS[(i + 1) % SCREENS.length].key);
    }
  });

  document.addEventListener("input", function (e) {
    var el = e.target;
    if (el.getAttribute && el.getAttribute("data-act") === "slider") {
      var value = Number(el.value);
      if (el.getAttribute("data-key") === "income") state.scIncome = value;
      else state.scExpenses = value;
      var readout = el.parentNode.querySelector(".mono");
      if (readout) readout.textContent = Math.round(value).toLocaleString("en-US");
      scenarioChanged();
    }
  });

  fileInput.addEventListener("change", function () {
    analyzeFiles(Array.prototype.slice.call(fileInput.files));
    fileInput.value = "";
  });

  render();
})();
