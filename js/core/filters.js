// One Euro filter — low-latency jitter smoothing for the hand cursor.
// Casiez et al. 2012: adaptive cutoff = minCutoff + beta * |speed|.

class LowPass {
  constructor() { this.y = null; }
  filter(x, a) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; }
}

export class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.01, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.reset();
  }
  reset() { this.x = new LowPass(); this.dx = new LowPass(); this.t = null; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v, tSec) {
    if (this.t === null) { this.t = tSec; this.dx.y = 0; return this.x.filter(v, 1); }
    const dt = Math.max(1e-3, tSec - this.t);
    this.t = tSec;
    const dv = (v - this.x.y) / dt;
    const edv = this.dx.filter(dv, OneEuro.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edv);
    return this.x.filter(v, OneEuro.alpha(cutoff, dt));
  }
}
