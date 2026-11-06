// Small dense linear algebra and probability helpers for the models. Matrices are row-major
// number[][]; sizes are ~140 x 140, so plain loops are fast enough.

export type Matrix = number[][];

export function zeros(n: number, m = n): Matrix {
  return Array.from({ length: n }, () => new Array<number>(m).fill(0));
}

/** Lower-triangular L with A = L Lᵀ. Throws if A is not symmetric positive definite. */
export function cholesky(a: Matrix): Matrix {
  const n = a.length;
  const l = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      const li = l[i];
      const lj = l[j];
      for (let k = 0; k < j; k++) s -= li[k] * lj[k];
      if (i === j) {
        if (!(s > 0)) throw new Error(`Matrix not positive definite at ${i}`);
        li[i] = Math.sqrt(s);
      } else {
        li[j] = s / lj[j];
      }
    }
  }
  return l;
}

/** Solve L Lᵀ x = b given the Cholesky factor L. */
export function choleskySolve(l: Matrix, b: readonly number[]): number[] {
  const n = l.length;
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i][k] * y[k];
    y[i] = s / l[i][i];
  }
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= l[k][i] * x[k];
    x[i] = s / l[i][i];
  }
  return x;
}

/** Inverse of an SPD matrix from its Cholesky factor. */
export function choleskyInverse(l: Matrix): Matrix {
  const n = l.length;
  const inv = zeros(n);
  const e = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) {
    e.fill(0);
    e[j] = 1;
    const col = choleskySolve(l, e);
    for (let i = 0; i < n; i++) inv[i][j] = col[i];
  }
  return inv;
}

/**
 * Weighted ridge regression with a prior center: minimizes Σ w·(y − Xβ)² + Σ λ_j (β_j − c_j)².
 * Rows are sparse: each is a list of [column, value] pairs. Returns β and the Cholesky factor of
 * XᵀWX + Λ (for covariance draws).
 */
export function ridge(
  rows: readonly (readonly [number, number][])[],
  y: readonly number[],
  nCols: number,
  lambda: readonly number[],
  center?: readonly number[],
  weights?: readonly number[],
): { beta: number[]; chol: Matrix } {
  const a = zeros(nCols);
  const b = new Array<number>(nCols).fill(0);
  rows.forEach((row, i) => {
    const w = weights ? weights[i] : 1;
    for (const [p, vp] of row) {
      b[p] += w * vp * y[i];
      for (const [q, vq] of row) a[p][q] += w * vp * vq;
    }
  });
  for (let j = 0; j < nCols; j++) {
    a[j][j] += lambda[j];
    if (center) b[j] += lambda[j] * center[j];
  }
  const chol = cholesky(a);
  return { beta: choleskySolve(chol, b), chol };
}

/** Standard normal CDF via a high-precision erfc (series below 0.5, continued fraction above). */
export function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

function erfc(x: number): number {
  const z = Math.abs(x);
  let r: number;
  if (z < 0.5) {
    r = 1 - erfSeries(z);
  } else if (z > 26) {
    r = 0;
  } else {
    // Lentz continued fraction for erfc, converges quickly for z >= 0.5.
    const tiny = 1e-300;
    let f = z;
    let c = z;
    let d = 0;
    for (let k = 1; k < 500; k++) {
      const an = k / 2;
      d = z + an * d;
      d = Math.abs(d) < tiny ? tiny : d;
      c = z + an / c;
      c = Math.abs(c) < tiny ? tiny : c;
      d = 1 / d;
      const delta = c * d;
      f *= delta;
      if (Math.abs(delta - 1) < 1e-16) break;
    }
    r = Math.exp(-z * z) / (f * Math.sqrt(Math.PI));
  }
  return x >= 0 ? r : 2 - r;
}

function erfSeries(z: number): number {
  let term = z;
  let sum = z;
  const z2 = z * z;
  for (let n = 1; n < 100; n++) {
    term *= -z2 / n;
    const add = term / (2 * n + 1);
    sum += add;
    if (Math.abs(add) < 1e-17) break;
  }
  return (2 / Math.sqrt(Math.PI)) * sum;
}

/** Deterministic PRNG (mulberry32) so simulations are reproducible run to run. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draws via Box–Muller. */
export function gaussian(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Linear-interpolated percentile (numpy's default), p in [0, 100]. */
export function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = ((s.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
