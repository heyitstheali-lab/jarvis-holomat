// Perspective (homography) fit used by hand calibration: maps the camera's view
// of your fingertip onto the iPad screen, whatever angle the camera sits at.

/** Least-squares homography from ≥4 point pairs. Returns 9 numbers (row-major, h8 = 1). */
export function solveHomography(src, dst) {
  const n = src.length;
  if (n < 4 || dst.length !== n) throw new Error('need ≥4 point pairs');
  const M = Array.from({ length: 8 }, () => new Float64Array(8));
  const v = new Float64Array(8);
  const addRow = (row, b) => {
    for (let i = 0; i < 8; i++) {
      v[i] += row[i] * b;
      for (let j = 0; j < 8; j++) M[i][j] += row[i] * row[j];
    }
  };
  for (let k = 0; k < n; k++) {
    const [x, y] = src[k];
    const [u, w] = dst[k];
    addRow([x, y, 1, 0, 0, 0, -x * u, -y * u], u);
    addRow([0, 0, 0, x, y, 1, -x * w, -y * w], w);
  }
  const h = gaussSolve(M, v);
  if (!h || h.some((q) => !Number.isFinite(q))) throw new Error('degenerate calibration points');
  return [...h, 1];
}

function gaussSolve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Mean reprojection error (in destination units) — used to sanity check a calibration. */
export function reprojectionError(H, src, dst) {
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    const [u, w] = applyH(H, src[i][0], src[i][1]);
    sum += Math.hypot(u - dst[i][0], w - dst[i][1]);
  }
  return sum / src.length;
}
