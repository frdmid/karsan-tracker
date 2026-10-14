// Alle utregninger for Karsan tracker. Ingen DOM, ingen nettverk.
// Testes med node:test i tests/calc.test.js.
// En serie er en liste av { date: "YYYY-MM-DD", value: number } sortert stigende.

// ---------- Innlesing ----------

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().split(",");
  const di = header.indexOf("date");
  const vi = header.indexOf("value");
  if (di < 0 || vi < 0) throw new Error("CSV mangler kolonnene date,value");
  const rows = [];
  for (const line of lines) {
    const cols = line.split(",");
    const v = cols[vi] === undefined ? "" : cols[vi].trim();
    if (v === "" || v === ".") continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    rows.push({ date: cols[di].trim(), value: n });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

// ---------- Datoer ----------

export function toUtc(date) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function daysBetween(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

export function addDays(date, n) {
  return new Date(toUtc(date) + n * 86400000).toISOString().slice(0, 10);
}

export function isStale(lastDate, today, maxAgeDays) {
  if (!lastDate) return true;
  return daysBetween(lastDate, today) > maxAgeDays;
}

// ---------- Oppslag ----------

export function last(rows) {
  return rows.length ? rows[rows.length - 1] : null;
}

export function onOrBefore(rows, date) {
  let lo = 0, hi = rows.length - 1, hit = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date <= date) { hit = rows[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return hit;
}

export function between(rows, from, to) {
  return rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}

// Velger serie fra en prioritert liste av id-er.
// pick="freshest": den med nyeste observasjon (ved likhet: den første i listen).
// pick="first": første id som har data.
export function pickSeries(ids, data, pick = "freshest") {
  let best = null;
  for (const id of ids || []) {
    const rows = data[id];
    if (!rows || !rows.length) continue;
    if (pick === "first") return { id, rows };
    if (!best || last(rows).date > last(best.rows).date) best = { id, rows };
  }
  return best;
}

// ---------- Transformasjoner ----------

// Fall fra løpende topp i prosent (positivt tall: 25 betyr 25 % under topp).
export function drawdownSeries(rows) {
  let peak = -Infinity;
  return rows.map((r) => {
    if (r.value > peak) peak = r.value;
    return { date: r.date, value: (1 - r.value / peak) * 100, peak };
  });
}

// År over år i prosent. Krever observasjon med nøyaktig samme dato ett år før
// (FRED månedsserier er datert den 1. i måneden).
export function yoySeries(rows) {
  const byDate = new Map(rows.map((r) => [r.date, r.value]));
  const out = [];
  for (const r of rows) {
    const [y, m, d] = r.date.split("-");
    const prev = byDate.get(`${Number(y) - 1}-${m}-${d}`);
    if (prev !== undefined && prev !== 0) out.push({ date: r.date, value: (r.value / prev - 1) * 100 });
  }
  return out;
}

// Rentefart: endringen over `days` dager målt i standardavvik mot alle slike
// endringer i serien. 2 betyr at oppgangen er uvanlig rask.
export function speedZ(rows, days = 91) {
  const ch = [];
  for (const r of rows) {
    const b = onOrBefore(rows, addDays(r.date, -days));
    if (b && b.date !== r.date) ch.push({ date: r.date, value: r.value - b.value });
  }
  if (ch.length < 2) return [];
  const mean = ch.reduce((s, x) => s + x.value, 0) / ch.length;
  const sd = Math.sqrt(ch.reduce((s, x) => s + (x.value - mean) ** 2, 0) / ch.length);
  return sd === 0 ? [] : ch.map((x) => ({ date: x.date, value: (x.value - mean) / sd }));
}

// Endring fra siste observasjon på eller før fromDate. Brukes for å tegne
// nominell rente, realrente og breakeven på samme skala.
export function rebase(rows, fromDate) {
  const b = (fromDate && onOrBefore(rows, fromDate)) || rows[0];
  if (!b) return [];
  return rows.filter((r) => r.date >= b.date).map((r) => ({ date: r.date, value: r.value - b.value }));
}

export function transform(rows, kind) {
  if (kind === "drawdown") return drawdownSeries(rows);
  if (kind === "yoy") return yoySeries(rows);
  if (kind === "speed_z") return speedZ(rows, 91);
  return rows;
}

// ---------- Endring ----------

export function change(base, now, mode) {
  if (base === null || now === null || base === undefined || now === undefined) return null;
  if (mode === "pct") return base === 0 ? null : (now / base - 1) * 100;
  return now - base;
}

// Endring fra siste observasjon på eller før baselineDate til siste observasjon.
export function changeSince(rows, baselineDate, mode) {
  const base = onOrBefore(rows, baselineDate);
  const now = last(rows);
  if (!base || !now) return null;
  return { baseDate: base.date, base: base.value, lastDate: now.date, last: now.value,
           change: change(base.value, now.value, mode) };
}

// Endring over de siste n dagene regnet fra siste observasjon.
export function changeOverDays(rows, days, mode) {
  const now = last(rows);
  if (!now) return null;
  return changeSince(rows, addDays(now.date, -days), mode);
}

// Retning siste periode i forhold til narrativet.
// direction: "up" | "down" | "none". Svar: "mot" | "bort" | "uendret" | "ingen_retning".
export function momentum(rows, days, direction, minMove, mode) {
  const c = changeOverDays(rows, days, mode);
  if (!c || c.change === null) return null;
  let verdict;
  if (direction === "none") verdict = "ingen_retning";
  else if (Math.abs(c.change) < minMove) verdict = "uendret";
  else verdict = (c.change > 0) === (direction === "up") ? "mot" : "bort";
  return { ...c, verdict };
}

// Avstand til terskel: hvor mye som gjenstår (positivt) eller er passert (negativt).
export function distance(value, threshold) {
  return threshold - value;
}

export function maxIn(rows) {
  let best = null;
  for (const r of rows) if (!best || r.value > best.value) best = r;
  return best;
}

// ---------- Signaler ----------

export const STATUS = {
  MET: "Oppfylt",
  NOT_MET: "Ikke oppfylt",
  WATCH: "Overvåkes",
  NOT_COVERED: "Ikke dekket",
};

const RULE_TRANSFORM = { level_reach: "level", drawdown_reach: "drawdown", yoy_reach: "yoy", change_reach: "level", monitor: "level" };

export function evaluateSignal(signal, data, today, recordingDate) {
  const rule = signal.rule;
  if (rule.type === "not_covered") {
    return { status: STATUS.NOT_COVERED, reason: signal.not_covered_reason || null };
  }
  const picked = pickSeries(signal.series, data, signal.pick || "freshest");
  if (!picked) {
    return { status: STATUS.NOT_COVERED, reason: "Ingen publiserbar data for " + (signal.series || []).join(", ") };
  }
  const t = transform(picked.rows, RULE_TRANSFORM[rule.type]);
  const now = last(t);
  const out = { seriesId: picked.id, actual: now ? now.value : null, asOf: now ? now.date : null };
  if (!now) return { ...out, status: STATUS.NOT_COVERED, reason: "For kort historikk" };
  if (rule.type === "monitor") return { ...out, status: STATUS.WATCH };

  // deadline: fristen slik den er sagt. final_deadline: ytre frist. Mellom de to er signalet forsinket, ikke feilet.
  const deadline = rule.deadline || null;
  const hardDeadline = rule.final_deadline || deadline;
  const window = between(t, recordingDate, hardDeadline);
  let measured = window;
  if (rule.type === "change_reach") {
    const base = onOrBefore(t, recordingDate);
    if (!base) return { ...out, status: STATUS.NOT_COVERED, reason: "Mangler baseline" };
    measured = window.map((r) => ({ date: r.date, value: change(base.value, r.value, "pct") }));
    out.actual = change(base.value, now.value, "pct");
    out.baseDate = base.date;
  }
  out.distance = distance(out.actual, rule.threshold);
  out.peak = maxIn(measured);
  const first = measured.find((r) => r.value >= rule.threshold);
  if (first) return { ...out, status: STATUS.MET, metDate: first.date, late: !!(deadline && first.date > deadline) };
  if (hardDeadline && today > hardDeadline) return { ...out, status: STATUS.NOT_MET };
  return { ...out, status: STATUS.WATCH, late: !!(deadline && today > deadline) };
}

// ---------- Regime ----------

function compare(a, op, b) {
  if (op === ">=") return a >= b;
  if (op === ">") return a > b;
  if (op === "<=") return a <= b;
  if (op === "<") return a < b;
  throw new Error("Ukjent operator " + op);
}

export function evaluateCondition(cond, data, recordingDate) {
  const picked = pickSeries(cond.series, data, cond.pick || "freshest");
  if (!picked) return { covered: false, met: null, value: null };
  const t = transform(picked.rows, cond.transform || "level");
  let value = null, asOf = null, baseDate = null;
  if (cond.metric === "last") {
    const l = last(t);
    if (l) { value = l.value; asOf = l.date; }
  } else if (cond.metric === "change_days") {
    const c = changeOverDays(t, cond.days, cond.mode);
    if (c) { value = c.change; asOf = c.lastDate; baseDate = c.baseDate; }
  } else if (cond.metric === "change_since_recording") {
    const c = changeSince(t, recordingDate, cond.mode);
    if (c) { value = c.change; asOf = c.lastDate; baseDate = c.baseDate; }
  } else {
    throw new Error("Ukjent metric " + cond.metric);
  }
  if (value === null) return { covered: false, met: null, value: null, seriesId: picked.id };
  return { covered: true, met: compare(value, cond.op, cond.value), value, asOf, baseDate, seriesId: picked.id };
}

// Fase nådd: require=all krever at alle dekkede vilkår er oppfylt og at ingen
// mangler data. require=any krever minst ett oppfylt dekket vilkår.
export function evaluatePhase(phase, data, recordingDate) {
  const results = phase.conditions.map((c) => ({ ...c, result: evaluateCondition(c, data, recordingDate) }));
  const covered = results.filter((r) => r.result.covered);
  let reached;
  if (!phase.conditions.length) reached = true;
  else if (!covered.length) reached = null;
  else if (phase.require === "any") reached = covered.some((r) => r.result.met) ? true : (covered.length < results.length ? null : false);
  else reached = covered.length < results.length ? (covered.some((r) => !r.result.met) ? false : null) : covered.every((r) => r.result.met);
  return { id: phase.id, name: phase.name, reached, conditions: results, metCount: covered.filter((r) => r.result.met).length, coveredCount: covered.length };
}

export function evaluateRegime(regime, data, recordingDate) {
  const phases = regime.phases.map((p) => ({ ...p, eval: evaluatePhase(p, data, recordingDate) }));
  let current = phases[0];
  for (const p of phases) if (p.eval.reached === true) current = p;
  return { phases, current };
}

// ---------- Regimehistorikk og fasestriper ----------

// Observasjoner til og med datoen.
export function truncate(rows, date) {
  let lo = 0, hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date <= date) lo = mid + 1; else hi = mid;
  }
  return lo === rows.length ? rows : rows.slice(0, lo);
}

// Gjeldende fase dag for dag fra fromDate til toDate, bare med data kjent den dagen.
// Svar: endringspunkter [{ date, phase }].
export function regimeHistory(regime, data, recordingDate, fromDate, toDate) {
  const ids = [...new Set(regime.phases.flatMap((p) => p.conditions.flatMap((c) => c.series)))].filter((id) => data[id]);
  const out = [];
  let prev = null;
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    const sub = {};
    for (const id of ids) sub[id] = truncate(data[id], d);
    const phase = evaluateRegime(regime, sub, recordingDate).current.id;
    if (phase !== prev) { out.push({ date: d, phase }); prev = phase; }
  }
  return out;
}

