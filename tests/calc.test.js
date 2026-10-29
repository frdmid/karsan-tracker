// Enhetstester for site/js/calc.js. Kjør: node --test tests/
// Forventede svar er regnet for hånd fra fixture-filene i tests/fixtures/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as c from "../site/js/calc.js";

const fx = (name) => c.parseCsv(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const rente = fx("rente.csv");
const indeks = fx("indeks.csv");
const kpi = fx("kpi.csv");
const REC = "2026-09-25";
const TODAY = "2026-10-12";

test("parseCsv dropper '.' og tomme verdier og sorterer stigende", () => {
  const rows = fx("mangler.csv");
  assert.deepEqual(rows, [{ date: "2026-09-29", value: 1.25 }, { date: "2026-10-02", value: 1.5 }]);
});

test("datoer", () => {
  assert.equal(c.daysBetween("2026-09-25", "2026-10-12"), 17);
  assert.equal(c.addDays("2026-10-09", -30), "2026-09-09");
  assert.equal(c.isStale("2026-10-02", TODAY, 10), false);
  assert.equal(c.isStale("2026-10-02", TODAY, 9), true);
  assert.equal(c.isStale(null, TODAY, 9), true);
});

test("onOrBefore bruker siste observasjon på eller før datoen", () => {
  assert.deepEqual(c.onOrBefore(rente, REC), { date: "2026-09-24", value: 5.1 });
  assert.deepEqual(c.onOrBefore(rente, "2026-09-26"), { date: "2026-09-26", value: 5.2 });
  assert.equal(c.onOrBefore(rente, "2026-07-01"), null);
});

test("changeSince i prosentpoeng og prosent", () => {
  const pp = c.changeSince(rente, REC, "pp");
  assert.equal(pp.baseDate, "2026-09-24");
  near(pp.change, 0.5);
  const pct = c.changeSince(indeks, REC, "pct");
  near(pct.change, (60 / 110 - 1) * 100);
});

test("drawdown fra løpende topp", () => {
  const dd = c.drawdownSeries(indeks).map((r) => Math.round(r.value * 1000) / 1000);
  assert.deepEqual(dd, [0, 0, 25, 8.333, 30, 50]);
});

test("år over år krever samme dato ett år før", () => {
  const y = c.yoySeries(kpi);
  assert.equal(y.length, 3);
  near(y[0].value, 10);
  near(y[1].value, 2);
  near(y[2].value, -2);
});

test("momentum siste 30 dager", () => {
  const up = c.momentum(rente, 30, "up", 0.05, "pp");
  assert.equal(up.baseDate, "2026-09-01");
  near(up.change, 0.6);
  assert.equal(up.verdict, "mot");
  assert.equal(c.momentum(rente, 30, "down", 0.05, "pp").verdict, "bort");
  assert.equal(c.momentum(rente, 30, "up", 1, "pp").verdict, "uendret");
  assert.equal(c.momentum(rente, 30, "none", 0.05, "pp").verdict, "ingen_retning");
});

test("signal level_reach: oppfylt, overvåkes, ikke oppfylt", () => {
  const data = { R: rente };
  const sig = (threshold, deadline) => ({ series: ["R"], rule: { type: "level_reach", threshold, deadline } });
  const met = c.evaluateSignal(sig(5.5, "2026-12-25"), data, TODAY, REC);
  assert.equal(met.status, "Oppfylt");
  assert.equal(met.metDate, "2026-10-09");
  near(met.distance, -0.1);
  const watch = c.evaluateSignal(sig(6.0, "2026-12-25"), data, TODAY, REC);
  assert.equal(watch.status, "Overvåkes");
  near(watch.distance, 0.4);
  assert.equal(c.evaluateSignal(sig(6.0, "2026-10-05"), data, TODAY, REC).status, "Ikke oppfylt");
});

test("signal med ytre frist: forsinket mellom fristene, ikke oppfylt etter ytre frist", () => {
  const sig = (deadline, final_deadline) => ({ series: ["R"], rule: { type: "level_reach", threshold: 6.0, deadline, final_deadline } });
  const late = c.evaluateSignal(sig("2026-10-05", "2026-12-31"), { R: rente }, TODAY, REC);
  assert.equal(late.status, "Overvåkes");
  assert.equal(late.late, true);
  assert.equal(c.evaluateSignal(sig("2026-10-05", "2026-10-10"), { R: rente }, TODAY, REC).status, "Ikke oppfylt");
  const met = c.evaluateSignal({ series: ["R"], rule: { type: "level_reach", threshold: 5.5, deadline: "2026-10-05", final_deadline: "2026-12-31" } }, { R: rente }, TODAY, REC);
  assert.equal(met.status, "Oppfylt");
  assert.equal(met.late, true);
});

test("signal drawdown_reach bruker første dato over terskel", () => {
  const r = c.evaluateSignal({ series: ["I"], rule: { type: "drawdown_reach", threshold: 25, deadline: "2027-06-30" } }, { I: indeks }, TODAY, REC);
  assert.equal(r.status, "Oppfylt");
  assert.equal(r.metDate, "2026-10-01");
  near(r.actual, 50);
});

test("signal change_reach og manglende serie", () => {
  const r = c.evaluateSignal({ series: ["I"], rule: { type: "change_reach", threshold: 5, deadline: "2027-03-25" } }, { I: indeks }, TODAY, REC);
  assert.equal(r.status, "Overvåkes");
  assert.equal(r.baseDate, "2026-09-24");
  near(r.actual, (60 / 110 - 1) * 100);
  assert.equal(c.evaluateSignal({ series: ["X"], rule: { type: "level_reach", threshold: 1 } }, {}, TODAY, REC).status, "Ikke dekket");
  assert.equal(c.evaluateSignal({ series: [], rule: { type: "not_covered" } }, {}, TODAY, REC).status, "Ikke dekket");
});

test("signal yoy_reach", () => {
  const r = c.evaluateSignal({ series: ["K"], rule: { type: "yoy_reach", threshold: 10, deadline: null } }, { K: kpi }, TODAY, "2025-12-15");
  assert.equal(r.status, "Oppfylt");
  near(r.actual, -2);
});

test("pickSeries velger nyeste eller første", () => {
  const older = rente.slice(0, 4);
  assert.equal(c.pickSeries(["A", "B"], { A: older, B: rente }).id, "B");
  assert.equal(c.pickSeries(["A", "B"], { A: older, B: rente }, "first").id, "A");
  assert.equal(c.pickSeries(["A", "B"], { A: rente, B: rente }).id, "A");
  assert.equal(c.pickSeries(["X"], {}), null);
});

test("regime: faser og vilkår", () => {
  const data = { R: rente, I: indeks };
  const condR = { series: ["R"], metric: "last", transform: "level", op: ">=", value: 5.5 };
  const condI = { series: ["I"], metric: "last", transform: "drawdown", op: ">=", value: 40 };
  const condX = { series: ["X"], metric: "last", transform: "level", op: ">=", value: 1 };
  const condChg = { series: ["R"], metric: "change_since_recording", mode: "pp", transform: "level", op: ">=", value: 0.6 };
  const condDays = { series: ["R"], metric: "change_days", days: 30, mode: "pp", transform: "level", op: ">", value: 0 };
  assert.equal(c.evaluatePhase({ require: "all", conditions: [condR, condI] }, data, REC).reached, true);
  assert.equal(c.evaluatePhase({ require: "all", conditions: [condR, condX] }, data, REC).reached, null);
  assert.equal(c.evaluatePhase({ require: "all", conditions: [condChg, condX] }, data, REC).reached, false);
  assert.equal(c.evaluatePhase({ require: "any", conditions: [condChg, condX] }, data, REC).reached, null);
  assert.equal(c.evaluatePhase({ require: "any", conditions: [condChg, condDays] }, data, REC).reached, true);
  assert.equal(c.evaluatePhase({ require: "any", conditions: [condX] }, data, REC).reached, null);
  const regime = { phases: [
    { id: 0, name: "Før", require: "all", conditions: [] },
    { id: 1, name: "En", require: "all", conditions: [condR] },
    { id: 2, name: "To", require: "all", conditions: [condChg] },
  ] };
  assert.equal(c.evaluateRegime(regime, data, REC).current.id, 1);
});

test("truncate og regimehistorikk", () => {
  assert.equal(c.truncate(rente, "2026-09-25").length, 3);
  assert.equal(c.truncate(rente, "2026-07-01").length, 0);
  assert.equal(c.truncate(rente, "2026-12-31").length, 6);
  const regime = { phases: [
    { id: 0, require: "all", conditions: [] },
    { id: 1, require: "all", conditions: [{ series: ["R"], metric: "last", transform: "level", op: ">=", value: 5.0 }] },
    { id: 2, require: "all", conditions: [{ series: ["I"], metric: "last", transform: "drawdown", op: ">=", value: 40 }] },
  ] };
  const h = c.regimeHistory(regime, { R: rente, I: indeks }, REC, REC, TODAY);
  assert.deepEqual(h, [{ date: "2026-09-25", phase: 1 }, { date: "2026-10-09", phase: 2 }]);
  assert.equal(c.phaseExitDate(h, 1), "2026-10-09");
  assert.equal(c.phaseExitDate(h, 2), null);
  assert.equal(c.phaseExitDate([{ date: "2026-09-25", phase: 3 }], 1), "2026-09-25");
});

test("fasestriper fryses ved faseskifte", () => {
  const h = [{ date: "2026-09-25", phase: 1 }, { date: "2026-10-09", phase: 2 }];
  const ind = { direction: "up", phase_directions: { 2: "down" }, min_move: 0.05, mode: "pp" };
  assert.equal(c.directionFor(ind, 1), "up");
  assert.equal(c.directionFor(ind, 2), "down");
  const s = c.stripeStates(ind, rente, [1, 2, 3, 4], 2, h, 30);
  assert.deepEqual(s.map((x) => [x.state, x.verdict, x.date]), [
    ["frozen", "mot", "2026-10-09"],
    ["current", "bort", "2026-10-09"],
    ["empty", null, null],
    ["empty", null, null],
  ]);
  // Frosset stripe bruker bare data kjent på skiftedatoen.
  const early = [{ date: "2026-09-25", phase: 1 }, { date: "2026-10-01", phase: 2 }];
  const s2 = c.stripeStates({ ...ind, min_move: 0.5 }, rente, [1, 2], 2, early, 30);
  assert.equal(s2[0].verdict, "uendret");
});

test("fremdrift mot fasemål og fargetrinn", () => {
  // Nivåmål opp: start 24. sep. 5,1, mål 5,5.
  near(c.targetProgress(rente, REC, "2026-10-01", { level: 5.5 }, "up", "pp"), (5.4 - 5.1) / 0.4);
  assert.equal(c.targetProgress(rente, REC, "2026-10-09", { level: 5.5 }, "up", "pp"), 1);
  // Nivåmål ned: 5,1 mot 4,5, men renten steg til 5,6.
  near(c.targetProgress(rente, REC, "2026-10-09", { level: 4.5 }, "down", "pp"), -0.5 / 0.6);
  // Endringsmål i prosent: indeks 110 til 60, mål -20 %.
  near(c.targetProgress(indeks, REC, "2026-10-09", { change: -20 }, "down", "pct"), ((60 / 110 - 1) * 100) / -20);
  // Uten mål eller retning: ingen fremdrift.
  assert.equal(c.targetProgress(rente, REC, "2026-10-09", undefined, "up", "pp"), null);
  assert.equal(c.targetProgress(rente, REC, "2026-10-09", { level: 6 }, "none", "pp"), null);
  // Startet allerede forbi målet uten å være der nå: regnes som bort.
  assert.equal(c.targetProgress(indeks, REC, "2026-10-09", { level: 100 }, "up", "pct"), -1);
  assert.deepEqual([1.2, 1, 0.6, 0.3, 0, -0.2, -0.8, null].map(c.progressGrade), ["g3", "g3", "g2", "g1", "n", "r1", "r2", null]);
  const h = [{ date: "2026-09-25", phase: 1 }, { date: "2026-10-09", phase: 2 }];
  const ind = { direction: "up", phase_directions: { 2: "down" }, phase_targets: { 1: { level: 5.5 }, 2: { change: -0.5 } }, min_move: 0.05, mode: "pp" };
  const s = c.stripeStates(ind, rente, [1, 2], 2, h, 30);
  assert.equal(s[0].start, "2026-09-25");
  assert.equal(s[0].grade, "g3");
  assert.equal(s[1].start, "2026-10-09");
  assert.equal(s[1].grade, "n");
});

test("rentefart i standardavvik og rebase", () => {
  // Endringer over 30 dager i rente.csv: 09-01 (5,0 mot 4,8) +0,2, 10-01 (5,4 mot 5,0) +0,4, 10-09 (5,6 mot 5,0) +0,6.
  // 09-24 og 09-26 sammenlignes med 08-01: +0,3 og +0,4.
  const z = c.speedZ(rente, 30);
  assert.equal(z.length, 5);
  const vals = [0.2, 0.3, 0.4, 0.4, 0.6];
  const mean = vals.reduce((a, b) => a + b) / 5;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / 5);
  near(c.last(z).value, (0.6 - mean) / sd);
  assert.deepEqual(c.speedZ(rente.slice(0, 1), 30), []);
  const rb = c.rebase(rente, "2026-09-25");
  assert.equal(rb[0].date, "2026-09-24");
  near(rb[0].value, 0);
  near(c.last(rb).value, 0.5);
  assert.equal(c.rebase(rente, null)[0].date, "2026-08-01");
});

