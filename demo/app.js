"use strict";
// Monsoon Twin demo map. Every forecast comes live from the twin server's /simulate; nothing is pre-rendered.

// Hosted (demo/serve_demo.py): the twin is on the same address. Local (python -m http.server 5173): on port 8000.
const SERVER = new URLSearchParams(location.search).get("server")
  ?? (location.protocol === "file:" || location.port === "5173" ? "http://localhost:8000" : "");
const $ = id => document.getElementById(id);
const NLAT = 32, NLON = 36, LAT0 = 6.5, LON0 = 65.5, DAYS = 10, GLIDE_MS = 1400;
const BOUNDS = [[6, 65], [38, 101]];                               // outer edges of the 1-degree cells
// A change to the last starting day: a box [lat0, lat1, lon0, lon1] (cell centres inside count, as in the kit) and
// what changes in it: t2m (K) and msl (Pa) are added; tcwv and wind are fractions of the value there.
const PRESETS = {                                                   // the organisers' two shocks, plus the +2.5 °C test
  warm_ocean: { box: [8, 20, 82, 94], t2m: 3, tcwv: 0.15 },
  monsoon_stall: { box: [8, 20, 65, 75], wind: -0.4 },
  arabian_heat: { box: [8, 20, 65, 75], t2m: 2.5 },
};
const PAGE = document.body.dataset.page || "forecast";             // forecast (index.html), twin or flood
const FIELDS = {
  1: { name: "rain", unit: "mm/day", conv: v => v, stops: "rain", digits: 0 },
  0: { name: "temperature", unit: "°C", conv: v => v - 273.15, stops: "temp", digits: 1 },
  6: { name: "wind speed", unit: "m/s", conv: null, stops: "speed", digits: 1 },          // from u10 and v10
  5: { name: "water vapour", unit: "kg/m²", conv: v => v, stops: "tcwv", digits: 0 },
  4: { name: "sea-level pressure", unit: "hPa", conv: v => v / 100, stops: "msl", digits: 0 },
  7: { name: "flood risk", unit: "alert level", units: "alert levels", conv: null, stops: "flood", digits: 0 },               // demo/flood.js
};
const STOPS = {   // [value in display units, [r, g, b, alpha]]
  rain: [[0, [255, 255, 255, 0]], [0.5, [214, 236, 255, 0]], [1, [214, 236, 255, 150]], [2.5, [160, 205, 255, 190]],
         [5, [95, 165, 245, 210]], [10, [40, 110, 220, 220]], [20, [60, 60, 190, 228]], [40, [125, 45, 190, 235]],
         [80, [195, 40, 160, 240]], [150, [255, 80, 120, 245]]],
  temp: [[-10, [94, 60, 153, 205]], [0, [59, 111, 216, 205]], [10, [74, 184, 224, 205]], [18, [127, 214, 160, 205]],
         [24, [232, 228, 106, 205]], [30, [245, 167, 66, 210]], [36, [232, 97, 44, 215]], [42, [178, 24, 43, 220]],
         [48, [109, 10, 30, 225]]],
  speed: [[0, [255, 255, 255, 0]], [2, [220, 240, 238, 120]], [5, [150, 215, 205, 180]], [8, [80, 170, 190, 205]],
          [12, [60, 110, 190, 220]], [16, [110, 60, 170, 230]], [22, [190, 40, 120, 240]]],
  tcwv: [[0, [255, 255, 255, 0]], [10, [222, 240, 234, 140]], [25, [150, 212, 196, 190]], [40, [70, 172, 162, 210]],
         [55, [30, 122, 140, 222]], [70, [22, 72, 122, 232]]],
  flood: [[0, [255, 255, 255, 0]], [0.5, [255, 255, 255, 0]], [0.55, [250, 210, 70, 205]], [1.5, [250, 210, 70, 205]],
          [1.55, [240, 130, 40, 220]], [2.5, [240, 130, 40, 220]], [2.55, [190, 25, 45, 235]], [3, [190, 25, 45, 235]]],
  msl: [[985, [110, 40, 150, 225]], [995, [80, 110, 210, 210]], [1005, [190, 215, 240, 170]], [1010, [245, 245, 245, 120]],
        [1015, [250, 205, 150, 170]], [1025, [210, 100, 40, 215]]],
};
const diverging = m => [[-m, [33, 102, 172, 235]], [-m / 2, [120, 175, 215, 205]], [-m * 0.06, [255, 255, 255, 0]],
                        [m * 0.06, [255, 255, 255, 0]], [m / 2, [240, 150, 120, 205]], [m, [178, 24, 43, 235]]];
const VIEW_TITLE = { compare: "Twin against real weather", forecast: "Twin forecast", shock: "Difference", universes: "Universes" };
const PANE_TITLE = { compare: ["Real weather", "Twin forecast"], forecast: [PAGE === "flood" ? "Flood risk" : "Twin forecast"],
                     shock: ["Difference: with the change minus without"], universes: ["Universe A: as it was", "Universe B: with the change"] };