// Datoen regimet første gang gikk forbi fasen. Er fasen aldri sett (regimet
// startet over den), brukes første dato i historikken.
export function phaseExitDate(history, phaseId) {
  const hit = history.find((h) => h.phase > phaseId);
  return hit ? hit.date : null;
}

// Retning for et nøkkeltall i en gitt fase: phase_directions overstyrer direction.
export function directionFor(ind, phaseId) {
  const pd = ind.phase_directions || {};
  return pd[String(phaseId)] ?? ind.direction;
}

// Datoen regimet første gang nådde fasen (eller en høyere).
export function phaseStartDate(history, phaseId) {
  const hit = history.find((h) => h.phase >= phaseId);
  return hit ? hit.date : null;
}

// Fremdrift mot fasens mål, regnet fra verdien ved fasestart til verdien på atDate.
// target: { level: x } (nivå) eller { change: x } (endring i ind.mode, pp eller pct, med fortegn).
// 1 eller mer = nådd. Mellom 0 og 1 = andel av veien. Under 0 = beveget seg motsatt vei.
export function targetProgress(rows, startDate, atDate, target, direction, mode) {
  if (!target || direction === "none") return null;
  const base = onOrBefore(rows, startDate);
  const now = onOrBefore(rows, atDate);
  if (!base || !now) return null;
  if (target.change !== undefined) {
    const ch = change(base.value, now.value, mode);
    return ch === null || target.change === 0 ? null : ch / target.change;
  }
  const sign = direction === "down" ? -1 : 1;
  const ahead = (target.level - base.value) * sign;
  const moved = (now.value - base.value) * sign;
  if ((now.value - target.level) * sign >= 0) return 1;
  if (ahead <= 0) return moved >= 0 ? 0 : -1;
  return moved / ahead;
}