test("samleindikator og prediksjon om ingen heving", () => {
  // To serier: a = 1, 2, 3 og b = 3, 2, 1 på samme datoer gir summen 0 hver dag.
  const a = [{ date: "2026-01-01", value: 1 }, { date: "2026-01-02", value: 2 }, { date: "2026-01-03", value: 3 }];
  const b = [{ date: "2026-01-01", value: 3 }, { date: "2026-01-02", value: 2 }, { date: "2026-01-03", value: 1 }];
  const z = c.compositeZ([a, b]);
  assert.equal(z.length, 3);
  for (const x of z) near(x.value, 0);
  // Samme serie to ganger: dobbel z. a har snitt 2 og sd sqrt(2/3).
  near(c.compositeZ([a, a])[2].value, 2 * (1 / Math.sqrt(2 / 3)));
  assert.deepEqual(c.compositeZ([a, [{ date: "2026-01-01", value: 5 }]]), []);
  const fed = [{ date: "2026-10-28", value: 4.0 }, { date: "2026-12-20", value: 4.0 }];
  const sig = (data, check) => c.evaluateSignal({ series: ["F"], rule: { type: "not_above_at", baseline_date: "2026-10-28", check_date: check } }, { F: data }, "2026-12-31", "2026-09-29");
  assert.equal(sig(fed, "2027-01-15").status, "Overvåkes");
  assert.equal(sig(fed, "2026-12-20").status, "Oppfylt");
  assert.equal(sig([...fed.slice(0, 1), { date: "2026-12-20", value: 4.25 }], "2026-12-20").status, "Ikke oppfylt");
});