const WORD = PAGE === "twin" ? "change" : "shock";
const TWO = { compare: true, universes: true };                     // views with 2 maps side by side
const isDiff = () => state.view === "shock" || state.view === "universes";   // views about a change, not about skill
const COS = Array.from({ length: NLAT }, (_, i) => Math.cos((LAT0 + i) * Math.PI / 180));
const COS_SUM = COS.reduce((a, b) => a + b, 0) * NLON;

// The forecast page compares with the real weather; the twin and flood pages show only the twin.
const HOME = { forecast: "compare", twin: "universes", flood: "forecast" }[PAGE];
const state = { base: null, shocked: null, spec: null, flood: {}, view: HOME, t: 0, playing: false, grids: [], stats: [], req: 0 };

// ---- two maps that move together: the twin (left, or the only map) and the real weather (right) -----------
const narrowScreen = () => matchMedia("(max-width: 720px), (max-height: 520px)").matches;
function makeMap(id) {
  const map = L.map(id, { zoomSnap: 0.25, minZoom: 3, maxZoom: 8, zoomControl: false, attributionControl: false,
                          dragging: !narrowScreen() });           // on a phone, a swipe scrolls the page

  map.fitBounds(BOUNDS, { padding: [12, 12] });                     // a view first, then the layers
  for (const [name, z] of [["field", 350], ["wind", 420], ["lines", 450]]) {
    map.createPane(name).style.zIndex = z; map.getPane(name).style.pointerEvents = "none";
  }
  const overlay = L.imageOverlay("data:,", BOUNDS, { pane: "field", interactive: false }).addTo(map);
  L.geoJSON(window.BORDERS, { pane: "lines", interactive: false, style: { color: "#8e8e93", weight: 0.7, fill: false } }).addTo(map);
  const states = {};
  L.geoJSON(window.INDIA.states, { pane: "lines", interactive: false, style: { color: "#6e6e73", weight: 0.6, opacity: 0.7, fill: false },
    onEachFeature: (f, lyr) => { states[f.properties.name] = lyr; } }).addTo(map);
  L.geoJSON(window.INDIA.outline, { pane: "lines", interactive: false, style: { color: "#1d1d1f", weight: 1.5, fill: false } }).addTo(map);
  L.rectangle(BOUNDS, { pane: "lines", color: "#d1d1d6", weight: 1, fill: false, interactive: false }).addTo(map);
  const box = L.rectangle(BOUNDS, { pane: "lines", color: "#1d1d1f", weight: 1.5, dashArray: "6 6", fill: false, interactive: false });
  map.createPane("marks").style.zIndex = 470; map.getPane("marks").style.pointerEvents = "none";
  const marks = L.layerGroup().addTo(map);
  return { map, overlay, box, wind: null, states, marks };
}
const P = ["mapA", "mapB"].map(makeMap);
L.control.zoom({ position: "topright" }).addTo(P[1].map);
L.control.zoom({ position: "topright" }).addTo(P[0].map).getContainer().classList.add("only-one");
P.forEach(p => p.map.on("click", e => { if (typeof Builder !== "undefined") Builder.click(e.latlng); }));   // twin page
let syncing = false;
P.forEach(src => src.map.on("move", () => {
  if (syncing) return;
  syncing = true;
  P.forEach(dst => { if (dst !== src && dst.map.getContainer().offsetWidth) dst.map.setView(src.map.getCenter(), src.map.getZoom(), { animate: false }); });
  syncing = false;
}));
function layout() {
  $("wrap").className = "mapwrap " + (TWO[state.view] ? "two" : "one");
  P.forEach(p => p.map.invalidateSize());
  PANE_TITLE[state.view].forEach((t, n) => { $("title" + n).textContent = t; });
}
function fit() {                                                    // all of the grid; clear the numbers panel on desktop
  const narrow = narrowScreen();
  P[0].map.fitBounds(BOUNDS, narrow
    ? { paddingTopLeft: [12, 12], paddingBottomRight: [12, 12] }      // the legend is a strip above the maps
    : { paddingTopLeft: [12, 48], paddingBottomRight: [12, $("dock").offsetHeight + 30] });
}

// ---- field images in Web Mercator rows, so every cell sits at its true latitude --------------------------
const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const IW = 720, IH = Math.round(IW * (merc(38) - merc(6)) / (36 * Math.PI / 180));
const ROW_LAT = Array.from({ length: IH }, (_, r) => {
  const y = merc(38) - (r + 0.5) / IH * (merc(38) - merc(6));
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
});
const canvas = Object.assign(document.createElement("canvas"), { width: IW, height: IH });
const ctx = canvas.getContext("2d");
function sample(g, lat, lon) {                                      // bilinear, clamped to the grid
  const fi = Math.min(NLAT - 1, Math.max(0, lat - LAT0)), fj = Math.min(NLON - 1, Math.max(0, lon - LON0));
  const i = Math.min(NLAT - 2, Math.floor(fi)), j = Math.min(NLON - 2, Math.floor(fj)), a = fi - i, b = fj - j;
  return (g[i][j] * (1 - a) + g[i + 1][j] * a) * (1 - b) + (g[i][j + 1] * (1 - a) + g[i + 1][j + 1] * a) * b;
}
function colorAt(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) if (v <= stops[k][0]) {
    const [v0, c0] = stops[k - 1], [v1, c1] = stops[k], t = (v - v0) / (v1 - v0);
    return c0.map((x, n) => x + (c1[n] - x) * t);
  }
  return stops[stops.length - 1][1];
}
function paint(pane, g, stops, tf = v => v) {
  const img = ctx.createImageData(IW, IH), d = img.data;
  for (let r = 0; r < IH; r++) for (let c = 0; c < IW; c++) {
    const col = colorAt(stops, tf(sample(g, ROW_LAT[r], 65 + (c + 0.5) * 36 / IW))), p = (r * IW + c) * 4;
    d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; d[p + 3] = col[3];
  }
  ctx.putImageData(img, 0, 0);
  pane.overlay.setUrl(canvas.toDataURL());
}

