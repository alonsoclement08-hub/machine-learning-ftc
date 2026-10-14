// Planification de trajet (A* sur grille + lissage) pour le centre du robot, de notre côté du terrain.
// Le robot est approximé par un disque de rayon = demi-diagonale (il peut donc tourner partout
// sur le trajet). Les poses de départ/arrivée collées à un mur ou une FLOWER sont rejointes par un
// petit segment "d'échappement" en ligne droite, vérifié exactement par le simulateur.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};
  const G = BZ.G;

  function Planner(world, res) {
    this.world = world;
    this.res = res || 2;
    this.R = world.rd.radius + 0.6;
    const half = world.half;
    this.x0 = -half; this.y0 = -half;
    this.nx = Math.ceil(half / this.res) + 1;
    this.ny = Math.ceil((2 * half) / this.res) + 1;
    this.free = new Uint8Array(this.nx * this.ny);
    for (let i = 0; i < this.nx; i++) {
      for (let j = 0; j < this.ny; j++) {
        this.free[i * this.ny + j] = this.isFree(this.x0 + i * this.res, this.y0 + j * this.res) ? 1 : 0;
      }
    }
    this.cache = new Map();
  }

  Planner.prototype.isFree = function (x, y) {
    const R = this.R, half = this.world.half;
    if (x < -half + R || x > -R || y < -half + R || y > half - R) return false;
    for (const o of this.world.obstacles) {
      if (G.circlePolyOverlap(x, y, R, o.poly)) return false;
    }
    return true;
  };

  Planner.prototype.segFree = function (ax, ay, bx, by) {
    const n = Math.max(1, Math.ceil(G.dist(ax, ay, bx, by) / 1.0));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.isFree(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  };

  // Point libre le plus proche (recherche en spirale sur la grille).
  Planner.prototype.nearestFree = function (x, y) {
    if (this.isFree(x, y)) return [x, y];
    let best = null, bd = Infinity;
    for (let i = 0; i < this.nx; i++) {
      for (let j = 0; j < this.ny; j++) {
        if (!this.free[i * this.ny + j]) continue;
        const px = this.x0 + i * this.res, py = this.y0 + j * this.res;
        const d = (px - x) * (px - x) + (py - y) * (py - y);
        if (d < bd) { bd = d; best = [px, py]; }
      }
    }
    if (!best) return null;
    // affinage : on se rapproche en ligne droite tant que c'est libre
    let [bx, by] = best;
    for (let k = 0; k < 12; k++) {
      const mx = (bx + x) / 2, my = (by + y) / 2;
      if (this.isFree(mx, my)) { bx = mx; by = my; } else break;
    }
    return [bx, by];
  };

  Planner.prototype.cellOf = function (x, y) {
    const i = Math.round((x - this.x0) / this.res), j = Math.round((y - this.y0) / this.res);
    return [Math.max(0, Math.min(this.nx - 1, i)), Math.max(0, Math.min(this.ny - 1, j))];
  };

  // Renvoie une liste de points [[x,y],...] du point A au point B (inclus), ou null.
  Planner.prototype.path = function (ax, ay, bx, by) {
    // clé exacte : un chemin mémorisé pour un point voisin donnerait un plan non reproductible
    const key = ax + ',' + ay + ',' + bx + ',' + by;
    if (this.cache.has(key)) return this.cache.get(key);
    const res = this._path(ax, ay, bx, by);
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(key, res);
    return res;
  };

  Planner.prototype._path = function (ax, ay, bx, by) {
    if (this.segFree(ax, ay, bx, by)) return [[ax, ay], [bx, by]];
    const A = this.nearestFree(ax, ay), B = this.nearestFree(bx, by);
    if (!A || !B) return null;
    const pre = (A[0] !== ax || A[1] !== ay) ? [[ax, ay]] : [];
    const post = (B[0] !== bx || B[1] !== by) ? [[bx, by]] : [];
    let mid;
    if (this.segFree(A[0], A[1], B[0], B[1])) {
      mid = [A, B];
    } else {
      const grid = this.astar(A, B);
      if (!grid) return null;
      mid = this.smooth([A].concat(grid).concat([B]));
    }
    const pts = pre.concat(mid).concat(post);
    // supprime les doublons
    const out = [];
    for (const p of pts) {
      const q = out[out.length - 1];
      if (!q || G.dist(p[0], p[1], q[0], q[1]) > 0.05) out.push(p);
    }
    return out;
  };

  Planner.prototype.astar = function (A, B) {
    const ny = this.ny, nx = this.nx, res = this.res;
    const [si, sj] = this.cellOf(A[0], A[1]);
    const [gi, gj] = this.cellOf(B[0], B[1]);
    const N = nx * ny;
    const g = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = [];
    const push = (f, id) => {
      heap.push([f, id]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]]; k = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    const sid = si * ny + sj, gid = gi * ny + gj;
    g[sid] = 0;
    push(0, sid);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (heap.length) {
      const [, id] = pop();
      if (closed[id]) continue;
      closed[id] = 1;
      if (id === gid) break;
      const i = Math.floor(id / ny), j = id % ny;
      for (const [di, dj] of dirs) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const nid = a * ny + b;
        if (!this.free[nid] || closed[nid]) continue;
        const c = g[id] + Math.hypot(di, dj) * res;
        if (c < g[nid]) {
          g[nid] = c; came[nid] = id;
          push(c + Math.hypot(a - gi, b - gj) * res, nid);
        }
      }
    }
    if (!closed[gid]) return null;
    const cells = [];
    for (let id = gid; id !== -1 && id !== sid; id = came[id]) {
      cells.push([this.x0 + Math.floor(id / ny) * res, this.y0 + (id % ny) * res]);
    }
    return cells.reverse();
  };

  // Lissage "string pulling" : on garde le point le plus loin visible en ligne droite.
  Planner.prototype.smooth = function (pts) {
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.segFree(pts[i][0], pts[i][1], pts[j][0], pts[j][1])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  };

  BZ.Planner = Planner;
  if (typeof module !== 'undefined' && module.exports) module.exports = Planner;
})(typeof window !== 'undefined' ? window : globalThis);
