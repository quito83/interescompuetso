'use strict';

/* =========================================================
   Formatting helpers
   ========================================================= */
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

const money = (v) => (v < 0 ? '-$' : '$') + nf0.format(Math.abs(Math.round(v)));

function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + nf2.format(v / 1e9) + 'B';
  if (a >= 1e6) return '$' + nf2.format(v / 1e6) + 'M';
  if (a >= 1e3) return '$' + nf2.format(v / 1e3) + 'K';
  return '$' + nf0.format(v);
}

function compactShort(v) {
  const a = Math.abs(v);
  const f = (x) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: x < 10 ? 1 : 0 }).format(x);
  if (a >= 1e9) return '$' + f(v / 1e9) + 'B';
  if (a >= 1e6) return '$' + f(v / 1e6) + 'M';
  if (a >= 1e3) return '$' + f(v / 1e3) + 'K';
  return '$' + nf0.format(v);
}

const pct = (v) => (v >= 100 ? nf0.format(v) : nf2.format(v)) + '%';

function duration(months) {
  if (months < 11.95) return nf0.format(Math.max(1, Math.round(months))) + (Math.round(months) <= 1 ? ' mes' : ' meses');
  return nf1.format(months / 12) + ' años';
}

function durationShort(months) {
  if (months < 11.95) return nf0.format(Math.max(1, Math.round(months))) + 'm';
  return nf1.format(months / 12) + 'a';
}

/* =========================================================
   Finance math
   ========================================================= */
let rateMode = 'nominal'; // 'nominal' (TNA/12) | 'effective' (TEA)

function monthlyRate(annualPct) {
  const r = annualPct / 100;
  return rateMode === 'effective' ? Math.pow(1 + r, 1 / 12) - 1 : r / 12;
}

/** Future value after n months; contributions at the end of each month. */
function fv(P, pmt, annualPct, n) {
  const i = monthlyRate(annualPct);
  if (Math.abs(i) < 1e-12) return P + pmt * n;
  const g = Math.pow(1 + i, n);
  return P * g + pmt * (g - 1) / i;
}

/** Monthly contribution needed to reach target. Returns 0 if already reachable. */
function requiredPmt(target, P, annualPct, n) {
  const i = monthlyRate(annualPct);
  if (Math.abs(i) < 1e-12) return Math.max(0, (target - P) / n);
  const g = Math.pow(1 + i, n);
  const need = target - P * g;
  if (need <= 0) return 0;
  return need * i / (g - 1);
}

/** Initial capital needed (no monthly contributions). */
function requiredPV(target, annualPct, n) {
  return target / Math.pow(1 + monthlyRate(annualPct), n);
}

/** Annual rate (%) needed to reach target. {rate, status: ok|already|impossible} */
function requiredRate(target, P, pmt, n) {
  if (P <= 0 && pmt <= 0) return { rate: NaN, status: 'impossible' };
  if (fv(P, pmt, 0, n) >= target) return { rate: 0, status: 'already' };
  let lo = 0, hi = 1000;
  if (fv(P, pmt, hi, n) < target) return { rate: NaN, status: 'impossible' };
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (fv(P, pmt, mid, n) < target) lo = mid; else hi = mid;
    if (hi - lo < 1e-7) break;
  }
  return { rate: (lo + hi) / 2, status: 'ok' };
}

/** Month-by-month simulation. */
function simulate(P, pmt, annualPct, years) {
  const n = Math.round(years * 12);
  const i = monthlyRate(annualPct);
  const bal = new Float64Array(n + 1);
  const contrib = new Float64Array(n + 1);
  bal[0] = P; contrib[0] = P;
  for (let m = 1; m <= n; m++) {
    bal[m] = bal[m - 1] * (1 + i) + pmt;
    contrib[m] = contrib[m - 1] + pmt;
  }
  return { n, bal, contrib };
}

/** Fractional month at which balance first reaches value (or null). */
function crossingMonth(bal, value) {
  if (bal[0] >= value) return 0;
  for (let m = 1; m < bal.length; m++) {
    if (bal[m] >= value) {
      const a = bal[m - 1], b = bal[m];
      return m - 1 + (value - a) / (b - a);
    }
  }
  return null;
}

/* =========================================================
   Milestones
   ========================================================= */
const BASE_MILESTONES = [100e3, 250e3, 500e3, 1e6];