// ---- data ------------------------------------------------------------------------------------------------
const W = () => WINDOWS[+$("win").value];
const CH = () => $("field").value;
function layer(day, ch) {                                           // one day of one field, in display units
  if (+ch === 6) return day[2].map((row, i) => row.map((u, j) => Math.hypot(u, day[3][i][j])));
  return day[ch].map(row => row.map(FIELDS[ch].conv));
}
function floodOf(src) {                                             // alert levels of every day of a source, cached per run
  if (!state.flood[src]) {
    const w = W(), days = src === "actual" ? w.actual : src === "persist" ? Array(DAYS).fill(w.init_states[2]) : state[src].rollout;
    state.flood[src] = FloodRisk.levels(w.init_states.map(d => d[1]), days.map(d => d[1]), w.doy_sincos, src === "base" || src === "shocked");
  }
  return state.flood[src];
}
function view(src, k, ch) {                                         // day k of one field; src: actual, persist, base or shocked
  if (+ch === 7) return floodOf(src)[k];
  return layer(src === "actual" ? W().actual[k] : src === "persist" ? W().init_states[2] : state[src].rollout[k], ch);
}
const sub = (a, b) => a.map((row, i) => row.map((v, j) => v - b[i][j]));
const lerp = (a, b, t) => a.map((row, i) => row.map((v, j) => v + (b[i][j] - v) * t));
function grids(k, ch) {                                             // what each visible map shows on day k
  if (state.view === "compare") return [view("actual", k, ch), view("base", k, ch)];       // real left, twin right
  if (state.view === "universes") return [view("base", k, ch), view("shocked", k, ch)];    // without left, with right
  if (state.view === "forecast") return [view(state.shocked ? "shocked" : "base", k, ch)];
  return [sub(view("shocked", k, ch), view("base", k, ch))];
}
const wmean = g => { let s = 0; g.forEach((row, i) => row.forEach(v => { s += v * COS[i]; })); return s / COS_SUM; };
const rmse = (a, b) => Math.sqrt(wmean(sub(a, b).map(r => r.map(v => v * v))));

// ---- places and words for the captions (ASD-STE100 style) ------------------------------------------------
function inRing(x, y, ring) {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b];
    if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}
const STATE_BOX = window.INDIA.states.features.map(f => {
  let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
  for (const poly of f.geometry.coordinates) for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [x0, x1, y0, y1];
});
function stateAt(lat, lon) {                                        // {name, kind} or null
  for (const [n, f] of window.INDIA.states.features.entries()) {
    const [x0, x1, y0, y1] = STATE_BOX[n];
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    for (const poly of f.geometry.coordinates) if (inRing(lon, lat, poly[0])) return f.properties;
  }
  return null;
}
function country(lat, lon) {
  for (const f of window.BORDERS.features) for (const poly of f.geometry.coordinates)
    if (inRing(lon, lat, poly[0])) return f.properties.name;
  return null;
}
function place(lat, lon) {                                          // a short place phrase with its preposition
  const st = stateAt(lat, lon);
  if (st) return "in " + st.name;
  const c = country(lat, lon);
  if (c) return "in " + (c === "People's Republic of China" ? "China" : c);
  if (lon < 77 && lat < 25) return "over the Arabian Sea";
  if (lon >= 92 && lat < 17) return "over the Andaman Sea";
  if (lon >= 77.5 && lat < 23) return "over the Bay of Bengal";
  return "over the Indian Ocean";
}
let CELL_STATES = null;
function cellStates() {                                             // [[state, area], ...] for each cell, from 3 x 3 samples
  return CELL_STATES ??= Array.from({ length: NLAT }, (_, i) => Array.from({ length: NLON }, (_, j) => {
    const parts = {};
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const st = stateAt(LAT0 + i + a / 3, LON0 + j + b / 3);
      if (st) parts[st.name] = (parts[st.name] || 0) + COS[i] / 9;
    }
    return Object.entries(parts);
  }));
}
const ll = (i, j) => [LAT0 + i, LON0 + j];
const at = e => place(...ll(e.i, e.j));
function extreme(g, sign) {                                         // sign 1: maximum, -1: minimum
  let best = -Infinity, pos = [0, 0];
  g.forEach((row, i) => row.forEach((v, j) => { if (sign * v > best) { best = sign * v; pos = [i, j]; } }));
  return { v: sign * best, i: pos[0], j: pos[1] };
}
const absmax = g => { const a = extreme(g, 1), b = extreme(g, -1); return Math.abs(a.v) >= Math.abs(b.v) ? a : b; };
const km = deg => Math.round(deg * 111 / 10) * 10;
const fmt = (v, d) => v.toFixed(d).replace("-", "−");
const signed = (v, d) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
const pct = x => Math.round(100 * x) + "%";
const unitOf = (f, v) => (f.units && Math.abs(v) !== 1 ? f.units : f.unit);   // "1 alert level", "2 alert levels"

