// Karsan tracker: henter config og CSV, regner via calc.js og tegner siden.
// Ingen tall er hardkodet her. Terskler kommer fra config/signals.json.
import * as C from "./calc.js?v=__VERSION__";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const today = new Date().toISOString().slice(0, 10);

const STATUS_LABEL = { ok: "OK", utdatert: "Utdatert", feilet: "Feilet", ikke_publisert: "Ikke publisert (lisens)" };
const SOURCE_LABEL = { fred: "FRED", treasury: "U.S. Treasury", yahoo: "Yahoo (uoffisiell)" };
const VERDICT = {
  mot: "I retning narrativet",
  bort: "Bort fra narrativet",
  uendret: "Uendret",
  ingen_retning: "Ingen retning i narrativet",
};

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

// Fungerer både når site/ serveres alene (data/ kopiert inn) og fra reporoten.
async function detectBase() {
  for (const base of ["", "../"]) {
    try {
      const r = await fetch(base + "config/signals.json", { cache: "no-cache" });
      if (r.ok) return base;
    } catch (e) { /* prøv neste */ }
  }
  throw new Error("Fant ikke config/signals.json");
}

async function load() {
  const base = await detectBase();
  const [seriesCfg, signals, status] = await Promise.all([
    fetchText(base + "config/series.json").then(JSON.parse),
    fetchText(base + "config/signals.json").then(JSON.parse),
    fetchText(base + "data/status.json").then(JSON.parse),
  ]);
  const meta = Object.fromEntries(seriesCfg.series.map((s) => [s.id, s]));
  // Privat lokal visning: private/ finnes bare på egen maskin (scripts/lokal_visning.py), aldri på Pages.
  const priv = await fetchText(base + "private/status.json").then(JSON.parse).catch(() => null);
  const privateIds = new Set();
  if (priv) {
    for (const [id, st] of Object.entries(priv.series)) {
      if (st.status !== "ok") continue;
      status.series[id] = { ...status.series[id], ...st, private: true };
      privateIds.add(id);
    }
  }
  const dataPath = (id) => `${base}${privateIds.has(id) ? "private/" : ""}data/${id}.csv`;
  const data = {};
  await Promise.all(seriesCfg.series.map(async (s) => {
    const st = status.series[s.id];
    if (!st || !st.rows || st.status === "ikke_publisert") return;
    try { data[s.id] = C.parseCsv(await fetchText(dataPath(s.id))); } catch (e) { /* vises som manglende */ }
  }));
  // Nyheter er valgfrie: siden fungerer uten dem.
  const opt = (p) => fetchText(base + p).then(JSON.parse).catch(() => null);
  const [newsCfg, news, labels, summary, episodes] = await Promise.all([opt("config/news.json"), opt("data/news.json"), opt("config/news_labels.json"), opt("data/news_summary.json"), opt("data/karsan_episodes.json")]);
  return { base, meta, signals, status, data, dataPath, privateIds, privateGenerated: priv && priv.generated, newsCfg, news, summary, episodes, labels: (labels && labels.labels) || {} };
}

// ---------- Hjelpere ----------

function unitOf(meta, id) { return meta[id] ? meta[id].unit : ""; }

function missingReason(ctx, ids) {
  for (const id of ids || []) {
    const st = ctx.status.series[id];
    if (st && st.status === "ikke_publisert") return `Ikke publisert: ${ctx.meta[id].license}`;
    if (st && st.status === "feilet") return `Henting feilet: ${st.message || ""}`;
  }
  return "Ingen data";
}

function sourceLine(ctx, id) {
  const m = ctx.meta[id];
  return `${SOURCE_LABEL[m.source]} ${m.source === "treasury" ? m.column : m.source_id}`;
}

function staleTag(ctx, id, date) {
  const m = ctx.meta[id];
  return C.isStale(date, today, m.max_age_days) ? ' <span class="stale">utdatert</span>' : "";
}

function valueText(ctx, id, transform, v) {
  if (transform === "drawdown") return `${C.fmtNum(v, 1)} % under topp`;
  if (transform === "yoy") return `${C.fmtNum(v, 1)} %`;
  const sc = C.displayScale(unitOf(ctx.meta, id));
  const dec = sc.decimals ?? ctx.meta[id].decimals;
  const u = sc.unit === "%" ? " %" : sc.unit && !sc.unit.startsWith("indeks") ? ` ${sc.unit}` : "";
  return C.fmtNum(v * sc.factor, dec) + u;
}

function changeText(v, mode) {
  return mode === "pct" ? `${C.fmtSigned(v, 1)} %` : `${C.fmtSigned(v, 2)} pp`;
}

// ---------- Regime ----------

function condTag(r) {
  if (!r.covered) return '<span class="tag na">Ikke dekket</span>';
  return r.met ? '<span class="tag ok">Oppfylt</span>' : '<span class="tag no">Ikke oppfylt</span>';
}

function condValue(c) {
  const r = c.result;
  if (!r.covered) return "";
  const u = c.unit === "pp" ? " pp" : c.unit === "%" ? " %" : "";
  const v = c.metric === "last" ? C.fmtNum(r.value, 2) : C.fmtSigned(r.value, 2);
  return `${v}${u}`;
}