// Fargetrinn: g3 nådd, g2 minst halvveis, g1 på vei, n stillestående, r1 litt bort, r2 langt bort.
export function progressGrade(p) {
  if (p === null || p === undefined) return null;
  if (p >= 1) return "g3";
  if (p >= 0.5) return "g2";
  if (p > 0.05) return "g1";
  if (p >= -0.05) return "n";
  if (p > -0.5) return "r1";
  return "r2";
}

// Én stripe per fase. Passerte faser fryses på datoen regimet gikk videre,
// gjeldende fase er levende, senere faser er tomme. verdict er 30-dagers retning,
// grade er fremdrift mot fasens mål siden fasestart.
export function stripeStates(ind, rows, phaseIds, currentId, history, windowDays) {
  return phaseIds.map((p) => {
    if (p > currentId) return { phase: p, state: "empty", verdict: null, date: null, progress: null, grade: null };
    const live = p === currentId;
    const date = live ? null : phaseExitDate(history, p);
    const basis = live ? rows : date ? truncate(rows, date) : [];
    const dir = directionFor(ind, p);
    const m = momentum(basis, windowDays, dir, ind.min_move, ind.mode);
    const at = live ? (last(rows) || {}).date : date;
    const start = phaseStartDate(history, p);
    const progress = at && start ? targetProgress(rows, start, at, (ind.phase_targets || {})[String(p)], dir, ind.mode) : null;
    return { phase: p, state: live ? "current" : "frozen", verdict: m ? m.verdict : null, date: live ? (m && m.lastDate) : date,
             start, progress, grade: progressGrade(progress) };
  });
}