function milestoneScale(finalValue, setting) {
  if (setting !== 'auto') return parseFloat(setting);
  if (finalValue >= 1e6) return Math.floor(finalValue / 1e6);
  if (finalValue >= 1e5 || finalValue <= 0) return 1;
  // Smaller goals: scale down by powers of 10 so at least the first milestone is visible
  return Math.pow(10, Math.floor(Math.log10(finalValue / 1e5)));
}

/* =========================================================
   SVG chart
   ========================================================= */
const SVGNS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const e = document.createElementNS(SVGNS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * opts: {
 *   months, series: [{data: Float64Array, color, width, dash, area, name}],
 *   milestones?: [{value, month}], target?, tooltip: (m) => html
 * }
 */
function drawChart(container, opts) {
  const W = container.clientWidth, H = container.clientHeight;
  if (!W || !H) return;
  container.innerHTML = '';
  const narrow = W < 520;
  const pad = { l: narrow ? 46 : 58, r: narrow ? 12 : 20, t: 26, b: 26 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const n = opts.months;

  let yMax = 0;
  for (const s of opts.series) for (let m = 0; m <= n; m++) yMax = Math.max(yMax, s.data[m]);
  if (opts.target) yMax = Math.max(yMax, opts.target);
  if (yMax <= 0) yMax = 1;
  const yStep = niceStep(yMax / (narrow ? 4 : 5));
  yMax = Math.ceil(yMax * 1.04 / yStep) * yStep;

  const X = (m) => pad.l + (m / n) * pw;
  const Y = (v) => pad.t + ph - (v / yMax) * ph;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });

  // Grid + Y labels
  for (let v = 0; v <= yMax + 1e-6; v += yStep) {
    svg.appendChild(el('line', { class: 'grid', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
    svg.appendChild(el('text', { x: pad.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, compactShort(v)));
  }

  // X axis
  const years = n / 12;
  const maxTicks = Math.max(3, Math.floor(pw / 46));
  const xStep = [1, 2, 5, 10, 20, 25, 50].find((s) => years / s <= maxTicks) || 50;
  svg.appendChild(el('line', { class: 'axis', x1: pad.l, x2: W - pad.r, y1: Y(0), y2: Y(0) }));
  for (let y = 0; y <= years + 1e-6; y += xStep) {
    const x = X(y * 12);
    svg.appendChild(el('line', { class: 'axis', x1: x, x2: x, y1: Y(0), y2: Y(0) + 4 }));
    svg.appendChild(el('text', { x, y: Y(0) + 17, 'text-anchor': 'middle' }, String(y)));
  }

  // Target line
  if (opts.target) {
    svg.appendChild(el('line', { class: 'target-line', x1: pad.l, x2: W - pad.r, y1: Y(opts.target), y2: Y(opts.target) }));
    svg.appendChild(el('text', { x: W - pad.r, y: Y(opts.target) - 6, 'text-anchor': 'end', class: 'ms-label' }, 'Objetivo ' + compact(opts.target)));
  }

  // Milestone verticals (drawn under the curve)
  const ms = opts.milestones || [];
  for (const m of ms) {
    svg.appendChild(el('line', { class: 'ms-line', x1: X(m.month), x2: X(m.month), y1: Y(m.value), y2: Y(0) }));
  }

  // Series
  const step = Math.max(1, Math.floor(n / (pw * 1.5)));
  for (const s of opts.series) {
    let d = '';
    for (let m = 0; m <= n; m += step) d += (m ? 'L' : 'M') + X(m).toFixed(1) + ' ' + Y(s.data[m]).toFixed(1);
    if ((n % step) !== 0) d += 'L' + X(n).toFixed(1) + ' ' + Y(s.data[n]).toFixed(1);
    if (s.area) {
      const gid = 'g' + Math.random().toString(36).slice(2);
      const grad = el('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 });
      grad.appendChild(el('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': 0.22 }));
      grad.appendChild(el('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': 0.02 }));
      const defs = el('defs'); defs.appendChild(grad); svg.appendChild(defs);
      svg.appendChild(el('path', { d: d + `L${X(n)} ${Y(0)}L${X(0)} ${Y(0)}Z`, fill: `url(#${gid})` }));
    }
    svg.appendChild(el('path', {
      d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash || 'none',
    }));
  }

  // Milestone points, labels and segment durations
  const bg = cssVar('--surface');
  let prev = 0;
  ms.forEach((m) => {
    const x = X(m.month), y = Y(m.value);
    svg.appendChild(el('circle', { cx: x, cy: y, r: 4, fill: bg, stroke: opts.series[0].color, 'stroke-width': 2 }));
    const anchor = x > W - pad.r - 30 ? 'end' : x < pad.l + 30 ? 'start' : 'middle';
    svg.appendChild(el('text', {
      x, y: y - 10, 'text-anchor': anchor, class: 'ms-label',
      stroke: bg, 'stroke-width': 4, 'paint-order': 'stroke',
    }, compactShort(m.value)));
    const segW = X(m.month) - X(prev);
    if (m.month - prev > 0.5 && segW > 30) {
      svg.appendChild(el('text', {
        x: (X(prev) + x) / 2, y: Y(0) - 8, 'text-anchor': 'middle', class: 'ms-dur',
        stroke: bg, 'stroke-width': 4, 'paint-order': 'stroke',
      }, segW > 64 ? duration(m.month - prev) : durationShort(m.month - prev)));
    }
    prev = m.month;
  });

  // Hover layer
  const cross = el('line', { class: 'cross', y1: pad.t, y2: Y(0), visibility: 'hidden' });
  svg.appendChild(cross);
  const dots = opts.series.map((s) => {
    const c = el('circle', { r: 4.5, fill: s.color, stroke: bg, 'stroke-width': 2, visibility: 'hidden' });
    svg.appendChild(c);
    return c;
  });
  const hit = el('rect', { x: pad.l, y: pad.t, width: pw, height: ph, fill: 'transparent' });
  svg.appendChild(hit);

  const tip = document.getElementById('tooltip');
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (W / rect.width);
    const m = Math.max(0, Math.min(n, Math.round(((px - pad.l) / pw) * n)));
    const x = X(m);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    opts.series.forEach((s, k) => {
      dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', Y(s.data[m])); dots[k].setAttribute('visibility', 'visible');
    });
    tip.innerHTML = opts.tooltip(m);
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let tx = ev.clientX + 14, ty = ev.clientY - th - 12;
    if (tx + tw > window.innerWidth - 8) tx = ev.clientX - tw - 14;
    if (ty < 8) ty = ev.clientY + 16;
    tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
  };
  const leave = () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
  hit.addEventListener('pointercancel', leave);

  container.appendChild(svg);
}

function monthLabel(m) {
  const y = Math.floor(m / 12), mm = m % 12;
  return `Año ${y}` + (mm ? `, mes ${mm}` : '');
}

/* =========================================================
   State / inputs
   ========================================================= */
const $ = (id) => document.getElementById(id);
const num = (id) => {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : 0;
};

const STORE_KEY = 'ic-inputs-v1';
const PERSIST_IDS = ['c-initial', 'c-monthly', 'c-rate', 'c-years', 'c-comp', 'c-scale',
  'g-target', 'g-years', 'g-initial', 'g-monthly', 'g-rate'];

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    for (const id of PERSIST_IDS) if (s[id] != null) $(id).value = s[id];
  } catch (_) { /* ignore */ }
}
function saveState() {
  try {
    const s = {};
    for (const id of PERSIST_IDS) s[id] = $(id).value;
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch (_) { /* ignore */ }
}

function syncSliders() {
  document.querySelectorAll('input[type=range][data-for]').forEach((r) => {
    r.value = $(r.dataset.for).value;
  });
}

/* =========================================================
   Calculator tab
   ========================================================= */
const SEG_COLORS = ['--seg-1', '--seg-2', '--seg-3', '--seg-4', '--seg-5'];

function renderCalc() {
  const P = Math.max(0, num('c-initial'));
  const pmt = Math.max(0, num('c-monthly'));
  const rate = Math.max(0, num('c-rate'));
  const years = Math.min(100, Math.max(1, Math.round(num('c-years')) || 1));

  const sim = simulate(P, pmt, rate, years);
  const final = sim.bal[sim.n];
  const contributed = sim.contrib[sim.n];

  $('s-final').textContent = money(final);
  $('s-contrib').textContent = money(contributed);
  $('s-interest').textContent = money(final - contributed);
  $('s-mult').textContent = contributed > 0 ? '×' + nf2.format(final / contributed) : '—';

  // Milestones
  const k = milestoneScale(final, $('c-scale').value);
  const values = BASE_MILESTONES.map((v) => v * k);
  const all = values.map((v) => ({ value: v, month: crossingMonth(sim.bal, v) }));
  const reached = all.filter((m) => m.month !== null);

  $('chart-title').textContent = `Camino a tu primer ${compactShort(values[values.length - 1])}`;
  $('chart-sub').textContent =
    `${money(P)} inicial + ${money(pmt)}/mes al ${pct(rate)} anual durante ${years} años` +
    (k !== 1 ? ` · hitos ×${nf2.format(k)}` : '');

  drawChart($('chart-calc'), {
    months: sim.n,
    series: [
      { data: sim.bal, color: cssVar('--capital'), width: 3, area: true },
      { data: sim.contrib, color: cssVar('--contrib'), width: 2, dash: '5 4' },
    ],
    milestones: reached.filter((m) => m.month > 0),
    tooltip: (m) => `<b>${monthLabel(m)}</b>
      <div class="row"><span><i style="background:${cssVar('--capital')}"></i>Capital</span><b>${money(sim.bal[m])}</b></div>
      <div class="row"><span><i style="background:${cssVar('--contrib')}"></i>Aportado</span><span>${money(sim.contrib[m])}</span></div>
      <div class="row"><span>Intereses</span><span>${money(sim.bal[m] - sim.contrib[m])}</span></div>`,
  });

  // Time bar
  const bar = $('timebar');
  bar.innerHTML = '';
  let prev = 0;
  const segs = [];
  reached.forEach((m, idx) => {
    if (m.month - prev > 1e-6) segs.push({ from: prev, to: m.month, color: cssVar(SEG_COLORS[idx]), label: `→ ${compactShort(m.value)}` });
    prev = m.month;
  });
  if (sim.n - prev > 1e-6) {
    segs.push({
      from: prev, to: sim.n,
      color: reached.length === values.length ? cssVar('--seg-5') : cssVar('--seg-rest'),
      label: reached.length ? `${compactShort(reached[reached.length - 1].value)} →` : 'Sin hitos',
    });
  }
  for (const s of segs) {
    const d = document.createElement('div');
    const share = (s.to - s.from) / sim.n * 100;
    d.style.flexGrow = share;
    d.style.flexBasis = '0';
    d.style.background = s.color;
    d.textContent = share >= 7 ? nf1.format(share) + '%' : '';
    d.title = `${s.label}: ${duration(s.to - s.from)} (${nf1.format(share)}% del plazo)`;
    bar.appendChild(d);
  }

  // Milestone cards
  const box = $('milestones');
  box.innerHTML = '';
  let prevMonth = 0;
  all.forEach((m, idx) => {
    const c = document.createElement('div');
    c.className = 'ms' + (m.month === null ? ' miss' : '');
    c.style.setProperty('--c', cssVar(SEG_COLORS[idx]));
    if (m.month === null) {
      const need = requiredPmt(m.value, P, rate, sim.n);
      c.innerHTML = `<div class="amt">${compact(m.value)}</div>
        <div class="when">No se alcanza en ${years} años</div>
        <div class="delta">Necesitarías ${money(need)}/mes</div>`;
    } else if (m.month === 0) {
      c.innerHTML = `<div class="amt">${compact(m.value)}</div><div class="when">Ya lo tenés</div><div class="delta">desde el inicio</div>`;
    } else {
      c.innerHTML = `<div class="amt">${compact(m.value)}</div>
        <div class="when">en ${duration(m.month)}</div>
        <div class="delta">+${duration(m.month - prevMonth)} desde el hito anterior</div>`;
      prevMonth = m.month;
    }
    box.appendChild(c);
  });

  // Year table
  const rows = ['<thead><tr><th>Año</th><th>Aportado</th><th>Intereses del año</th><th>Intereses acum.</th><th>Capital</th></tr></thead><tbody>'];
  for (let y = 1; y <= years; y++) {
    const m = y * 12, mp = (y - 1) * 12;
    const yearInterest = (sim.bal[m] - sim.bal[mp]) - (sim.contrib[m] - sim.contrib[mp]);
    rows.push(`<tr><td>${y}</td><td>${money(sim.contrib[m])}</td><td>${money(yearInterest)}</td><td>${money(sim.bal[m] - sim.contrib[m])}</td><td><b>${money(sim.bal[m])}</b></td></tr>`);
  }
  rows.push('</tbody>');
  $('year-table').innerHTML = rows.join('');
}

/* =========================================================
   Goal tab
   ========================================================= */
function rateText(res) {
  if (res.status === 'impossible') return '—';
  if (res.status === 'already') return '0%';
  return pct(res.rate);
}

function roundNice(v) {
  if (v <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
}

function heatColor(t) {
  // t in [0,1]: 0 = easy (green) → 1 = hard (red)
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const hue = 140 - 140 * Math.max(0, Math.min(1, t));
  return dark ? `hsl(${hue} 45% 28%)` : `hsl(${hue} 65% 86%)`;
}

function renderGoal() {
  const T = Math.max(1, num('g-target'));
  const years = Math.min(100, Math.max(1, Math.round(num('g-years')) || 1));
  const n = years * 12;
  const P = Math.max(0, num('g-initial'));
  const M = Math.max(0, num('g-monthly'));
  const r = Math.max(0, num('g-rate'));

  document.querySelectorAll('[data-chips="g-target"] button').forEach((b) => {
    b.classList.toggle('on', parseFloat(b.dataset.v) === T);
  });

  // Scenario 1: no initial capital
  const s1pmt = requiredPmt(T, 0, r, n);
  const s1rate = requiredRate(T, 0, M, n);
  $('g1-pmt').textContent = money(s1pmt);
  $('g1-rate-lbl').textContent = `a una tasa del ${pct(r)}`;
  $('g1-rate').textContent = M > 0 ? rateText(s1rate) : '—';
  $('g1-pmt-lbl').textContent = M > 0 ? `aportando ${money(M)}/mes` : 'ingresá un aporte mensual';

  // Scenario 2: initial capital only
  const s2rate = requiredRate(T, P, 0, n);
  const s2pv = requiredPV(T, r, n);
  $('g2-rate').textContent = P > 0 ? rateText(s2rate) : '—';
  $('g2-pv-lbl').textContent = P > 0 ? `con ${money(P)} iniciales` : 'ingresá un capital inicial';
  $('g2-pv').textContent = money(s2pv);
  $('g2-rate-lbl').textContent = `a una tasa del ${pct(r)}`;

  // Scenario 3: both
  const s3rate = requiredRate(T, P, M, n);
  const s3pmt = requiredPmt(T, P, r, n);
  $('g3-rate').textContent = rateText(s3rate);
  $('g3-lbl').textContent = `${money(P)} + ${money(M)}/mes`;
  $('g3-pmt').textContent = s3pmt === 0 ? '$0' : money(s3pmt);
  $('g3-pmt-lbl').textContent = `con ${money(P)} al ${pct(r)}`;

  // Chart: each scenario at its required rate
  const series = [];
  const curves = [];
  const add = (res, p0, m0, colorVar, name) => {
    if (res.status === 'impossible' || (p0 === 0 && m0 === 0)) return;
    const sim = simulate(p0, m0, res.rate, years);
    series.push({ data: sim.bal, color: cssVar(colorVar), width: 2.5 });
    curves.push({ name, color: cssVar(colorVar), sim, rate: res.rate });
  };
  if (M > 0) add(s1rate, 0, M, '--s1', 'Sin capital');
  if (P > 0) add(s2rate, P, 0, '--s2', 'Solo capital');
  add(s3rate, P, M, '--s3', 'Capital + aportes');

  const chart = $('chart-goal');
  if (series.length) {
    drawChart(chart, {
      months: n,
      series,
      target: T,
      tooltip: (m) => `<b>${monthLabel(m)}</b>` + curves.map((c) =>
        `<div class="row"><span><i style="background:${c.color}"></i>${c.name} (${pct(c.rate)})</span><b>${money(c.sim.bal[m])}</b></div>`).join(''),
    });
  } else {
    chart.innerHTML = '<p class="muted" style="padding:40px;text-align:center">Ingresá un capital inicial o un aporte mensual para ver los caminos.</p>';
  }

  // Columns: initial capital options
  let caps = P > 0 ? [0, P / 2, P, P * 2, P * 4] : [0, T * 0.02, T * 0.05, T * 0.1, T * 0.2];
  caps = [...new Set(caps.map((c) => (c === P ? P : roundNice(c))))];

  // Heatmap 1: required monthly by rate × capital
  let rates = [r - 6, r - 4, r - 2, r, r + 2, r + 4, r + 6].filter((x) => x >= 0.5 || x === r);
  rates = [...new Set(rates.map((x) => Math.round(x * 100) / 100))];
  const grid = rates.map((rt) => caps.map((c) => requiredPmt(T, c, rt, n)));
  const maxPmt = Math.max(...grid.flat(), 1);
  let h = '<thead><tr><th>Tasa \\ Capital</th>' + caps.map((c) => `<th>${compactShort(c)}</th>`).join('') + '</tr></thead><tbody>';
  rates.forEach((rt, i) => {
    h += `<tr><th>${pct(rt)}</th>`;
    caps.forEach((c, j) => {
      const v = grid[i][j];
      const sel = rt === r && c === P ? ' sel' : '';
      h += `<td class="${v === 0 ? 'ok' : ''}${sel}" style="background:${heatColor(Math.sqrt(v / maxPmt))}" data-rate="${rt}" data-cap="${c}"
        title="${pct(rt)} con ${money(c)} inicial">${v === 0 ? '✓ $0' : v < 100e3 ? money(v) : compactShort(v)}</td>`;
    });
    h += '</tr>';
  });
  $('heatmap').innerHTML = h + '</tbody>';

  // Heatmap 2: required rate by monthly × capital
  const baseM = M > 0 ? M : roundNice(s1pmt) || 100;
  let pmts = [0, baseM / 2, baseM, baseM * 1.5, baseM * 2, baseM * 3];
  pmts = [...new Set(pmts.map((x) => (x === M ? M : roundNice(x))))];
  const rgrid = pmts.map((pm) => caps.map((c) => requiredRate(T, c, pm, n)));
  const finite = rgrid.flat().filter((x) => x.status !== 'impossible').map((x) => x.rate);
  const maxRate = Math.max(Math.min(Math.max(...finite, 1), 40), 1);
  let h2 = '<thead><tr><th>Aporte \\ Capital</th>' + caps.map((c) => `<th>${compactShort(c)}</th>`).join('') + '</tr></thead><tbody>';
  pmts.forEach((pm, i) => {
    h2 += `<tr><th>${compactShort(pm)}/mes</th>`;
    caps.forEach((c, j) => {
      const res = rgrid[i][j];
      const sel = pm === M && c === P ? ' sel' : '';
      const bgc = res.status === 'impossible' ? 'transparent' : heatColor(res.rate / maxRate);
      h2 += `<td class="${res.status === 'already' ? 'ok' : ''}${sel}" style="background:${bgc}" data-pmt="${pm}" data-cap="${c}">${rateText(res)}</td>`;
    });
    h2 += '</tr>';
  });
  $('heatmap-rate').innerHTML = h2 + '</tbody>';
}

/* =========================================================
   Wiring
   ========================================================= */
function renderAll() {
  rateMode = $('c-comp').value;
  renderCalc();
  renderGoal();
  saveState();
}

let raf = 0;
const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderAll); };