function renderRegime(ctx, regime) {
  const cur = regime.current;
  $("#phases").innerHTML = regime.phases.map((p) => {
    const st = p.eval.reached === true ? "Nådd" : p.eval.reached === false ? "Ikke nådd" : "Kan ikke vurderes";
    const cls = ["phase", p.eval.reached === true ? "reached" : "", p.eval.reached === null ? "unknown" : "", p.id === cur.id ? "current" : ""].join(" ");
    return `<li class="${cls}"><span class="pname">${esc(p.name)}</span><span class="pstate">${p.id === cur.id ? "Gjeldende fase" : st}</span></li>`;
  }).join("");

  const conds = regime.phases.filter((p) => p.conditions.length).map((p) => `
    <h3 style="margin-top:10px">${esc(p.name)} <span class="muted small">(${p.require === "any" ? "minst ett vilkår" : "alle vilkår"})</span></h3>
    ${p.eval.conditions.map((c) => `<div class="cond"><span>${esc(c.label)}${c.result.covered ? ` <span class="muted">${condValue(c)}, ${C.fmtDate(c.result.asOf)}</span>` : ` <span class="muted">${esc(missingReason(ctx, c.series).split(":")[0])}</span>`}</span>${condTag(c.result)}</div>`).join("")}`).join("");

  const im = cur.implications || {};
  const list = (xs) => xs && xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : '<p class="muted small">Ingen i denne fasen.</p>';
  const impl = (im.favored && im.favored.length) || (im.disfavored && im.disfavored.length)
    ? `<div class="impl"><div><strong>Narrativet favoriserer</strong>${list(im.favored)}</div><div><strong>Narrativet taler mot</strong>${list(im.disfavored)}</div></div>
       <p class="small">${esc(im.rationale)}</p>`
    : '<p class="small">Narrativet tilsier ingen bestemt posisjonering før fase 1 er nådd.</p>';
  const k = im.karsan;
  const karsanBlock = k && ((k.favored || []).length || (k.disfavored || []).length)
    ? `<h3 style="margin-top:12px">Karsan nevner selv</h3><div class="impl"><div><strong>Vil ha</strong>${list(k.favored)}</div><div><strong>Unngår</strong>${list(k.disfavored)}</div></div>
       <p class="muted small">Kilde: ${esc(k.source)}. Gjengitt fra en maskinlaget transkripsjon. Hans syn, ikke råd.</p>`
    : "";
  const fal = ctx.signals.falsification;
  const falBlock = fal ? (() => {
    const left = C.daysBetween(today, fal.date);
    return `<p class="small falsification"><strong>Brytningspunkt ${C.fmtDate(fal.date)}${left >= 0 ? `, ${left} dager igjen` : ", passert"}.</strong> ${esc(fal.text)}</p>`;
  })() : "";

  $("#phase-detail").innerHTML = `
    <div class="card"><h3>Gjeldende fase: ${esc(cur.name)}</h3><p class="small">${esc(cur.description)}</p>${falBlock}${conds}
      <p class="muted small">${esc(ctx.signals.regime._merknad)}</p></div>
    <div class="card"><h3>Hva narrativet tilsier i denne fasen</h3>${impl}${karsanBlock}
      <p class="muted small">${esc(ctx.signals.regime.disclaimer)}</p></div>`;
}

// ---------- Nøkkeltall ----------