test("regime med toleranse holder en nådd fase", () => {
  const rows = [
    { date: "2026-10-01", value: 4.9 }, { date: "2026-10-02", value: 5.05 },
    { date: "2026-10-05", value: 4.99 }, { date: "2026-10-08", value: 4.7 },
  ];
  const regime = { phases: [
    { id: 0, require: "all", conditions: [] },
    { id: 1, require: "all", conditions: [{ series: ["R"], metric: "last", transform: "level", op: ">=", value: 5.0, tolerance: 0.25 }] },
  ] };
  const run = c.regimeRun(regime, { R: rows }, "2026-10-01", "2026-10-01", "2026-10-09");
  // Nådd 2. okt., holdt 5. okt. (4,99 innenfor 0,25), falt 8. okt. (4,70 under 4,75).
  assert.deepEqual(run.history, [{ date: "2026-10-01", phase: 0 }, { date: "2026-10-02", phase: 1 }, { date: "2026-10-08", phase: 0 }]);
  const mid = c.regimeRun(regime, { R: rows }, "2026-10-01", "2026-10-01", "2026-10-06");
  assert.equal(mid.current.current.id, 1);
  assert.equal(mid.current.phases[1].eval.held, true);
  // Uten tidligere nådd fase gjelder ikke toleransen.
  assert.equal(c.evaluateRegime(regime, { R: rows.slice(0, 3) }, "2026-10-01").current.id, 0);
});