function init() {
  loadState();
  syncSliders();

  document.querySelectorAll('input[type=number], select').forEach((inp) => {
    inp.addEventListener('input', () => {
      const r = document.querySelector(`input[type=range][data-for="${inp.id}"]`);
      if (r) r.value = inp.value;
      schedule();
    });
  });
  document.querySelectorAll('input[type=range][data-for]').forEach((r) => {
    r.addEventListener('input', () => { $(r.dataset.for).value = r.value; schedule(); });
  });
  document.querySelectorAll('[data-chips] button').forEach((b) => {
    b.addEventListener('click', () => { $(b.parentElement.dataset.chips).value = b.dataset.v; schedule(); });
  });

  $('heatmap').addEventListener('click', (e) => {
    const td = e.target.closest('td[data-rate]');
    if (!td) return;
    $('g-rate').value = td.dataset.rate;
    $('g-initial').value = td.dataset.cap;
    syncSliders(); schedule();
  });
  $('heatmap-rate').addEventListener('click', (e) => {
    const td = e.target.closest('td[data-pmt]');
    if (!td) return;
    $('g-monthly').value = td.dataset.pmt;
    $('g-initial').value = td.dataset.cap;
    syncSliders(); schedule();
  });

  // Tabs
  const show = (name) => {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
    });
    document.querySelectorAll('.panel').forEach((p) => {
      const on = p.id === 'tab-' + name;
      p.hidden = !on;
      p.classList.toggle('active', on);
    });
    schedule();
  };
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    history.replaceState(null, '', '#' + t.dataset.tab);
    show(t.dataset.tab);
  }));
  show(location.hash === '#goal' ? 'goal' : 'calc');

  // Redraw on resize / theme change
  const ro = new ResizeObserver(schedule);
  ro.observe($('chart-calc'));
  ro.observe($('chart-goal'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
