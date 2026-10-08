// P2.3-QA2 design-based estimators. Pure functions; no I/O on import.
// Stratified sampling without replacement; ratio estimator with Taylor linearization;
// Korn-Graubard effective-sample-size intervals (Wilson and Clopper-Pearson).

export const Z95 = 1.959963984540054;

function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015;
  for (const k of c) s += k / ++y;
  return -t + Math.log(2.5066282746310005 * s / x);
}
function betacf(a, b, x) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-300) d = 1e-300; d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}
export function betaCdf(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
export function betaQuantile(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (betaCdf(mid, a, b) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
export function wilson(p, n, z = Z95) {
  if (!(n > 0)) return null;
  const d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
export function clopperPearson(p, n, alpha = 0.05) {
  if (!(n > 0)) return null;
  const x = p * n;
  return [x <= 0 ? 0 : betaQuantile(alpha / 2, x, n - x + 1), x >= n ? 1 : betaQuantile(1 - alpha / 2, x + 1, n - x)];
}

// units: [{ stratum, y, z }]; design: Map(stratum -> { N, n }) where n is the number of SELECTED units in the stratum.
// y/z are per-unit numerator/denominator contributions (e.g. correct facts / adjudicated facts).
export function ratioEstimate(units, design) {
  const byStratum = new Map();
  for (const u of units) { if (!byStratum.has(u.stratum)) byStratum.set(u.stratum, []); byStratum.get(u.stratum).push(u); }
  let Y = 0, Zt = 0, sampleUnits = 0, sampleDenominatorUnits = 0, rawY = 0, rawZ = 0;
  const notEstimableStrata = [];
  for (const [h, us] of byStratum) {
    const d = design.get(h); if (!d) throw new Error(`Unknown stratum ${h}`);
    if (us.length !== d.n) throw new Error(`Stratum ${h}: ${us.length} units supplied, design n=${d.n}; pass every selected unit (y=z=0 when out of domain).`);
    const w = d.N / d.n;
    for (const u of us) { Y += w * u.y; Zt += w * u.z; rawY += u.y; rawZ += u.z; sampleUnits++; if (u.z > 0) sampleDenominatorUnits++; }
  }
  if (!(Zt > 0)) return { estimate: null, reason: 'EMPTY_DOMAIN', sampleUnits, sampleDenominatorUnits };
  const R = Y / Zt;
  let variance = 0, allCensus = true;
  for (const [h, us] of byStratum) {
    const d = design.get(h), f = d.n / d.N, w = d.N / d.n;
    if (f >= 1) continue; allCensus = false;
    if (us.length < 2) { notEstimableStrata.push(h); continue; }
    const v = us.map(u => w * (u.y - R * u.z) / Zt), m = v.reduce((a, b) => a + b, 0) / v.length;
    variance += (1 - f) * us.length / (us.length - 1) * v.reduce((a, b) => a + (b - m) ** 2, 0);
  }
  const se = Math.sqrt(variance);
  let nEff, nEffBasis;
  if (variance > 0) { nEff = Math.min(R * (1 - R) / variance, Number.MAX_SAFE_INTEGER); nEffBasis = 'KORN_GRAUBARD'; }
  else { nEff = sampleDenominatorUnits; nEffBasis = allCensus ? 'CENSUS' : 'ZERO_VARIANCE_FALLBACK_SAMPLE_COUNT'; }
  return { estimate: R, se, variance, populationNumerator: Y, populationDenominator: Zt, rawNumerator: rawY, rawDenominator: rawZ,
    sampleUnits, sampleDenominatorUnits, nEff, nEffBasis, allCensus, notEstimableStrata,
    wilson95: allCensus ? null : wilson(R, nEff), clopperPearson95: allCensus ? null : clopperPearson(R, nEff) };
}

// Classify an estimate against the 95% target using the interval, never the point estimate alone.
export function targetVerdict(est, target = 0.95) {
  if (!est || est.estimate === null) return 'NOT_ESTIMABLE';
  if (est.allCensus) return est.estimate >= target ? 'TARGET_MET_EXACT' : 'TARGET_NOT_MET_EXACT';
  const ci = est.clopperPearson95; if (!ci) return 'NOT_ESTIMABLE';
  return ci[0] >= target ? 'TARGET_MET' : ci[1] < target ? 'TARGET_NOT_MET' : 'INCONCLUSIVE';
}

// Planning: expected 95% half-width of a stratified proportion when every stratum has true accuracy p.
export function plannedHalfWidth(design, p) {
  const N = [...design.values()].reduce((a, d) => a + d.N, 0);
  let v = 0;
  for (const d of design.values()) { const W = d.N / N, f = d.n / d.N; if (f < 1) v += W * W * (1 - f) * p * (1 - p) / d.n; }
  return { variance: v, halfWidth: Z95 * Math.sqrt(v), nEff: v > 0 ? p * (1 - p) / v : Infinity };
}
// Smallest observed accuracy whose Clopper-Pearson lower bound (with planned n_eff) reaches the target.
export function minimumObservedForTarget(design, target = 0.95) {
  for (let p = target; p <= 1.0000001; p += 0.0005) {
    const { nEff } = plannedHalfWidth(design, Math.min(p, 0.9999));
    const n = Number.isFinite(nEff) ? nEff : [...design.values()].reduce((a, d) => a + d.n, 0);
    if (clopperPearson(Math.min(p, 1), n)[0] >= target) return { minimumObservedAccuracy: Number(Math.min(p, 1).toFixed(4)), plannedNEff: n };
  }
  return { minimumObservedAccuracy: null };
}