test("norsk formatering", () => {
  assert.equal(c.fmtNum(6747560, 0), "6 747 560");
  assert.equal(c.fmtNum(5.24, 2), "5,24");
  assert.equal(c.fmtNum(-1.5, 1), "−1,5");
  assert.equal(c.fmtNum(-0.004, 2), "0,00");
  assert.equal(c.fmtSigned(0.5, 2), "+0,50");
  assert.equal(c.fmtSigned(0, 2), "0,00");
  assert.equal(c.fmtNum(null), "ingen data");
  assert.equal(c.fmtDate("2026-10-09"), "9. okt. 2026");
  assert.equal(c.fmtTimestamp("2026-10-12T05:31:07Z"), "12. okt. 2026 kl. 05:31 UTC");
  assert.deepEqual(c.displayScale("mill. USD"), { factor: 0.001, unit: "mrd. USD", decimals: 0 });
  assert.equal(c.displayScale("%").factor, 1);
});

test("oppsummeringssetning", () => {
  const s = c.summarySentence({ actual: 5.24, threshold: 5.5, upper: 6 }, null, "Fase 1: Rentesjokk");
  assert.equal(s, "10-årsrenten er 5,24 % mot 5,5 til 6,0 %, fallet i S&P 500 er ikke dekket. Regimet er vurdert til fase 1: Rentesjokk.");
  const s2 = c.summarySentence({ actual: 5.24, threshold: 5.5, upper: 6 }, { actual: 0.1, threshold: 25, upper: 40 }, null);
  assert.equal(s2, "10-årsrenten er 5,24 % mot 5,5 til 6,0 %, S&P 500 er 0,1 % under toppen mot 25 til 40 %.");
});