// ---- per-day numbers: the kit's skill of the twin, the size of a shock, or flood alerts --------------------
// The organisers' kit (monsoon_r1.scoring.skill_vs_best_ref), per channel: skill = 1 - RMSE / min(RMSE of "repeat
// yesterday", RMSE of the long-term average), with the latitude-weighted RMSE of physical values (rmse below). The
// long-term average's RMSE comes with each window, from the kit's own functions (make_windows.py); the twin's is live.
const FIELD_CH = { 0: [0], 1: [1], 6: [2, 3], 5: [5], 4: [4] };    // the wind field is the kit's u10 and v10
const RMSE_SCALE = { 4: 0.01 };                                     // Pa to hPa, as the field shows it
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
function kitStats(k, ch) {
  const w = W(), out = state.base.rollout[k], real = w.actual[k], last = w.init_states[2];
  const all = real.map((_, c) => {
    const r = rmse(out[c], real[c]), rp = rmse(last[c], real[c]), rc = w.rmse_clim[k][c], best = Math.min(rp, rc);
    return { c, r, best, ref: rp <= rc ? "“repeat yesterday”" : "long-term average", ss: best > 0 ? 1 - r / best : 0 };
  });
  const mine = FIELD_CH[ch].map(c => all[c]);
  return { kind: "kit", mine, skill: mean(mine.map(x => x.ss)), skillAll: mean(all.map(x => x.ss)) };
}
function floodStats(k) {                                            // the states and people under an alert in the twin map shown
  const g = view(state.shocked ? "shocked" : "base", k, 7);
  return { kind: "flood", states: FloodRisk.stateAlerts(g, cellStates()), people: FloodRisk.people(g), warned: FloodRisk.people(g, 2) };
}
function stateShift(k) {                                            // the state whose alert area the shock changes most
  const before = FloodRisk.byState(view("base", k, 7), cellStates()), after = {};
  FloodRisk.byState(view("shocked", k, 7), cellStates()).forEach(s => { after[s.name] = s; });
  const best = before.map(s => ({ name: s.name, before: s.share, after: after[s.name].share, d: Math.abs(after[s.name].area - s.area) }))
                     .sort((x, y) => y.d - x.d)[0];                // by area, so tiny union territories do not lead
  return best && best.d > 0 ? best : null;
}
function dayStats(k, ch) {
  const base = view("base", k, ch);
  if (isDiff()) {
    const shocked = view("shocked", k, ch), d = sub(shocked, base), e = absmax(d), [a0, a1, o0, o1] = state.spec.box;
    let far = 0;
    d.forEach((row, i) => row.forEach((v, j) => {
      if (Math.abs(v) < 0.2 * Math.abs(e.v)) return;
      const [la, lo] = ll(i, j);
      far = Math.max(far, Math.hypot(Math.max(a0 - la, 0, la - a1), Math.max(o0 - lo, 0, lo - o1)));
    }));
    return { kind: "shock", e, far, size: Math.abs(e.v), a: base[e.i][e.j], b: shocked[e.i][e.j], state: +ch === 7 ? stateShift(k) : null,
             people: +ch === 7 ? [FloodRisk.people(base), FloodRisk.people(view("shocked", k, ch))] : null };
  }
  return +ch === 7 ? floodStats(k) : kitStats(k, ch);
}

