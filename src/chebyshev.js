// Chebyshev (equal-ripple) multilayer anti-reflection design.
//
// Follows Pozar, Microwave Engineering §5.7 (small-reflection theory): with N
// quarter-wave layers between vacuum (n = 1) and a substrate n_s,
//
//   Γ(θ) = Σ_k Γ_k e^{-2jkθ} = A e^{-jNθ} T_N(sec θm · cos θ),
//
// where θ = (π/2) f/f0 is the electrical length of each layer. The step
// reflections are Γ_k = ½ ln(n_{k+1}/n_k), and A is fixed by requiring the
// steps to add up to the full transition: Σ 2Γ_k = ln n_s, i.e.
// A = ln(n_s) / (2 T_N(sec θm)).
//
// The design bandwidth (set by θm) trades ripple height against bandwidth.
// `designChebyshev` scans it and keeps the design whose exact passband-average
// reflection (evaluated by the caller's TMM) is lowest.

const SPEED_OF_LIGHT = 299792458; // m/s

// Power-series coefficients of the Chebyshev polynomial T_N(y) = Σ a[m] y^m
function chebyshevPowerCoeffs(N) {
  let prev = [1];      // T_0
  let curr = [0, 1];   // T_1
  if (N === 0) return prev;
  for (let k = 1; k < N; k++) {
    const next = new Array(k + 2).fill(0);
    for (let m = 0; m < curr.length; m++) next[m + 1] += 2 * curr[m];
    for (let m = 0; m < prev.length; m++) next[m] -= prev[m];
    prev = curr;
    curr = next;
  }
  return curr;
}

function binomial(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

// Refractive indices n_1..n_N of the Chebyshev stack for a given sec θm (x >= 1).
export function chebyshevIndices(N, nSub, x) {
  const a = chebyshevPowerCoeffs(N);
  const TNx = a.reduce((s, c, m) => s + c * Math.pow(x, m), 0);
  const A = Math.log(nSub) / (2 * TNx);

  // Γ_k is the coefficient of e^{j(N-2k)θ} in A·T_N(x cos θ), using
  // cos^m θ = 2^-m Σ_i C(m,i) e^{j(m-2i)θ}.
  const gamma = new Array(N + 1).fill(0);
  for (let m = 0; m <= N; m++) {
    if (a[m] === 0) continue;
    const scale = (A * a[m] * Math.pow(x, m)) / Math.pow(2, m);
    for (let i = 0; i <= m; i++) {
      const k = (N - (m - 2 * i)) / 2; // e^{j(m-2i)θ} = e^{j(N-2k)θ}
      gamma[k] += scale * binomial(m, i);
    }
  }

  const indices = [];
  let lnN = 0; // vacuum
  for (let k = 0; k < N; k++) {
    lnN += 2 * gamma[k];
    indices.push(Math.exp(lnN));
  }
  return indices;
}

// Quarter-wave layers at the band centre, rounded to 0.001 (index) and 1 µm.
function buildLayers(indices, f0_GHz) {
  return indices.map((n) => {
    const d_mm = (SPEED_OF_LIGHT / (4 * n * f0_GHz * 1e9)) * 1e3;
    return { n: Number(n.toFixed(3)), d: Number(d_mm.toFixed(3)) };
  });
}

// sec θm for a design fractional bandwidth Δ (0 < Δ < 2): θm = (π/4)(2 − Δ)
const secThetaM = (fracBW) => 1 / Math.cos((Math.PI / 4) * (2 - fracBW));

// Returns { layers, avgR, textbookAvgR, designFracBW, passbandFracBW }.
// `avgR(layerList)` must return the exact passband-average reflection of the
// candidate stack ({n, d} per layer, substrate excluded).
export function designChebyshev(N, nSub, fLo, fHi, avgR) {
  const f0 = (fLo + fHi) / 2;
  const passbandFracBW = (fHi - fLo) / f0;

  const evaluate = (fracBW) => {
    const layers = buildLayers(chebyshevIndices(N, nSub, secThetaM(fracBW)), f0);
    return { layers, avgR: avgR(layers), designFracBW: fracBW };
  };

  // Coarse scan of the design bandwidth, then golden-section refinement.
  const lo = 0.001, hi = 1.95, steps = 80;
  let best = null, bestIdx = 0;
  const grid = [];
  for (let i = 0; i <= steps; i++) {
    const r = evaluate(lo + (i / steps) * (hi - lo));
    grid.push(r);
    if (!best || r.avgR < best.avgR) { best = r; bestIdx = i; }
  }
  let a = grid[Math.max(0, bestIdx - 1)].designFracBW;
  let b = grid[Math.min(steps, bestIdx + 1)].designFracBW;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 25; it++) {
    const c = b - g * (b - a), d = a + g * (b - a);
    const rc = evaluate(c), rd = evaluate(d);
    if (rc.avgR < best.avgR) best = rc;
    if (rd.avgR < best.avgR) best = rd;
    if (rc.avgR < rd.avgR) b = d; else a = c;
  }

  const textbook = evaluate(Math.min(passbandFracBW, hi));
  return { ...best, textbookAvgR: textbook.avgR, passbandFracBW };
}