// ---------- Formatering (norsk) ----------

const MONTHS = ["jan.", "feb.", "mars", "apr.", "mai", "juni", "juli", "aug.", "sep.", "okt.", "nov.", "des."];

export function fmtDate(date) {
  if (!date) return "ingen data";
  const [y, m, d] = date.split("-").map(Number);
  return `${d}. ${MONTHS[m - 1]} ${y}`;
}

export function fmtNum(v, decimals = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "ingen data";
  const neg = v < 0 && Math.abs(v) >= 0.5 * Math.pow(10, -decimals);
  const [int, frac] = Math.abs(v).toFixed(decimals).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (neg ? "−" : "") + grouped + (frac ? "," + frac : "");
}

export function fmtSigned(v, decimals = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "ingen data";
  const s = fmtNum(v, decimals);
  return v > 0 && s !== fmtNum(0, decimals) ? "+" + s : s;
}

// "2026-10-12T05:31:07Z" -> "12. okt. 2026 kl. 05:31 UTC"
export function fmtTimestamp(iso) {
  if (!iso) return "ingen data";
  return `${fmtDate(iso.slice(0, 10))} kl. ${iso.slice(11, 16)} UTC`;
}

// Visningsskala: H.4.1 tall er i millioner USD, vises i milliarder.
export function displayScale(unit) {
  if (unit === "mill. USD") return { factor: 1 / 1000, unit: "mrd. USD", decimals: 0 };
  return { factor: 1, unit, decimals: null };
}

// ---------- Oppsummering ----------

// Lager oppsummeringssetningen øverst på siden fra evaluerte signaler.
export function summarySentence(rate, spx, phaseName) {
  const parts = [];
  if (rate && rate.actual !== null && rate.actual !== undefined) {
    parts.push(`10-årsrenten er ${fmtNum(rate.actual, 2)} % mot ${fmtNum(rate.threshold, 1)} til ${fmtNum(rate.upper, 1)} %`);
  } else {
    parts.push("10-årsrenten mangler data");
  }
  if (spx && spx.actual !== null && spx.actual !== undefined) {
    parts.push(`S&P 500 er ${fmtNum(spx.actual, 1)} % under toppen mot ${fmtNum(spx.threshold, 0)} til ${fmtNum(spx.upper, 0)} %`);
  } else {
    parts.push("fallet i S&P 500 er ikke dekket");
  }
  let s = parts.join(", ") + ".";
  if (phaseName) s += ` Regimet er vurdert til ${phaseName.charAt(0).toLowerCase() + phaseName.slice(1)}.`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