const ALERT = ["", "flood watch", "flood warning", "severe flood warning"];
const when = k => (k === 0 ? "tomorrow" : `in ${k + 1} days`);      // forecast day k+1, from the last real day
const cap = t => t[0].toUpperCase() + t.slice(1);
const persons = n => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million` : n >= 1e3 ? `${Math.round(n / 1e3)} thousand` : n ? String(n) : "none");
function names(list) {                                              // "A", "A and B", "A, B, C and 2 more"
  const n = list.length, head = n > 4 ? list.slice(0, 3) : list, more = n - head.length;
  const all = more ? [...head, `${more} more`] : head;
  return all.length < 2 ? all.join("") : all.slice(0, -1).join(", ") + " and " + all[all.length - 1];
}
function describe(states) {                                         // "flood warning for A and B; flood watch for C"
  if (!states.length) return "no state under an alert";
  return [3, 2, 1].map(l => states.filter(s => s.level === l)).filter(g => g.length)
                  .map(g => `${ALERT[g[0].level]} for ${names(g.map(s => s.name))}`).join("; ");
}
function floodCaption(k) {
  return "";                                                        // the headline and the numbers say it
}
function floodHeadline(k) {
  const st = state.stats[k].states;
  if (!st.length) return `No flood alert for any state ${when(k)}.`;
  const worst = st.filter(s => s.level === st[0].level);
  return `${cap(ALERT[st[0].level])} for ${names(worst.map(s => s.name))} ${when(k)}. `
       + `About ${persons(state.stats[k].people)} people live in the alert area.`;
}
function captionText(k, ch) {
  if (+ch === 7 && !isDiff()) return floodCaption(k);
  const f = FIELDS[ch], n = v => fmt(v, f.digits), s = state.stats[k];
  if (isDiff()) {
    if (s.size < Math.pow(10, -f.digits)) return `The ${WORD} does not change the ${f.name} on this day.`;
    return `The ${WORD} ${s.e.v > 0 ? "increases" : "decreases"} the ${f.name} by up to ${n(Math.abs(s.e.v))} ${unitOf(f, s.e.v)} ${at(s.e)}. `
         + (s.far < 0.5 ? `The effect stays in the box.` : `The effect is now ${km(s.far)} km from the box.`);
  }
  return "The score uses the method of the organisers' kit, for all 6 fields. The error is the RMSE over the map. "
       + "The best simple forecast is the better of “repeat yesterday” and the long-term average.";
}

// ---- the headline: the day in one plain sentence -----------------------------------------------------------
function headline(k, ch) {
  if (+ch === 7 && !isDiff()) return floodHeadline(k);
  const f = FIELDS[ch];
  if (isDiff()) {
    const s = state.stats[k], t = s.state;
    if (+ch === 7) return t ? `The shock ${t.after > t.before ? "raises" : "lowers"} the flood-alert area of ${t.name} `
                              + `${when(k)}: ${pct(t.before)} → ${pct(t.after)} of the state.` : `The shock does not change the flood alerts of any state ${when(k)}.`;
    return s.size < Math.pow(10, -f.digits) ? `The ${WORD} has no effect on this day.`
         : `The ${WORD} ${s.e.v > 0 ? "adds" : "removes"} up to ${fmt(Math.abs(s.e.v), f.digits)} ${unitOf(f, s.e.v)} of ${f.name} ${at(s.e)}.`;
  }
  const x = state.stats[k].skillAll, p = Math.round(100 * Math.abs(x));
  return `Skill ${signed(x, 2)}: ` + (p < 2 ? "the twin is as good as the best simple forecast."
       : `the twin's error is ${p}% ${x > 0 ? "smaller" : "larger"} than the best simple forecast.`);
}

// ---- marker: the largest change from a shock -----------------------------------------------------------------
function pin(pane, e, label) {
  const pos = ll(e.i, e.j);
  L.circleMarker(pos, { pane: "marks", radius: 6, color: "#fff", weight: 2, fillColor: "#b3261e", fillOpacity: 1, interactive: false }).addTo(pane.marks);
  L.marker(pos, { pane: "marks", interactive: false, keyboard: false, icon: L.divIcon({ className: "pinbox", iconSize: [0, 0],
    html: `<span class="pin err">${label}</span>` }) }).addTo(pane.marks);
}
function updateMarks(k) {
  P.forEach(p => p.marks.clearLayers());
  if (!state.base || !isDiff() || PAGE === "flood") return;
  const f = FIELDS[CH()], s = state.stats[k], pane = P[state.view === "universes" ? 1 : 0];   // on the changed universe
  if (s.size >= Math.pow(10, -f.digits)) pin(pane, s.e, `<b>Largest change</b> ${signed(s.e.v, f.digits)} ${unitOf(f, s.e.v)}`);
}

