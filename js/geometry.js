// Outils géométriques 2D (vue de dessus). Unités : pouces, angles en radians.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};

  const G = {};

  G.wrap = function (a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a <= -Math.PI) a += 2 * Math.PI;
    return a;
  };

  G.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

  // Coins d'un rectangle orienté : centre (x, y), cap h, demi-longueur hl (axe du cap), demi-largeur hw.
  G.rectCorners = function (x, y, h, hl, hw) {
    const c = Math.cos(h), s = Math.sin(h);
    const pts = [];
    for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]]) {
      pts.push([x + a * c - b * s, y + a * s + b * c]);
    }
    return pts;
  };

  function project(poly, ax, ay) {
    let mn = Infinity, mx = -Infinity;
    for (const p of poly) {
      const d = p[0] * ax + p[1] * ay;
      if (d < mn) mn = d;
      if (d > mx) mx = d;
    }
    return [mn, mx];
  }

  // Test de séparation des axes entre deux polygones convexes. Renvoie la profondeur de
  // pénétration minimale (0 si pas de contact). `tol` tolère un léger contact.
  G.polyOverlap = function (A, B, tol) {
    tol = tol || 0;
    let minDepth = Infinity;
    for (const poly of [A, B]) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        let ax = -(q[1] - p[1]), ay = q[0] - p[0];
        const n = Math.hypot(ax, ay);
        if (n < 1e-9) continue;
        ax /= n; ay /= n;
        const [a0, a1] = project(A, ax, ay);
        const [b0, b1] = project(B, ax, ay);
        const depth = Math.min(a1 - b0, b1 - a0);
        if (depth <= tol) return 0;
        if (depth < minDepth) minDepth = depth;
      }
    }
    return minDepth;
  };

  G.rectPoly = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

  // Cercle (cx, cy, r) contre polygone convexe : distance du centre au polygone < r ?
  G.circlePolyOverlap = function (cx, cy, r, poly) {
    if (G.pointInPoly(cx, cy, poly)) return true;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      if (G.pointSegDist(cx, cy, p[0], p[1], q[0], q[1]) < r) return true;
    }
    return false;
  };

  G.pointInPoly = function (x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  G.pointSegDist = function (px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  // Distance d'un segment à un rectangle aligné (approximation par échantillonnage fin).
  G.segRectDist = function (ax, ay, bx, by, r) {
    const n = Math.max(2, Math.ceil(G.dist(ax, ay, bx, by) / 0.5));
    let best = Infinity;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const dx = Math.max(r.x0 - x, 0, x - r.x1), dy = Math.max(r.y0 - y, 0, y - r.y1);
      best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  };

  // Générateur pseudo-aléatoire reproductible (mulberry32).
  G.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  G.IN_PER_M = 39.3701;
  G.CM_PER_IN = 2.54;
  G.deg = (r) => (r * 180) / Math.PI;
  G.rad = (d) => (d * Math.PI) / 180;

  BZ.G = G;
  if (typeof module !== 'undefined' && module.exports) module.exports = G;
})(typeof window !== 'undefined' ? window : globalThis);