function sparkline(rows, baseDate) {
  if (rows.length < 2) return "";
  const w = 240, h = 44, p = 3;
  const x = d3.scaleUtc().domain(d3.extent(rows, (r) => toDate(r.date))).range([p, w - p]);
  const y = d3.scaleLinear().domain(d3.extent(rows, (r) => r.value)).nice().range([h - p, p]);
  const line = d3.line().x((r) => x(toDate(r.date))).y((r) => y(r.value));
  const b = rows.find((r) => r.date === baseDate);
  const l = rows[rows.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${line(rows)}" fill="none" stroke="var(--s1)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    ${b ? `<line x1="${x(toDate(b.date))}" x2="${x(toDate(b.date))}" y1="0" y2="${h}" stroke="var(--axis)" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>` : ""}
    <circle cx="${x(toDate(l.date))}" cy="${y(l.value)}" r="2.5" fill="var(--s1)"/></svg>`;
}

// Boksens farge: retning i gjeldende fase. Fasestripene øverst er en logg: passerte
// faser er frosset på datoen regimet gikk videre, gjeldende fase er levende.
const GRADE = { g3: "målet nådd", g2: "minst halvveis til målet", g1: "på vei mot målet", n: "stillestående", r1: "litt bort fra målet", r2: "langt bort fra målet" };

function targetText(ctx, id, ind, t) {
  if (!t) return "ingen mål i denne fasen";
  if (t.change !== undefined) return `mål ${changeText(t.change, ind.mode)} fra fasestart`;
  return `mål ${valueText(ctx, id, ind.transform, t.level)}`;
}

// Fargestyrken viser fremdrift mot fasens mål. Passerte faser er frosset på faseskiftet.
function phasebar(ctx, id, ind, states, phases) {
  const name = (pid) => phases.find((p) => p.id === pid).name.split(":")[0];
  return `<div class="phasebar">${states.map((s) => {
    if (s.state === "empty") return `<span class="s-empty" title="${esc(name(s.phase))}: ikke nådd"></span>`;
    const t = (ind.phase_targets || {})[String(s.phase)];
    const status = s.grade ? `${GRADE[s.grade]} (${Math.round(s.progress * 100)} %)` : t ? "ingen fremdrift å måle" : "ingen mål i denne fasen";
    const when = s.state === "frozen" ? `da regimet gikk videre ${C.fmtDate(s.date)}` : "nå";
    const tip = t ? `${name(s.phase)}, ${when}: ${status}. ${targetText(ctx, id, ind, t)}, fasestart ${C.fmtDate(s.start)}.`
      : `${name(s.phase)}, ${when}: ingen mål i denne fasen.`;
    return `<span class="s-${s.state} g-${s.grade || "none"}" title="${esc(tip)}"></span>`;
  }).join("")}</div>`;
}

function renderTiles(ctx, regime, history) {
  const ov = ctx.signals.overview;
  const phases = regime.phases.filter((p) => p.conditions.length);
  const phaseIds = phases.map((p) => p.id);
  const cur = regime.current.id;
  const n = phases.length;
  $("#overview-intro").textContent = `Boksens farge viser om endringen siste ${ov.window_days} dager er i retning narrativet for fasen vi er i nå. Grønn: i retning. Rød: bort fra. Nøytral: uendret eller ingen retning i denne fasen. Lista øverst har ${n} striper, én per fase, og viser fremdrift mot fasens mål siden fasen startet, se fargeforklaringen under. Stripen for en passert fase er frosset på datoen regimet gikk videre. Hold musen over en stripe for mål og fremdrift. Grafen viser siste ${ov.spark_days} dager, stiplet strek markerer startpunktet for endringen.`;
  $("#phase-key").style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  $("#phase-key").innerHTML = phases.map((p) => `<span class="${p.id <= cur ? "on" : ""}">${esc(p.name.split(":")[0])}</span>`).join("");
  $("#phase-grades").innerHTML = "<span>Fasestripe:</span>" + ["g3", "g2", "g1", "n", "r1", "r2"]
    .map((g) => `<span><i class="g-${g}" style="background:var(${g === "n" ? "--muted" : "--grade-" + g})"></i>${GRADE[g]}</span>`).join("")
    + '<span><i class="g-none"></i>ingen mål i fasen</span><span><i class="s-empty"></i>fase ikke nådd</span>';
  let toward = 0, counted = 0;
  $("#tiles").innerHTML = ov.indicators.map((ind) => {
    const picked = C.pickSeries(ind.series, ctx.data, ind.pick || "freshest");
    if (!picked) {
      return `<div class="tile nodata"><div class="tt"><span>${esc(ind.title)}</span></div>
        <div class="tv muted">Ikke dekket</div><div class="meta">${esc(missingReason(ctx, ind.series))}</div></div>`;
    }
    const t = C.transform(picked.rows, ind.transform);
    const dir = C.directionFor(ind, cur);
    const m = C.momentum(t, ov.window_days, dir, ind.min_move, ind.mode);
    const lastObs = C.last(t);
    if (m && dir !== "none") { counted++; if (m.verdict === "mot") toward++; }
    const spark = C.between(t, C.addDays(lastObs.date, -ov.spark_days), null);
    const states = C.stripeStates(ind, t, phaseIds, cur, history, ov.window_days);
    const cls = m ? m.verdict : "";
    const label = `${m ? VERDICT[m.verdict] + ". " : ""}${ind.why}`;
    return `<div class="tile ${cls}" title="${esc(label)}" aria-label="${esc(ind.title)}: ${esc(label)}">
      ${phasebar(ctx, picked.id, ind, states, phases)}
      <div class="tt"><span>${esc(ind.title)}</span></div>
      <div class="tv">${valueText(ctx, picked.id, ind.transform, lastObs.value)}</div>
      <div class="tc">${m ? `${changeText(m.change, ind.mode)} siden ${C.fmtDate(m.baseDate)}` : "For kort historikk"}</div>
      ${spark.length > 1 ? sparkline(spark, m && m.baseDate) : ""}
      <div class="meta">${C.fmtDate(lastObs.date)}${staleTag(ctx, picked.id, lastObs.date)}, ${esc(sourceLine(ctx, picked.id))}</div></div>`;
  }).join("");
  return { toward, counted };
}

// ---------- Signaler ----------

function renderSignals(ctx, results) {
  const rows = ctx.signals.signals.map((s) => {
    const r = results[s.id];
    const rule = s.rule;
    let actual = "", dist = "";
    if (r.status === C.STATUS.NOT_COVERED) {
      actual = `<span class="muted small">${esc(r.reason || "")}</span>`;
    } else if (rule.type === "drawdown_reach") {
      actual = `${C.fmtNum(r.actual, 1)} % under topp`;
    } else if (rule.type === "yoy_reach") {
      actual = `${C.fmtNum(r.actual, 1)} % år/år`;
    } else if (rule.type === "change_reach") {
      actual = `${C.fmtSigned(r.actual, 1)} % siden ${C.fmtDate(r.baseDate)}`;
    } else {
      actual = valueText(ctx, r.seriesId, "level", r.actual);
    }
    if (r.distance !== undefined && r.distance !== null) {
      dist = r.distance > 0 ? `${C.fmtNum(r.distance, 2)} pp igjen` : `passert med ${C.fmtNum(-r.distance, 2)} pp`;
    }
    const cls = { Oppfylt: "ok", "Ikke oppfylt": "bad", "Overvåkes": "no", "Ikke dekket": "na" }[r.status];
    const met = (r.metDate ? `<br><span class="muted small">nådd ${C.fmtDate(r.metDate)}</span>` : "")
      + (r.late ? `<br><span class="stale">forsinket</span>` : "");
    const deadline = rule.deadline ? `<br><span class="muted small">frist ${C.fmtDate(rule.deadline)}${rule.final_deadline ? `, ytre frist ${C.fmtDate(rule.final_deadline)}` : ""}</span>` : "";
    const note = s.definition_note ? `<br><span class="muted small">${esc(s.definition_note)}</span>` : "";
    const upd = r.asOf ? `${C.fmtDate(r.asOf)}${staleTag(ctx, r.seriesId, r.asOf)}<br><span class="muted small">${esc(sourceLine(ctx, r.seriesId))}</span>` : "";
    return `<tr><td>${esc(s.title)}</td><td>${esc(s.claim)}${deadline}${note}</td><td class="num">${actual}</td><td class="num">${dist}</td>
      <td><span class="tag ${cls}">${r.status}</span>${met}</td><td class="nowrap">${upd}</td></tr>`;
  });
  $("#signals tbody").innerHTML = rows.join("");
  $("#signal-notes").textContent = Object.values(ctx.signals.rule_types).join(" ");
}

// ---------- Grafer ----------

function toDate(d) { return new Date(d + "T00:00:00Z"); }
const RANGES = [["Siden opptak", "rec"], ["6 mnd", 182], ["1 år", 365], ["3 år", 1095], ["Alt", null]];
let currentRange = 365;

function chartDefs(ctx) {
  const sig = Object.fromEntries(ctx.signals.signals.map((s) => [s.id, s.rule]));
  const r10 = sig.rente10, spx = sig.spx, inf = sig.inflasjon;
  return [
    { title: "Nominelle renter 10 og 30 år", panels: [{ unit: "%", series: [{ id: "UST_10Y", label: "10 år" }, { id: "UST_30Y", label: "30 år" }],
      refs: [{ y: r10.threshold, label: `${C.fmtNum(r10.threshold, 1)} %` }, { y: r10.upper, label: `${C.fmtNum(r10.upper, 1)} %` }] }] },
    { title: "Realrenter (TIPS) og 10 års breakeven", panels: [{ unit: "%", series: [{ id: "DFII5", label: "Real 5 år" }, { id: "DFII10", label: "Real 10 år" }, { id: "DFII30", label: "Real 30 år" }, { id: "T10YIE", label: "Breakeven 10 år" }] }] },
    { title: "S&P 500 og fall fra topp", panels: [
      { unit: "indekspoeng", series: [{ id: "SP500", label: "S&P 500" }] },
      { unit: "% under topp", invert: true, height: 130, series: [{ id: "SP500", label: "Fall fra topp", transform: "drawdown" }],
        refs: [{ y: spx.threshold, label: `${C.fmtNum(spx.threshold, 0)} %` }, { y: spx.upper, label: `${C.fmtNum(spx.upper, 0)} %` }] }] },
    { title: "Fed balanse, reserver og TGA", panels: [{ unit: "mrd. USD", series: [{ id: "WALCL", label: "Totale eiendeler" }, { id: "WRESBAL", label: "Reserver" }, { id: "WTREGEN", label: "TGA" }] }] },
    { title: "Kredittspreader og VIX", panels: [
      { unit: "%", height: 150, series: [{ id: "BAMLH0A0HYM2", label: "HY OAS" }, { id: "BAMLC0A0CM", label: "IG OAS" }] },
      { unit: "indeks", height: 130, series: [{ id: "VIXCLS", label: "VIX" }] }] },
    { title: "USD/NOK og bred dollarindeks", panels: [
      { unit: "NOK", height: 150, series: [{ id: "DEXNOUS", label: "USD/NOK" }] },
      { unit: "indeks", height: 130, series: [{ id: "DTWEXBGS", label: "Dollarindeks" }] }] },
    { title: "Inflasjon år/år", panels: [{ unit: "%", series: [{ id: "CPIAUCSL", label: "KPI", transform: "yoy" }, { id: "CPILFESL", label: "Kjerne KPI", transform: "yoy" }],
      refs: [{ y: inf.threshold, label: `${C.fmtNum(inf.threshold, 0)} %` }] }] },
  ];
}

const COLORS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];

// colorStart: fargene fortsetter på tvers av paneler i samme graf.
function prepPanel(ctx, panel, from, colorStart) {
  const lines = [], missing = [];
  panel.series.forEach((s, i) => {
    const rows = ctx.data[s.id];
    if (!rows || !rows.length) { missing.push(s); return; }
    const sc = C.displayScale(unitOf(ctx.meta, s.id));
    const all = C.transform(rows, s.transform || "level").map((r) => ({ date: r.date, value: r.value * sc.factor }));
    lines.push({ ...s, color: COLORS[(colorStart + i) % COLORS.length], all, rows: C.between(all, from, null) });
  });
  return { ...panel, lines, missing };
}

function renderChart(ctx, el, def) {
  const latest = d3.max(def.panels.flatMap((p) => p.series.map((s) => (ctx.data[s.id] ? C.last(ctx.data[s.id]).date : null)).filter(Boolean)));
  const from = currentRange === "rec" ? C.addDays(ctx.signals.recording_date, -14) : currentRange && latest ? C.addDays(latest, -currentRange) : null;
  let colorStart = 0;
  const panels = def.panels.map((p) => {
    const out = prepPanel(ctx, p, from, colorStart);
    colorStart += p.series.length;
    return out;
  });
  const allLines = panels.flatMap((p) => p.lines);
  const seen = new Set();
  const legend = allLines.filter((l) => !seen.has(l.label) && seen.add(l.label))
    .map((l) => `<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`).join("")
    + (panels.some((p) => p.lines.length && p.refs && p.refs.length) ? '<span><i class="dash"></i>Karsans terskel</span>' : "");
  const missingIds = new Map();
  for (const s of panels.flatMap((p) => p.missing)) if (!missingIds.has(s.id)) missingIds.set(s.id, s);
  const notes = [...missingIds.values()].map((s) => `${ctx.meta[s.id].title}: ${missingReason(ctx, [s.id])}`);
  const srcIds = [...new Set(def.panels.flatMap((p) => p.series.map((s) => s.id)))].filter((id) => ctx.data[id]);
  el.innerHTML = `<h3>${esc(def.title)}</h3><div class="legend">${legend}</div>
    ${notes.map((n) => `<div class="note">${esc(n)}</div>`).join("")}<div class="plot"></div>
    <div class="src">Kilde: ${srcIds.map((id) => esc(sourceLine(ctx, id))).join(", ") || "ingen"}</div>`;
  if (!allLines.length) return;

  const plot = el.querySelector(".plot");
  const width = Math.max(plot.clientWidth, 280);
  const m = { l: 46, r: 96, t: 8, b: 22 };
  const xDomain = [toDate(from || d3.min(allLines, (l) => l.rows[0] && l.rows[0].date)), toDate(d3.max(allLines, (l) => C.last(l.rows) ? C.last(l.rows).date : null))];
  const x = d3.scaleUtc().domain(xDomain).range([m.l, width - m.r]);
  const drawn = [];

  panels.forEach((p, pi) => {
    if (!p.lines.length) return;
    const h = p.height || 200;
    const svg = d3.select(plot).append("svg").attr("viewBox", `0 0 ${width} ${h}`).attr("height", h);
    if (panels.length > 1) d3.select(plot).insert("div", () => svg.node()).attr("class", "ptitle").text(p.unit === "% under topp" ? "Fall fra topp, %" : `${p.lines.map((l) => l.label).join(", ")}, ${p.unit}`);
    else svg.attr("aria-label", `${def.title}, ${p.unit}`);
    const vals = p.lines.flatMap((l) => l.rows.map((r) => r.value)).concat((p.refs || []).map((r) => r.y));
    let ext = d3.extent(vals);
    if (p.invert) ext = [0, Math.max(ext[1], 1)];
    const y = d3.scaleLinear().domain(ext).nice().range(p.invert ? [m.t, h - m.b] : [h - m.b, m.t]);
    const fmtTick = (v) => C.fmtNum(v, Math.abs(ext[1] - ext[0]) < 5 ? 1 : 0);
    svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(width - m.l - m.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(fmtTick));
    if (pi === panels.length - 1 || panels.length === 1) {
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(width / 110))).tickFormat(tickFormat));
    }
    for (const r of p.refs || []) {
      svg.append("line").attr("class", "ref").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y(r.y)).attr("y2", y(r.y));
      svg.append("text").attr("class", "ref-label").attr("x", m.l + 4).attr("y", y(r.y) - 4).text(r.label);
    }
    const line = d3.line().curve(d3.curveLinear).x((r) => x(toDate(r.date))).y((r) => y(r.value));
    const labels = [];
    for (const l of p.lines) {
      if (!l.rows.length) continue;
      svg.append("path").attr("d", line(l.rows)).attr("fill", "none").attr("stroke", l.color).attr("stroke-width", 2).attr("stroke-linejoin", "round");
      const lr = C.last(l.rows);
      svg.append("circle").attr("cx", x(toDate(lr.date))).attr("cy", y(lr.value)).attr("r", 3).attr("fill", l.color);
      labels.push({ y: y(lr.value), x: x(toDate(lr.date)), text: `${l.label} ${C.fmtNum(lr.value, decFor(l, p))}` });
    }
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    for (const lb of labels) svg.append("text").attr("class", "endlabel").attr("x", lb.x + 6).attr("y", lb.y + 4).text(lb.text);
    const cross = svg.append("line").attr("class", "cross").attr("y1", m.t).attr("y2", h - m.b).style("display", "none");
    const dots = p.lines.map((l) => svg.append("circle").attr("r", 4).attr("fill", l.color).attr("stroke", "var(--surface)").attr("stroke-width", 2).style("display", "none"));
    drawn.push({ svg, y, p, cross, dots, h });
  });

  const tip = $("#tooltip");
  const move = (event) => {
    const [mx] = d3.pointer(event, event.currentTarget);
    const date = x.invert(Math.max(m.l, Math.min(width - m.r, mx))).toISOString().slice(0, 10);
    let html = "", shownDate = null;
    for (const d of drawn) {
      d.p.lines.forEach((l, i) => {
        const o = C.onOrBefore(l.rows, date);
        if (!o) { d.dots[i].style("display", "none"); return; }
        shownDate = shownDate && shownDate > o.date ? shownDate : o.date;
        d.dots[i].style("display", null).attr("cx", x(toDate(o.date))).attr("cy", d.y(o.value));
        html += `<div class="tr"><span><i style="background:${l.color}"></i>${esc(l.label)}</span><span>${C.fmtNum(o.value, decFor(l, d.p))}</span></div>`;
      });
      d.cross.style("display", null).attr("x1", x(toDate(date))).attr("x2", x(toDate(date)));
    }
    tip.innerHTML = `<div class="td">${C.fmtDate(shownDate || date)}</div>${html}`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = event.clientX + 14, top = event.clientY + 14;
    if (left + tw > window.innerWidth - 8) left = event.clientX - tw - 14;
    if (top + th > window.innerHeight - 8) top = event.clientY - th - 14;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, top) + "px";
  };
  const leave = () => { tip.hidden = true; drawn.forEach((d) => { d.cross.style("display", "none"); d.dots.forEach((c) => c.style("display", "none")); }); };
  for (const d of drawn) {
    d.svg.append("rect").attr("x", m.l).attr("y", 0).attr("width", width - m.l - m.r).attr("height", d.h).attr("fill", "transparent")
      .on("pointermove", move).on("pointerleave", leave);
  }
}

function decFor(line, panel) {
  if (panel.unit === "mrd. USD") return 0;
  if (line.transform === "drawdown" || line.transform === "yoy") return 1;
  return panel.unit === "NOK" ? 3 : 2;
}

function tickFormat(d) {
  const months = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];
  return d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : `${months[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

function renderCharts(ctx) {
  const wrap = $("#charts");
  wrap.innerHTML = "";
  for (const def of chartDefs(ctx)) {
    const el = document.createElement("div");
    el.className = "chart";
    wrap.appendChild(el);
    renderChart(ctx, el, def);
  }
}

function renderRange(ctx) {
  $("#range").innerHTML = RANGES.map(([label, v]) => `<button type="button" data-v="${v}" aria-pressed="${v === currentRange}">${label}</button>`).join("");
  $("#range").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const v = b.dataset.v;
    currentRange = v === "null" ? null : v === "rec" ? "rec" : Number(v);
    renderRange(ctx);
    renderCharts(ctx);
  };
}

// ---------- Tid siden opptak ----------

function renderSince(ctx) {
  const rec = ctx.signals.recording_date;
  $("#since-intro").textContent = `Endring fra opptaket ${C.fmtDate(rec)} til siste observasjon. Baseline er siste observasjon på eller før opptaksdatoen, datoen som ble brukt vises. Renter vises i prosentpoeng (pp), øvrige serier i prosent.`;
  $("#since tbody").innerHTML = ctx.signals.since_recording.map((id) => {
    const m = ctx.meta[id];
    const rows = ctx.data[id];
    if (!rows) return `<tr><td>${esc(m.title)}</td><td colspan="5" class="muted small">${esc(missingReason(ctx, [id]))}</td></tr>`;
    const c = C.changeSince(rows, rec, m.change_mode);
    if (!c) return `<tr><td>${esc(m.title)}</td><td colspan="5" class="muted small">Mangler baseline</td></tr>`;
    return `<tr><td>${esc(m.title)}</td><td class="nowrap">${C.fmtDate(c.baseDate)}</td><td class="num">${valueText(ctx, id, "level", c.base)}</td>
      <td class="nowrap">${C.fmtDate(c.lastDate)}${staleTag(ctx, id, c.lastDate)}</td><td class="num">${valueText(ctx, id, "level", c.last)}</td>
      <td class="num">${changeText(c.change, m.change_mode)}</td></tr>`;
  }).join("");
}

// ---------- Kilder ----------

function sourceUrl(m, st) {
  if (m.source === "fred") return `https://fred.stlouisfed.org/series/${m.source_id}`;
  return st && st.source_url ? st.source_url : "#";
}

function renderSources(ctx) {
  $("#sources-intro").textContent = `Status oppdatert ${C.fmtTimestamp(ctx.status.generated)}. Utdatert betyr at siste observasjon er eldre enn forventet ut fra publiseringsfrekvensen, eller at siste henting feilet og forrige fil er beholdt.`;
  $("#sources tbody").innerHTML = Object.values(ctx.meta).map((m) => {
    const st = ctx.status.series[m.id] || {};
    let s = st.status || "feilet";
    if (s === "ok" && C.isStale(st.last_observation, today, m.max_age_days)) s = "utdatert";
    const cls = { ok: "ok", utdatert: "bad", feilet: "bad", ikke_publisert: "na" }[s];
    const link = ctx.data[m.id] ? `<a href="${ctx.dataPath(m.id)}">CSV</a>${st.private ? '<br><span class="muted small">privat</span>' : ""}` : "";
    return `<tr><td>${esc(m.title)}<br><span class="muted small">${esc(m.frequency)}, maks ${m.max_age_days} dager. ${esc(m.license)}</span>${st.message ? `<br><span class="muted small">${esc(st.message)}</span>` : ""}</td>
      <td>${esc(SOURCE_LABEL[m.source])}${st.method ? `<br><span class="muted small">${esc(st.method)}</span>` : ""}</td>
      <td><a href="${esc(sourceUrl(m, st))}">${esc(m.source === "treasury" ? `${m.source_id}: ${m.column}` : m.source_id)}</a></td>
      <td class="nowrap">${C.fmtDate(st.last_observation)}</td><td class="nowrap">${C.fmtTimestamp(st.last_fetched)}</td>
      <td><span class="tag ${cls}">${STATUS_LABEL[s]}</span></td><td>${link}</td></tr>`;
  }).join("");
  const cc = ctx.status.crosscheck || [];
  const w = ctx.status.warnings || [];
  $("#warnings").innerHTML = (cc.length ? `<p class="small muted">Kryssjekk FRED mot Treasury, siste felles datoer: ${cc.map((k) => `${k.fred} mot ${k.treasury}: ${k.dates_checked} datoer, ${k.deviations} avvik`).join("; ")}. Grense 0,01 prosentpoeng.</p>` : "")
    + w.map((x) => `<div class="warning">${esc(x.message)}</div>`).join("");
}

// ---------- Nyheter ----------

const LABEL = { bekrefter: ["ok", "Bekrefter"], avkrefter: ["bad", "Avkrefter"], "nøytral": ["no", "Nøytral"], blandet: ["no", "Blandet"], uklart: ["na", "Uklart"] };

function labelTag(key, prefix = "") {
  const v = LABEL[key];
  return v ? `<span class="tag ${v[0]}">${prefix}${v[1]}</span>` : "";
}

function link(x) {
  return `<a href="${esc(x.link)}" rel="noopener" target="_blank">${esc(x.title)}</a>`;
}

// Én linje per sak: tittel som lenke, kilde og dato, eventuell manuell vurdering.
function headline(ctx, x) {
  const l = ctx.labels[x.link];
  return `<li><span class="nd">${C.fmtDate(x.date)}</span><span class="nt">${link(x)} <span class="ns">${esc(x.source)}</span>
    ${l && l.kommentar ? `<br><span class="ns">${esc(l.kommentar)}</span>` : ""}</span>${l ? labelTag(l.vurdering) : ""}</li>`;
}

function renderNews(ctx) {
  const cfg = ctx.newsCfg, n = ctx.news, sum = ctx.summary || { topics: {}, podcasts: {} };
  if (!cfg || !n) {
    $("#karsan-intro").textContent = "Nyhetsdata mangler.";
    $("#news-intro").textContent = "Nyhetsdata mangler.";
    return;
  }
  const errs = n.errors && n.errors.length ? ` Feil ved siste henting: ${n.errors.join("; ")}.` : "";
  const auto = ctx.summary ? `Oppsummeringer laget automatisk av Claude (${esc(ctx.summary.model)}), sist ${C.fmtTimestamp(ctx.summary.generated)}.` : "Automatiske oppsummeringer er ikke slått på, utgiverens beskrivelse vises i stedet.";

  $("#karsan-intro").textContent = `Podcastepisoder (Apple Podcasts) og omtaler (Google News) der Karsan er nevnt. ${auto} Sosiale medier: ${cfg.social.status}. ${cfg.social.reason}${errs}`;
  const pods = n.karsan.filter((x) => x.kind === "podcast").slice(0, 6);
  const mentions = n.karsan.filter((x) => x.kind !== "podcast").slice(0, 8);
  $("#karsan-list").innerHTML = pods.map((x) => {
    const s = sum.podcasts[x.link];
    const text = s ? s.summary : x.description || "";
    return `<li><span class="nd">${C.fmtDate(x.date)}</span><span class="nt">${link(x)} <span class="ns">${esc(x.source)}, podcast</span>
      ${text ? `<span class="clamp">${esc(text)}</span>` : ""}</span></li>`;
  }).join("") + mentions.map((x) => headline(ctx, x)).join("") || '<li class="muted">Ingen treff.</li>';

  $("#news-intro").textContent = `Hovedbudskap per tema fra Google News siste ${cfg.keep_days} dager. ${ctx.summary ? "Oppsummering og retning er laget automatisk av Claude ut fra overskriftene, ikke hele artiklene." : "Automatisk oppsummering er ikke slått på, de tre nyeste overskriftene vises."} Lenkene går til hele saken.`;
  $("#news-topics").innerHTML = cfg.topics.map((t) => {
    const items = n.topics[t.id] || [];
    const s = sum.topics[t.id];
    const body = s
      ? `<p class="clamp">${esc(s.summary)}</p><p class="ns">${labelTag(s.direction, "Automatisk: ")} Basert på ${s.based_on} overskrifter.</p>`
      : `<ul class="news">${items.slice(0, 3).map((x) => headline(ctx, x)).join("") || '<li class="muted">Ingen treff.</li>'}</ul>`;
    const rest = s ? items : items.slice(3);
    return `<div class="card"><h3>${esc(t.title)}</h3>${body}
      ${rest.length ? `<details><summary>${s ? "Se kildene" : "Se flere"} (${rest.length})</summary><ul class="news">${rest.map((x) => headline(ctx, x)).join("")}</ul></details>` : ""}</div>`;
  }).join("");
}

// ---------- Podcastagent ----------

const RELATION = { bekrefter: ["ok", "Bekrefter"], endrer: ["na", "Endrer"], nytt: ["no", "Nytt"], motsier: ["bad", "Motsier"] };

function mmss(sec) {
  if (!sec) return "";
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function renderAgent(ctx) {
  const el = $("#agent");
  const eps = ctx.episodes ? Object.values(ctx.episodes.episodes) : [];
  const since = ctx.newsCfg && ctx.newsCfg.karsan.analyze_since;
  if (!eps.length) { el.innerHTML = ""; return; }
  const titles = Object.fromEntries(ctx.signals.signals.map((s) => [s.id, s.title]));
  const analyzed = eps.filter((e) => e.analysis && e.analysis.karsan_deltar);
  const waiting = eps.filter((e) => !e.analysis && since && e.date >= since);
  const cards = analyzed.map((e) => {
    const a = e.analysis;
    const claims = a.pastander.map((p) => {
      const [cls, label] = RELATION[p.forhold] || ["no", p.forhold];
      const meta = [p.tall, p.tidshorisont, p.gjelder_krav && titles[p.gjelder_krav] ? `gjelder: ${titles[p.gjelder_krav]}` : "", mmss(p.tid_sek)].filter(Boolean).join(", ");
      return `<li><span class="tag ${cls}">${label}</span> <strong>${esc(p.tema)}:</strong> ${esc(p.pastand)}
        ${meta ? `<br><span class="ns">${esc(meta)}</span>` : ""}${p.sitat ? `<br><span class="ns">«${esc(p.sitat)}»</span>` : ""}</li>`;
    }).join("");
    const props = a.forslag.length ? `<p class="small"><strong>Forslag til dashbordet</strong> (ikke lagt inn, må godkjennes):</p><ul class="small">${a.forslag.map((f) => `<li>${esc(f.hva)}. <span class="muted">${esc(f.begrunnelse)}</span></li>`).join("")}</ul>` : "";
    return `<div class="card"><h3><a href="${esc(e.link)}" rel="noopener" target="_blank">${esc(e.title)}</a></h3>
      <p class="ns">${esc(e.show)}, ${C.fmtDate(e.date)}. Analysert ${C.fmtTimestamp(e.analyzed_at)} av ${esc(e.model)} fra ${esc(e.transcript_source)}.</p>
      <p>${esc(a.oppsummering)}</p><ul class="claims">${claims}</ul>${props}</div>`;
  }).join("");
  const wait = waiting.length ? `<p class="muted small">Venter: ${waiting.map((e) => `${esc(e.title)} (${esc(e.message || "")})`).join("; ")}</p>` : "";
  el.innerHTML = `<h3>Podcastagent: hva Karsan sier nå</h3>
    <p class="muted small">Agenten finner nye episoder med Karsan, henter transkripsjon og lar Claude sammenligne det han sier med kravene på siden. Transkripsjoner er maskinlaget og uten talernavn, sitatene er korte og på originalspråket. Forslag legges aldri inn automatisk.</p>
    ${cards || '<p class="small">Ingen episoder analysert ennå.</p>'}${wait}`;
}

// ---------- Fotnote ----------

function renderFootnote(ctx) {
  const s = ctx.signals;
  const nc = s.signals.filter((x) => x.rule.type === "not_covered").map((x) => `${x.title}: ${x.not_covered_reason}`);
  const restricted = Object.values(ctx.meta).filter((m) => !m.publish).map((m) => `${m.title}: ${m.license}`);
  $("#footnote").innerHTML = `
    <p><strong>Om kravene.</strong> ${esc(s.source_note)} Kilde: ${esc(s.recording)}.</p>
    <p><strong>Ikke dekket, manuell oppfølging.</strong> ${nc.map(esc).join(" ")}</p>
    <p><strong>Ikke publisert på grunn av lisens.</strong> ${restricted.map(esc).join(" ")}</p>
    <p><strong>Regime og implikasjoner.</strong> ${esc(s.regime._merknad)} ${esc(s.regime.disclaimer)}</p>
    <p>Data hentes automatisk hver hverdag fra FRED (Federal Reserve Bank of St. Louis) og U.S. Treasury. Alle tall kommer fra filene i data/, med serie-id og observasjonsdato.</p>`;
}

// ---------- Oppstart ----------

async function main() {
  let ctx;
  try { ctx = await load(); } catch (e) {
    $("#summary").textContent = "Kunne ikke laste data: " + e.message;
    return;
  }
  const s = ctx.signals;
  if (ctx.privateIds.size) {
    const names = [...ctx.privateIds].map((id) => ctx.meta[id].title).join(", ");
    $("#private-banner").hidden = false;
    $("#private-banner").textContent = `Privat lokal visning. Inkluderer lisensbegrensede serier som ikke publiseres: ${names}. Hentet ${C.fmtTimestamp(ctx.privateGenerated)}. Ikke del skjermbilder eller data videre.`;
  }
  $("#thesis").textContent = `Tesen, slik den er gjengitt: ${s.thesis}`;
  const results = Object.fromEntries(s.signals.map((sig) => [sig.id, C.evaluateSignal(sig, ctx.data, today, s.recording_date)]));
  const regime = C.evaluateRegime(s.regime, ctx.data, s.recording_date);
  const rules = Object.fromEntries(s.signals.map((x) => [x.id, x.rule]));
  const rate = results.rente10.actual !== undefined ? { ...rules.rente10, actual: results.rente10.actual } : null;
  const spx = results.spx.status !== C.STATUS.NOT_COVERED ? { ...rules.spx, actual: results.spx.actual } : null;
  const history = C.regimeHistory(s.regime, ctx.data, s.recording_date, s.recording_date, today);
  const counts = renderTiles(ctx, regime, history);
  $("#summary").textContent = C.summarySentence(rate, spx, regime.current.name)
    + ` ${counts.toward} av ${counts.counted} nøkkeltall med data har beveget seg i retning narrativet siste ${s.overview.window_days} dager.`;
  renderRegime(ctx, regime);
  renderSignals(ctx, results);
  renderNews(ctx);
  renderAgent(ctx);
  renderRange(ctx);
  renderCharts(ctx);
  renderSince(ctx);
  renderSources(ctx);
  renderFootnote(ctx);
  let t;
  let lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(t);
    t = setTimeout(() => renderCharts(ctx), 150);
  });
}

main();