// ---- drawing -----------------------------------------------------------------------------------------------
function draw(t) {
  if (!state.base) return;
  const ch = CH(), k0 = Math.max(0, Math.min(DAYS - 1, Math.floor(t))), k1 = Math.min(DAYS - 1, k0 + 1);
  const g0 = grids(k0, ch), g = k1 === k0 ? g0 : g0.map((x, n) => lerp(x, grids(k1, ch)[n], t - k0));
  let stops = STOPS[FIELDS[ch].stops], tf;
  if (state.view === "shock") {  // scale to this day's largest change; a square-root curve keeps small changes visible
    let m = 1e-6; for (const row of g[0]) for (const v of row) m = Math.max(m, Math.abs(v));
    stops = diverging(m); tf = v => Math.sign(v) * m * Math.sqrt(Math.min(1, Math.abs(v) / m));
  }
  g.forEach((grid, n) => paint(P[n], grid, stops, tf));            // both maps share one colour scale
  legend(stops, ch, state.view === "shock");
  state.grids = g;
}
function legend(stops, ch, diff) {
  const c = $("bar"), x = c.getContext("2d"), lo = stops[0][0], hi = stops[stops.length - 1][0], f = FIELDS[ch];
  x.clearRect(0, 0, c.width, c.height);
  for (let p = 0; p < c.width; p++) {
    const col = colorAt(stops, lo + (hi - lo) * p / (c.width - 1));
    x.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${Math.max(col[3], 40) / 255})`; x.fillRect(p, 0, 1, c.height);
  }
  const t = v => (Math.abs(v) >= 100 ? fmt(v, 0) : fmt(v, Math.abs(v) < 10 ? 1 : 0));
  $("legtitle").textContent = (diff ? "Change from the shock: less ← → more" : f.name[0].toUpperCase() + f.name.slice(1)) + ` · ${f.unit}`;
  $("lo").textContent = t(lo); $("hi").textContent = t(hi);
  if (+ch === 7 && !diff) { $("lo").textContent = "None"; $("hi").textContent = "Severe"; }
}

function windData(day) {
  const flat = ch => { const out = []; for (let i = NLAT - 1; i >= 0; i--) out.push(...day[ch][i]); return out; };  // north row first
  const head = n => ({ parameterCategory: 2, parameterNumber: n, nx: NLON, ny: NLAT, lo1: LON0, la1: LAT0 + NLAT - 1,
                       lo2: LON0 + NLON - 1, la2: LAT0, dx: 1, dy: 1 });
  return [{ header: head(2), data: flat(2) }, { header: head(3), data: flat(3) }];
}
function setWind(pane, day) {
  if (!$("wind").checked || !day) { if (pane.wind) { pane.map.removeLayer(pane.wind); pane.wind = null; } return; }
  const data = windData(day);
  if (pane.wind) { pane.wind.setData(data); return; }
  pane.wind = L.velocityLayer({ displayValues: false, data, paneName: "wind", maxVelocity: 18, velocityScale: 0.004,
    particleAge: 200, frameRate: 20, lineWidth: 1.6, particleMultiplier: 1 / 450, opacity: 0.9,
    colorScale: ["rgba(29,29,31,0.35)", "rgba(29,29,31,0.5)", "rgba(29,29,31,0.65)", "rgba(29,29,31,0.8)"] }).addTo(pane.map);
}
function updateWind(k) {
  if (state.view === "compare") { setWind(P[0], W().actual[k]); setWind(P[1], state.base.rollout[k]); return; }
  if (state.view === "universes") { setWind(P[0], state.base.rollout[k]); setWind(P[1], state.shocked.rollout[k]); return; }
  setWind(P[0], (state.view === "forecast" ? (state.shocked || state.base) : state.shocked).rollout[k]); setWind(P[1], null);
}

// ---- the numbers overlay: one day in detail, and a strip of all 10 days ------------------------------------
const dateText = iso => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
function buildTimeline() {
  const ch = CH(), f = FIELDS[ch], shock = isDiff(), reach = shock && PAGE === "twin";
  state.stats = Array.from({ length: DAYS }, (_, k) => dayStats(k, ch));
  const flood = +ch === 7 && !shock, kit = !flood && !shock;
  const vals = state.stats.map(s => (flood ? s.states.length : reach ? (s.size < Math.pow(10, -f.digits) ? 0 : km(s.far))
                                     : shock ? s.size : s.skillAll)), top = Math.max(1e-6, ...vals);
  $("tlhead").textContent = flood ? "States under a flood alert in the twin, by day"
    : reach ? `How far the effect has spread from the box, by day · km (${f.name})`
    : shock ? `Largest change from the shock, by day · ${f.unit}` : "Skill by day, all 6 fields · above 0: better than the best simple forecast";
  $("timeline").replaceChildren(...state.stats.map((s, k) => {
    const v = vals[k], b = document.createElement("button");
    b.className = "chip" + (kit && s.skillAll < 0 ? " worse" : ""); b.dataset.k = k;
    b.title = flood ? `Day ${k + 1}: ${describe(s.states)}`
            : reach ? `Day ${k + 1}: the effect is ${v} km from the box`
            : shock ? `Day ${k + 1}: largest change ${fmt(v, f.digits)} ${f.unit}`
                    : `Day ${k + 1}: skill ${signed(v, 2)}, all 6 fields, as the organisers' kit calculates it`;
    b.innerHTML = `<span class="track"><span class="bar" style="height:${Math.max(3, 28 * Math.max(v, 0) / top)}px"></span></span>`
      + `<span class="val">${kit ? signed(v, 2) : reach ? v : fmt(v, shock || flood ? f.digits : 1)}</span><span class="d">Day ${k + 1}</span>`;
    b.onclick = () => goTo(k, Math.abs(k - state.t) <= 1);
    return b;
  }));
}
function stat(label, value, note, tone) {
  return `<div class="stat${tone ? " " + tone : ""}"><div class="k">${label}</div><div class="v">${value}</div>${note ? `<div class="n">${note}</div>` : ""}</div>`;
}
function renderPanel(k) {
  const ch = CH(), f = FIELDS[ch], s = state.stats[k], u = f.unit, d = f.digits;
  $("eyebrow").textContent = `Day ${k + 1} of ${DAYS} · ${dateText(W().dates[k])}`;
  $("headline").textContent = headline(k, ch);
  $("captext").textContent = captionText(k, ch);
  if (s.kind === "shock") {
    $("stats").innerHTML = (s.size < Math.pow(10, -d) ? stat("Largest change", "None", "on this day")   // no reach without a change
      : stat("Largest change", `${signed(s.e.v, d)} ${unitOf(f, s.e.v)}`, at(s.e))
        + (+ch === 7 ? "" : stat("At that point", `${fmt(s.a, d)} → ${fmt(s.b, d)} ${u}`, `without → with the ${WORD}`))
        + stat("Reach", s.far < 0.5 ? "In the box" : `${km(s.far)} km`, "from the box"))
      + (s.state ? stat("Largest change of alert area", `${pct(s.state.before)} → ${pct(s.state.after)}`, s.state.name) : "")
      + (s.people ? stat("People in the alert area", `${persons(s.people[0])} → ${persons(s.people[1])}`, "without → with the shock") : "");
  } else if (s.kind === "flood") {
    const first = state.stats.findIndex(x => x.states.some(t => t.level >= 2));
    $("stats").innerHTML = stat("People in the alert area", cap(persons(s.people)), `${persons(s.warned)} at warning or higher · 2011 population`)
      + stat("States under an alert", String(s.states.length), s.states.length ? names(s.states.map(t => t.name)) : "watch or higher")
      + stat("First flood warning", first < 0 ? "None" : cap(when(first)), "in the twin's 10 days");
  } else {
    const val = key => s.mine.map(x => fmt(x[key] * (RMSE_SCALE[ch] || 1), Math.max(d, 1))).join(" / ") + " " + u;
    const wind = s.mine.length > 1, tone = x => (x >= 0 ? "good" : "bad");
    $("stats").innerHTML = stat("Skill, all 6 fields", signed(s.skillAll, 2), "the organisers' score", tone(s.skillAll))
      + stat(`Skill, ${f.name}`, signed(s.skill, 2), wind ? "mean of u10 and v10" : "", tone(s.skill))
      + stat("Twin RMSE", val("r"), wind ? "u10 / v10" : "")
      + stat("Best simple forecast RMSE", val("best"), wind ? "u10 / v10" : s.mine[0].ref);
  }
  document.querySelectorAll("#timeline .chip").forEach(c => c.setAttribute("aria-current", +c.dataset.k === k ? "true" : "false"));
}

