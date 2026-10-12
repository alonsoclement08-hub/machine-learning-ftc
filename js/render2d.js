// Vue de dessus du terrain (canvas 2D) + rejeu animé du plan.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};
  const G = BZ.G;

  const COL = {
    red: '#d7263d', blue: '#1b6fd1', pollen: '#f5d300', pollenEdge: '#a88f00',
    tile: '#c9c6bd', tileLine: '#b3afa4', wall: '#4a4d55', hive: '#7d808a',
  };

  function Field2D(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = null;
    this.t = 0;
    this.mode = null; // 'start' | 'partner'
    this.onPick = null;
    this.drag = null;
    const self = this;
    const ro = new ResizeObserver(() => self.resize());
    ro.observe(canvas);
    canvas.addEventListener('pointerdown', (e) => self.pointer('down', e));
    canvas.addEventListener('pointermove', (e) => self.pointer('move', e));
    canvas.addEventListener('pointerup', (e) => self.pointer('up', e));
  }

  Field2D.prototype.resize = function () {
    const r = this.c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.c.width = Math.max(10, Math.round(r.width * dpr));
    this.c.height = Math.max(10, Math.round(r.height * dpr));
    this.draw();
  };

  Field2D.prototype.setState = function (s) { this.state = s; this.draw(); };
  Field2D.prototype.setTime = function (t) { this.t = t; this.draw(); };

  // Repère : pouces, origine au centre ; écran : x vers la droite, y vers le haut, public en bas.
  Field2D.prototype.frame = function () {
    const W = this.c.width, H = this.c.height;
    const span = 2 * FIELD.half + 30;
    const s = Math.min(W, H) / span;
    return { s, cx: W / 2, cy: H / 2 };
  };
  Field2D.prototype.toScreen = function (x, y) {
    const f = this.frame();
    return [f.cx + x * f.s, f.cy - y * f.s];
  };
  Field2D.prototype.toField = function (px, py) {
    const f = this.frame();
    return [(px - f.cx) / f.s, -(py - f.cy) / f.s];
  };

  // Le simulateur travaille dans le repère rouge ; pour l'alliance bleue on tourne de 180°.
  Field2D.prototype.abs = function (x, y) {
    return this.state && this.state.alliance === 'blue' ? [-x, -y] : [x, y];
  };
  Field2D.prototype.absH = function (h) {
    return this.state && this.state.alliance === 'blue' ? h + Math.PI : h;
  };

  Field2D.prototype.pointer = function (kind, e) {
    if (!this.mode) return;
    const r = this.c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    let [x, y] = this.toField((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    [x, y] = this.abs(x, y); // retour au repère rouge (la rotation de 180° est sa propre inverse)
    if (this.mode === 'start' && kind === 'down') {
      if (this.onPick) this.onPick({ type: 'start', x, y });
    } else if (this.mode === 'partner') {
      if (kind === 'down') { this.drag = { x0: x, y0: y, x1: x, y1: y }; this.c.setPointerCapture(e.pointerId); }
      else if (this.drag && kind === 'move') { this.drag.x1 = x; this.drag.y1 = y; this.draw(); }
      else if (this.drag && kind === 'up') {
        const d = this.drag; this.drag = null;
        const z = { x0: Math.min(d.x0, d.x1), y0: Math.min(d.y0, d.y1), x1: Math.max(d.x0, d.x1), y1: Math.max(d.y0, d.y1) };
        if (this.onPick && z.x1 - z.x0 > 3 && z.y1 - z.y0 > 3) this.onPick({ type: 'partner', zone: z });
        this.draw();
      }
    }
  };

  // État du jeu à l'instant t pendant le rejeu (scénario nominal : tous les tirs entrent).
  BZ.replayState = function (result, world, game, t) {
    const out = { pose: null, held: game.prechargees, tips: 0, fill: world.startNectar, avail: {}, flying: [] };
    out.avail.jardin = world.garden.balls.length;
    for (const f of world.flowers) out.avail[f.id] = f.pollen;
    if (!result) return out;
    out.pose = BZ.poseAt(result.prims, result.plan.start, t);
    for (const e of result.events) {
      if (e.type === 'pickup' && e.t <= t) { out.avail[e.src] -= e.n; out.held += e.n; }
    }
    const tipTimes = result.events.filter((e) => e.type === 'tip').map((e) => e.t);
    for (const s of result.shots) {
      if (s.t <= t) out.held -= 1;
      const flight = 0.45;
      if (s.t <= t && t < s.t + flight) {
        const tipsBefore = tipTimes.filter((tt) => tt < s.t).length;
        out.flying.push({ from: s, to: world.cellTargets[tipsBefore % 2], u: (t - s.t) / flight });
      }
      if (s.t + 0.45 <= t) {
        out.fill += 1;
        if (out.fill >= game.seuilBascule) { out.fill = 0; out.tips += 1; }
      }
    }
    return out;
  };

  Field2D.prototype.draw = function () {
    const ctx = this.ctx, W = this.c.width, H = this.c.height;
    ctx.clearRect(0, 0, W, H);
    if (!root.FIELD) return;
    const F = FIELD, half = F.half, { s } = this.frame();
    const st = this.state || {};
    const alliance = st.alliance || 'red';
    const P = (x, y) => this.toScreen(x, y);
    const rect = (x0, y0, x1, y1) => {
      const [a, b] = P(x0, y1), [c, d] = P(x1, y0);
      return [a, b, c - a, d - b];
    };

    // Tapis
    ctx.fillStyle = COL.tile;
    ctx.fillRect(...rect(-half, -half, half, half));
    ctx.strokeStyle = COL.tileLine; ctx.lineWidth = Math.max(1, s * 0.25);
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath(); ctx.moveTo(...P(k * 24, -half)); ctx.lineTo(...P(k * 24, half)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...P(-half, k * 24)); ctx.lineTo(...P(half, k * 24)); ctx.stroke();
    }
    // Côté adverse (interdit en AUTO)
    ctx.fillStyle = 'rgba(70,70,90,0.28)';
    if (alliance === 'red') ctx.fillRect(...rect(0, -half, half, half));
    else ctx.fillRect(...rect(-half, -half, 0, half));
    // Colonnes A-F
    ctx.fillStyle = '#555'; ctx.font = `${Math.round(s * 4)}px system-ui`; ctx.textAlign = 'center';
    'ABCDEF'.split('').forEach((L, i) => ctx.fillText(L, ...P(-60 + i * 24, half + 4)));
    ctx.fillText('PUBLIC', ...P(0, -half - 8));
    ctx.save(); ctx.translate(...P(-half - 8, 0)); ctx.rotate(-Math.PI / 2); ctx.fillStyle = COL.red; ctx.fillText('ALLIANCE ROUGE', 0, 0); ctx.restore();
    ctx.save(); ctx.translate(...P(half + 8, 0)); ctx.rotate(Math.PI / 2); ctx.fillStyle = COL.blue; ctx.fillText('ALLIANCE BLEUE', 0, 0); ctx.restore();

    // Zones
    const zone = (z, color, label) => {
      ctx.fillStyle = color + '33'; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, s * 0.8);
      ctx.fillRect(...rect(z.x0, z.y0, z.x1, z.y1)); ctx.strokeRect(...rect(z.x0, z.y0, z.x1, z.y1));
      if (label) {
        ctx.fillStyle = color; ctx.font = `600 ${Math.round(s * 2.0)}px system-ui`;
        ctx.fillText(label, ...P((z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2));
      }
    };
    zone(F.loadingZone.red, COL.red, 'LOADING');
    zone(F.loadingZone.blue, COL.blue, 'LOADING');
    zone(F.garden.red, COL.red, '');
    zone(F.garden.blue, COL.blue, '');

    // Zone partenaire
    const pz = st.game && st.game.zonePartenaire;
    const drawPartner = (z) => {
      const [a0, b0] = this.abs(z.x0, z.y0), [a1, b1] = this.abs(z.x1, z.y1);
      ctx.setLineDash([6, 4]); ctx.strokeStyle = '#7a3cff'; ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(122,60,255,0.12)';
      const r = rect(Math.min(a0, a1), Math.min(b0, b1), Math.max(a0, a1), Math.max(b0, b1));
      ctx.fillRect(...r); ctx.strokeRect(...r); ctx.setLineDash([]);
    };
    if (pz) drawPartner(pz);
    if (this.drag) drawPartner(this.drag);

    // État de rejeu
    const res = st.result;
    const rs = st.world ? BZ.replayState(res, st.world, st.game, this.t) : null;

    // HIVE : châssis en A + CELLS
    ctx.fillStyle = COL.hive; ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
    for (const tri of [F.hive.redFrame, F.hive.blueFrame]) {
      ctx.beginPath(); tri.forEach((p, i) => (i ? ctx.lineTo(...P(p[0], p[1])) : ctx.moveTo(...P(p[0], p[1])))); ctx.closePath();
      ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(...P(-12.2, 0)); ctx.lineTo(...P(12.2, 0)); ctx.strokeStyle = '#555'; ctx.lineWidth = Math.max(1, s * 0.8); ctx.stroke();
    for (const col of ['red', 'blue']) {
      const cells = F.hive.cells[col];
      const ours = col === alliance;
      let upIdx = 0, fill = cells.startNectar;
      if (ours && rs) { upIdx = rs.tips % 2; fill = rs.fill; }
      const targets = [cells.up, cells.down];
      targets.forEach((c, i) => {
        const sy = Math.sign(c.y);
        const up = i === upIdx;
        ctx.fillStyle = col === 'red' ? COL.red : COL.blue;
        ctx.globalAlpha = up ? 0.85 : 0.25;
        ctx.fillRect(...rect(c.x - 10, Math.min(sy * 2, sy * 20), c.x + 10, Math.max(sy * 2, sy * 20)));
        ctx.globalAlpha = 1;
        if (up) {
          ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(s * 3.2)}px system-ui`;
          ctx.fillText(`${fill}/${st.game ? st.game.seuilBascule : 6}`, ...P(c.x, sy * 11 - 1.2));
        }
      });
    }

    // FLOWERS
    for (const f of F.flowers) {
      let n = f.pollen;
      const ours = f.alliance === alliance;
      if (ours && rs && st.world) {
        // correspondance flower absolue -> id du monde rouge
        const [rx, ry] = this.abs(f.x, f.y);
        const wf = st.world.flowers.find((w) => Math.abs(w.x - rx) < 1 && Math.abs(w.y - ry) < 1);
        if (wf) n = rs.avail[wf.id];
      }
      ctx.beginPath(); ctx.arc(...P(f.x, f.y), 3.6 * s, 0, 2 * Math.PI);
      ctx.fillStyle = '#e9e6dc'; ctx.fill(); ctx.strokeStyle = '#6b6e76'; ctx.lineWidth = Math.max(1, s * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(...P(f.x, f.y), 1.45 * s, 0, 2 * Math.PI);
      ctx.fillStyle = n > 0 ? COL.pollen : '#bbb'; ctx.fill();
      ctx.fillStyle = '#222'; ctx.font = `700 ${Math.round(s * 2.8)}px system-ui`;
      ctx.fillText(String(n), ...P(f.x + f.nx * 7.5, f.y + f.ny * 7.5 - 1));
    }

    // GARDEN pollen
    const ball = (x, y, r, fill, edge) => {
      ctx.beginPath(); ctx.arc(...P(x, y), r * s, 0, 2 * Math.PI); ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
    };
    for (const col of ['red', 'blue']) {
      let balls = F.gardenBalls[col];
      if (col === alliance && rs) {
        const taken = st.world.garden.balls.length - rs.avail.jardin;
        // on retire les balles les plus proches du coin en premier
        balls = balls.slice().sort((a, b) => Math.abs(b.x) - Math.abs(a.x)).slice(taken);
      }
      for (const b of balls) ball(b.x, b.y, 1.4, COL.pollen, COL.pollenEdge);
    }

    // Chemin prévu
    if (res) {
      ctx.strokeStyle = alliance === 'red' ? 'rgba(160,20,40,0.75)' : 'rgba(20,80,170,0.75)';
      ctx.lineWidth = Math.max(1.5, s * 0.6); ctx.setLineDash([8, 6]);
      ctx.beginPath();
      const p0 = this.abs(res.plan.start.x, res.plan.start.y);
      ctx.moveTo(...P(p0[0], p0[1]));
      for (const p of res.prims) if (p.k === 'move') { const q = this.abs(p.to.x, p.to.y); ctx.lineTo(...P(q[0], q[1])); }
      ctx.stroke(); ctx.setLineDash([]);
      // positions de tir
      for (const sh of res.shots) {
        const [x, y] = this.abs(sh.x, sh.y);
        ctx.beginPath(); ctx.arc(...P(x, y), 2.2 * s, 0, 2 * Math.PI); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      // fantôme de départ
      this.drawRobot(res.plan.start, 0.25, alliance);
    }
    if (st.startPreview) this.drawRobot(st.startPreview.pose, 0.45, alliance, st.startPreview.ok ? null : '#ff6a00');

    // Balles en vol
    if (rs) {
      for (const fl of rs.flying) {
        const [x0, y0] = this.abs(fl.from.x, fl.from.y), [x1, y1] = this.abs(fl.to.x, fl.to.y);
        const u = fl.u;
        ball(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, 1.4 + 1.2 * Math.sin(Math.PI * u), COL.pollen, COL.pollenEdge);
      }
    }
    // Robot
    if (rs && rs.pose) this.drawRobot(rs.pose, 1, alliance, null, rs.held);
  };

  Field2D.prototype.drawRobot = function (pose, alpha, alliance, color, held) {
    const st = this.state || {};
    if (!st.rd) return;
    const ctx = this.ctx, { s } = this.frame();
    const [x, y] = this.abs(pose.x, pose.y), h = this.absH(pose.h);
    const pts = G.rectCorners(x, y, h, st.rd.hl, st.rd.hw).map((p) => this.toScreen(p[0], p[1]));
    ctx.globalAlpha = alpha;
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath();
    ctx.fillStyle = color || (alliance === 'red' ? COL.red : COL.blue); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
    // flèche avant
    const tip = this.toScreen(x + Math.cos(h) * st.rd.hl, y + Math.sin(h) * st.rd.hl);
    const c = this.toScreen(x, y);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, s * 0.8);
    ctx.beginPath(); ctx.moveTo(...c); ctx.lineTo(...tip); ctx.stroke();
    ctx.globalAlpha = 1;
    if (held !== undefined) {
      for (let i = 0; i < held; i++) {
        const bx = x + Math.cos(h + Math.PI) * 3 + Math.cos(h + Math.PI / 2) * (i - (held - 1) / 2) * 3.2;
        const by = y + Math.sin(h + Math.PI) * 3 + Math.sin(h + Math.PI / 2) * (i - (held - 1) / 2) * 3.2;
        ctx.beginPath(); ctx.arc(...this.toScreen(bx, by), 1.4 * s, 0, 2 * Math.PI);
        ctx.fillStyle = COL.pollen; ctx.fill(); ctx.strokeStyle = COL.pollenEdge; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  };

  BZ.Field2D = Field2D;
})(typeof window !== 'undefined' ? window : globalThis);
