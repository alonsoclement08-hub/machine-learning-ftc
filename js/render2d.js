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
    if (this.mode === 'start') {
      if (kind === 'down' && this.onPick) this.onPick({ type: 'start', x, y });
      else if (kind === 'move' && this.onHover) this.onHover({ x, y });
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

  // État du robot et des sources à l'instant t pendant le rejeu (la HIVE est gérée par BZ.hiveScene).
  BZ.replayState = function (result, world, game, t) {
    const out = { pose: null, held: game.prechargees, avail: {} };
    out.avail.jardin = world.garden.balls.length;
    for (const f of world.flowers) out.avail[f.id] = f.pollen;
    if (!result) return out;
    out.pose = BZ.poseAt(result.prims, result.plan.start, t);
    for (const e of result.events) {
      if (e.type === 'pickup' && e.t <= t) { out.avail[e.src] -= e.n; out.held += e.n; }
    }
    for (const s of result.shots) if (s.t <= t) out.held -= 1;
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

    // HIVE : châssis en A + CELLS (la CELL du haut est foncée, avec une flèche vers son ouverture)
    const hs = BZ.hiveScene(F, Object.assign({}, st, { outcomes: st.outcomes }), this.t);
    ctx.fillStyle = COL.hive; ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
    for (const tri of [F.hive.redFrame, F.hive.blueFrame]) {
      ctx.beginPath(); tri.forEach((p, i) => (i ? ctx.lineTo(...P(p[0], p[1])) : ctx.moveTo(...P(p[0], p[1])))); ctx.closePath();
      ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(...P(-12.2, 0)); ctx.lineTo(...P(12.2, 0)); ctx.strokeStyle = '#555'; ctx.lineWidth = Math.max(1, s * 0.8); ctx.stroke();
    for (const col of ['red', 'blue']) {
      const cells = F.hive.cells[col];
      const tipA = (F.hive.tipAngle && F.hive.tipAngle[col]) || 1;
      const frac = Math.max(0, Math.min(1, hs.angle[col] / tipA)); // 0 = état de départ, 1 = basculée
      cells.states.forEach((cs, i) => {
        const o = cs.open, sy = Math.sign(o.y);
        const upness = i === 0 ? 1 - frac : frac;
        ctx.fillStyle = col === 'red' ? COL.red : COL.blue;
        ctx.globalAlpha = 0.22 + 0.63 * upness;
        // emprise de la CELL vue de dessus : du pivot jusqu'à l'ouverture
        ctx.fillRect(...rect(o.x - 10, Math.min(sy * 2, o.y + sy * 2), o.x + 10, Math.max(sy * 2, o.y + sy * 2)));
        ctx.globalAlpha = 1;
        if (upness > 0.5) {
          // flèche : côté de l'ouverture (on ne marque qu'en tirant de ce côté)
          const n = cs.normal;
          const a0 = P(o.x, o.y + n[1] * 3), a1 = P(o.x, o.y + n[1] * 11);
          ctx.strokeStyle = col === 'red' ? COL.red : COL.blue; ctx.lineWidth = Math.max(2, s * 0.9);
          ctx.beginPath(); ctx.moveTo(...a1); ctx.lineTo(...a0); ctx.stroke();
          const hd = 2.4 * s;
          ctx.beginPath(); ctx.moveTo(...a0);
          ctx.lineTo(a0[0] - hd * 0.6, a0[1] + Math.sign(a1[1] - a0[1]) * hd);
          ctx.lineTo(a0[0] + hd * 0.6, a0[1] + Math.sign(a1[1] - a0[1]) * hd);
          ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
          if (col === alliance) {
            ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(s * 3.2)}px system-ui`;
            ctx.fillText(`${hs.fill}/${st.game ? st.game.seuilBascule : 6}`, ...P(o.x, o.y / 2 - 1.2));
          }
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
    if (st.startPreview) this.drawRobot(st.startPreview.pose, 0.85, alliance, st.startPreview.ok ? null : '#ff6a00');

    // Balles de la HIVE (dans les CELLS, en vol, au sol), de la plus basse à la plus haute
    const kinds = { pollen: [COL.pollen, COL.pollenEdge], 'nectar-red': [COL.red, '#7a1020'], 'nectar-blue': [COL.blue, '#0d3f7a'] };
    hs.balls.slice().sort((a, b) => a.z - b.z).forEach((b) => {
      const k = kinds[b.kind] || kinds.pollen;
      const r = (b.kind === 'pollen' ? 1.4 : 1.8) * (1 + Math.min(1.2, Math.max(0, b.z - 10) / 60));
      ball(b.x, b.y, r, k[0], b.miss ? '#ff6a00' : k[1]);
    });
    // Robot
    if (rs && rs.pose) this.drawRobot(rs.pose, 1, alliance, null, rs.held);
    else if (!res && st.idlePose && !st.startPreview) this.drawRobot(st.idlePose, 1, alliance, null, st.game ? st.game.prechargees : 4);
  };

  Field2D.prototype.drawRobot = function (pose, alpha, alliance, color, held) {
    const st = this.state || {};
    if (!st.rd) return;
    const ctx = this.ctx, { s } = this.frame();
    const [x, y] = this.abs(pose.x, pose.y), h = this.absH(pose.h);
    const pts = G.rectCorners(x, y, h, st.rd.hl, st.rd.hw).map((p) => this.toScreen(p[0], p[1]));
    ctx.globalAlpha = alpha;
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath();
    const top = st.robotTop;
    if (top) {
      // silhouette du vrai modèle 3D, vue de dessus
      const c0 = this.toScreen(x, y);
      ctx.save();
      ctx.translate(c0[0], c0[1]);
      ctx.rotate(-h);
      ctx.drawImage(top.canvas, -top.lengthIn / 2 * s, -top.widthIn / 2 * s, top.lengthIn * s, top.widthIn * s);
      ctx.restore();
      ctx.strokeStyle = color || (alliance === 'red' ? COL.red : COL.blue); ctx.lineWidth = Math.max(1.5, s * 0.5);
      ctx.stroke();
    } else {
      ctx.fillStyle = color || (alliance === 'red' ? COL.red : COL.blue); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (color) { ctx.fillStyle = color; ctx.globalAlpha = alpha * 0.45; ctx.fill(); ctx.globalAlpha = alpha; }
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