let shownDay = -1;
function setDay(k, force) {
  if (k === shownDay && !force) return;
  shownDay = k; $("daylabel").textContent = `Day ${k + 1} of ${DAYS}`;
  $("prev").disabled = k === 0; $("next").disabled = k === DAYS - 1;
  const card = $("dock"); card.classList.remove("in"); void card.offsetWidth; card.classList.add("in");
  renderPanel(k); updateWind(k); updateMarks(k);
}

// ---- running the twin ------------------------------------------------------------------------------------
function shockDelta(spec, last) {                                   // the perturbation [6,32,36] for a change
  const d = Array.from({ length: 6 }, () => Array.from({ length: NLAT }, () => new Array(NLON).fill(0)));
  const [a0, a1, o0, o1] = spec.box;
  for (let i = 0; i < NLAT; i++) for (let j = 0; j < NLON; j++) {
    const [la, lo] = ll(i, j);
    if (la < a0 || la > a1 || lo < o0 || lo > o1) continue;
    if (spec.t2m) d[0][i][j] = spec.t2m;
    if (spec.msl) d[4][i][j] = spec.msl;
    if (spec.tcwv) d[5][i][j] = spec.tcwv * last[5][i][j];
    if (spec.wind) { d[2][i][j] = spec.wind * last[2][i][j]; d[3][i][j] = spec.wind * last[3][i][j]; }
  }
  return d;
}
// The change of this page: none on the forecast page, a preset on the flood page, the builder on the twin page.
const specNow = () => (PAGE === "twin" ? Builder.spec() : PAGE === "flood" && $("shock").value !== "none" ? PRESETS[$("shock").value] : null);
async function simulate(w, perturbation, steps = DAYS) {
  const r = await fetch(SERVER + "/simulate", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ init_states: w.init_states, doy_sincos: w.doy_sincos, steps, perturbation }) });
  if (!r.ok) throw new Error("the server answered " + r.status);
  return r.json();
}

async function run() {
  if (document.body.classList.contains("evolve-on")) return;       // the digital-twin mode (evolve.js) owns the maps
  const req = ++state.req, w = W(), spec = specNow();
  $("status").className = "status"; $("status").textContent = "The twin calculates 10 days…";
  try {
    const base = await simulate(w, null);
    const shocked = spec ? await simulate(w, shockDelta(spec, w.init_states[2])) : null;
    if (req !== state.req) return;                                  // a newer request started meanwhile
    Object.assign(state, { base, shocked, spec, flood: {} });
    $("status").className = "status ok"; $("status").textContent = `Live from the twin · ${base.inference_ms.toFixed(0)} ms`;
    P.forEach(p => {
      if (!spec) p.box.remove();
      else { const [a0, a1, o0, o1] = spec.box; p.box.setBounds([[a0, o0], [a1, o1]]).addTo(p.map); }
    });
    if (glide) { cancelAnimationFrame(glide); glide = null; }
    state.t = aim = 0;                                              // a new run starts at the first day
    setView(state.view, true);
  } catch (e) {
    console.error(e);
    $("status").className = "status err";
    $("status").textContent = `Cannot reach the twin (${e.message}). Start it: python serve.py --port 8000`;
  }
}
function setView(v, force) {
  const changed = v !== state.view || force;
  state.view = v;
  document.querySelectorAll(".seg button[data-view]").forEach(b => b.setAttribute("aria-pressed", b.dataset.view === v));
  if (changed) layout();
  buildTimeline(); draw(state.t); setDay(Math.floor(state.t), true);
  if (changed) fit();
}

// ---- stepping: you move one day at a time; the maps glide into the next day ---------------------------------
let glide = null, aim = 0;                                          // aim: the day the last request asked for
function goTo(k, smooth) {
  if (document.body.classList.contains("evolve-on")) return;
  k = aim = Math.max(0, Math.min(DAYS - 1, k));
  if (glide) { cancelAnimationFrame(glide); glide = null; }
  const from = state.t;
  if (!smooth || Math.abs(k - from) > 1.01) { state.t = k; draw(k); setDay(k, true); return; }
  const t0 = performance.now(); let painted = 0;
  const step = now => {
    const a = Math.min(1, Math.max(0, (now - t0) / GLIDE_MS)), e = 1 - Math.pow(1 - a, 3);   // ease out; a frame can predate t0
    state.t = from + (k - from) * e;
    if (a >= 1) { glide = null; state.t = k; draw(k); setDay(k, true); return; }
    if (now - painted > 120) { draw(state.t); painted = now; }
    glide = requestAnimationFrame(step);
  };
  glide = requestAnimationFrame(step);
}
const stepBy = n => goTo(aim + n, true);             // every click counts, even during a glide

// ---- controls and the hover tooltip ------------------------------------------------------------------------
WINDOWS.forEach((w, i) => $("win").add(new Option(w.label, i)));
if (document.body.dataset.page === "flood") $("win").value = WINDOWS.findIndex(w => w.label.startsWith("Flood:"));
$("win").onchange = () => run();
if ($("shock")) $("shock").onchange = () => run();
$("field").onchange = () => { if (glide) { cancelAnimationFrame(glide); glide = null; } state.t = aim = 0; buildTimeline(); draw(0); setDay(0, true); };
$("wind").onchange = () => updateWind(Math.floor(state.t));
$("prev").onclick = () => stepBy(-1); $("next").onclick = () => stepBy(1);
document.addEventListener("keydown", e => {                         // the arrow keys step too, outside form fields
  if (/^(SELECT|INPUT|TEXTAREA)$/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "ArrowRight") { e.preventDefault(); stepBy(1); }
  if (e.key === "ArrowLeft") { e.preventDefault(); stepBy(-1); }
});
document.querySelectorAll(".seg button[data-view]").forEach(b => { b.onclick = () => {   // a new view starts at the first day
  if (glide) { cancelAnimationFrame(glide); glide = null; }
  state.t = aim = 0; setView(b.dataset.view, true);
}; });
const tip = $("tip");
let lit = null;
function highlight(name) {                                          // outline the state under the cursor on both maps
  if (name === lit) return;
  P.forEach(p => {
    if (lit && p.states[lit]) p.states[lit].setStyle({ color: "#6e6e73", weight: 0.6, opacity: 0.7 });
    if (name && p.states[name]) p.states[name].setStyle({ color: "#0a66d6", weight: 2.2, opacity: 1 }).bringToFront();
  });
  lit = name;
}
P.forEach(p => {
  p.map.on("mousemove", e => {
    const { lat, lng } = e.latlng, f = FIELDS[CH()], g = state.grids, st = stateAt(lat, lng);
    highlight(st && st.name);
    if (!g.length || lat < 6 || lat > 38 || lng < 65 || lng > 101) { tip.hidden = true; return; }
    const flood = f === FIELDS[7], i = Math.round(lat - LAT0), j = Math.round(lng - LON0);
    const v = g.map(x => (flood ? Math.round(x[Math.min(NLAT - 1, Math.max(0, i))][Math.min(NLON - 1, Math.max(0, j))]) : sample(x, lat, lng)));
    const row = (name, x, sgn) => `<div class="row"><span>${name}</span><b>${sgn ? signed(x, f.digits) : flood ? FloodRisk.NAMES[x] : fmt(x, f.digits)}</b></div>`;
    const c = st ? null : country(lat, lng);
    tip.innerHTML = (st ? `<div class="state">${st.name}<span>${st.kind}</span></div>`
                        : c ? `<div class="state">${c === "People's Republic of China" ? "China" : c}</div>` : "")
      + `<div class="where">${lat.toFixed(1)}° N · ${lng.toFixed(1)}° E</div>`
      + (state.view === "compare" ? row("Real", v[0]) + row("Twin", v[1]) + row("Difference", v[1] - v[0], true)
         : state.view === "universes" ? row("Universe A", v[0]) + row("Universe B", v[1]) + row("Difference", v[1] - v[0], true)
                                  : row(VIEW_TITLE[state.view], v[0], state.view === "shock"))
      + `<div class="unit">${f.unit}</div>`;
    const box = $("wrap").getBoundingClientRect(), x = e.originalEvent.clientX - box.left, y = e.originalEvent.clientY - box.top;
    tip.style.left = Math.min(x + 18, box.width - 200) + "px"; tip.style.top = Math.max(8, y - 20) + "px"; tip.hidden = false;
  });
  p.map.on("mouseout", () => { tip.hidden = true; highlight(null); });
});
window.addEventListener("resize", () => {
  const narrow = narrowScreen();
  P.forEach(p => { narrow ? p.map.dragging.disable() : p.map.dragging.enable(); p.map.invalidateSize(); });
  fit();
});
run();
