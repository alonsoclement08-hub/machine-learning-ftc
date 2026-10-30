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
    this.onPointer = null; // (kind, x, y, rayonPouces, event) -> true si utilisé
    const self = this;
    const ro = new ResizeObserver(() => self.resize());
    ro.observe(canvas);
    canvas.addEventListener('pointerdown', (e) => self.pointer('down', e));
    canvas.addEventListener('pointermove', (e) => self.pointer('move', e));
    canvas.addEventListener('pointerup', (e) => self.pointer('up', e));
    canvas.addEventListener('pointercancel', (e) => self.pointer('up', e));
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
  // `insets` (pixels CSS) : place prise par l'île en haut et la barre en bas, le terrain se cale entre.
  Field2D.prototype.frame = function () {
    const W = this.c.width, H = this.c.height;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const ins = this.insets || { top: 0, bottom: 0 };
    const top = ins.top * dpr, bot = ins.bottom * dpr;
    const span = 2 * FIELD.half + 30;
    const s = Math.min(W, Math.max(10, H - top - bot)) / span;
    return { s, cx: W / 2, cy: top + (H - top - bot) / 2 };
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

  // Les clics sont convertis en coordonnées terrain (repère rouge) et confiés à l'éditeur de plan.
  Field2D.prototype.pointer = function (kind, e) {
    if (!this.onPointer) return;
    const r = this.c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    let [x, y] = this.toField((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    [x, y] = this.abs(x, y); // retour au repère rouge (la rotation de 180° est sa propre inverse)
    const pick = (14 * dpr) / this.frame().s;
    if (kind === 'down') { try { this.c.setPointerCapture(e.pointerId); } catch (err) { /* rien */ } this.c.focus(); }
    const used = this.onPointer(kind, x, y, pick, e);
    if (kind === 'move') this.c.style.cursor = used ? (this.onPointerCursor ? this.onPointerCursor() : 'pointer') : 'default';
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
            ctx.fillText(`${String(hs.weight !== undefined ? hs.weight : hs.fill).replace('.', ',')}/${st.game ? st.game.seuilBascule : 8}`, ...P(o.x, o.y / 2 - 1.2));
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

    // Zones et plan dessinés (sous le robot et les balles)
    if (st.overlay) this.drawOverlay(st.overlay, alliance);

    // Chemin réellement suivi par le robot (simulé)
    if (res) {
      ctx.strokeStyle = alliance === 'red' ? 'rgba(160,20,40,0.55)' : 'rgba(20,80,170,0.55)';
      ctx.lineWidth = Math.max(1, s * 0.35); ctx.setLineDash([5, 5]);
      ctx.beginPath();
      const p0 = this.abs(res.plan.start.x, res.plan.start.y);
      ctx.moveTo(...P(p0[0], p0[1]));
      for (const p of res.prims) if (p.k === 'move') { const q = this.abs(p.to.x, p.to.y); ctx.lineTo(...P(q[0], q[1])); }
      ctx.stroke(); ctx.setLineDash([]);
      // fantôme de départ
      this.drawRobot(res.plan.start, 0.25, alliance);
    }
    const sp = st.overlay && st.overlay.startPreview;
    if (sp) this.drawRobot(sp.pose, 0.85, alliance, sp.errs.length ? '#ff6a00' : null);

    // Balles de la HIVE (dans les CELLS, en vol, au sol), de la plus basse à la plus haute
    const kinds = { pollen: [COL.pollen, COL.pollenEdge], 'nectar-red': [COL.red, '#7a1020'], 'nectar-blue': [COL.blue, '#0d3f7a'] };
    hs.balls.slice().sort((a, b) => a.z - b.z).forEach((b) => {
      const k = kinds[b.kind] || kinds.pollen;
      const r = (b.kind === 'pollen' ? 1.4 : 1.8) * (1 + Math.min(1.2, Math.max(0, b.z - 10) / 60));
      ball(b.x, b.y, r, k[0], b.miss ? '#ff6a00' : k[1]);
    });
    // Robot
    if (rs && rs.pose) this.drawRobot(rs.pose, 1, alliance, null, rs.held);
    else if (!res && st.idlePose && !sp) this.drawRobot(st.idlePose, 1, alliance, null, st.game ? st.game.prechargees : 4);
  };

  // Dessin du plan : zones colorées, flèches (courbes), tirs avec le nombre de balles, ramassages, PARK.
  Field2D.prototype.drawOverlay = function (ov, alliance) {
    const ctx = this.ctx, { s } = this.frame();
    const P = (x, y) => { const a = this.abs(x, y); return this.toScreen(a[0], a[1]); };
    const sel = ov.sel || {}, hov = ov.hover || {};
    const isSel = (t, i, id) => sel.type === t && (id ? sel.id === id : sel.i === i);
    const isHov = (t, i, id) => hov.type === t && (id ? hov.id === id : hov.i === i);
    const font = (px, w) => { ctx.font = `${w || 700} ${Math.max(9, Math.round(px))}px system-ui`; };
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // Zones
    const zones = ov.zones.slice();
    if (ov.draftZone) zones.push(Object.assign({ draft: true, kind: ov.draftKind || 'tir', color: ov.draftColor || '#7a3cff' }, ov.draftZone));
    for (const z of zones) {
      const q = BZ.zoneRect(z);
      const a = P(q.x0, q.y0), b = P(q.x1, q.y1);
      const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      const on = z.id && (isSel('zone', 0, z.id) || isHov('zone', 0, z.id));
      ctx.fillStyle = z.color + (z.kind === 'interdite' ? '30' : '24');
      ctx.fillRect(x0, y0, w, h);
      if (z.kind === 'interdite') {
        ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
        ctx.strokeStyle = z.color + '66'; ctx.lineWidth = 1.5;
        for (let k = -h; k < w; k += 10) { ctx.beginPath(); ctx.moveTo(x0 + k, y0 + h); ctx.lineTo(x0 + k + h, y0); ctx.stroke(); }
        ctx.restore();
      }
      ctx.strokeStyle = z.color; ctx.lineWidth = on ? 3 : 2;
      ctx.setLineDash(z.kind === 'passage' || z.draft ? [6, 4] : []);
      ctx.strokeRect(x0, y0, w, h); ctx.setLineDash([]);
      font(s * 2.1, 700); ctx.fillStyle = z.color; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText((BZ.ZONE_KINDS[z.kind] || {}).nom || '', x0 + 4, y0 + 3);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (z.id && isSel('zone', 0, z.id)) {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = z.color; ctx.lineWidth = 2;
        for (const c of [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]) { ctx.beginPath(); ctx.rect(c[0] - 4, c[1] - 4, 8, 8); ctx.fill(); ctx.stroke(); }
      }
    }

    // Flèches entre les étapes
    const nodes = ov.nodes;
    const mainCol = alliance === 'blue' ? '#0d3f7a' : '#7a1020';
    let num = 0;
    for (const n of nodes) {
      if (!n.from) continue;
      const pts = [];
      for (let k = 0; k <= 24; k++) pts.push(P(...BZ.bezier(n.from, n.ctrl, [n.x, n.y], k / 24)));
      const on = isSel('node', n.i) || isSel('ctrl', n.i);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(4, s * 1.5) + 2;
      ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.stroke();
      ctx.strokeStyle = on ? '#e0a100' : mainCol; ctx.lineWidth = Math.max(2.5, s * 1.0);
      ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.stroke();
      // pointe de flèche (un peu avant le nœud)
      const e1 = pts[21], e0 = pts[19];
      const ang = Math.atan2(e1[1] - e0[1], e1[0] - e0[0]);
      const hd = Math.max(8, s * 3);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.moveTo(e1[0] + Math.cos(ang) * hd * 0.5, e1[1] + Math.sin(ang) * hd * 0.5);
      ctx.lineTo(e1[0] - Math.cos(ang - 0.45) * hd, e1[1] - Math.sin(ang - 0.45) * hd);
      ctx.lineTo(e1[0] - Math.cos(ang + 0.45) * hd, e1[1] - Math.sin(ang + 0.45) * hd);
      ctx.closePath(); ctx.fill();
      // poignée de courbe
      const m = P(...BZ.bezier(n.from, n.ctrl, [n.x, n.y], 0.5));
      const showH = ov.tool === 'select' || on || isHov('ctrl', n.i);
      if (showH) {
        const hs = isHov('ctrl', n.i) || isSel('ctrl', n.i) ? 6 : 4.5;
        ctx.fillStyle = n.ctrl ? '#e0a100' : '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(m[0], m[1] - hs); ctx.lineTo(m[0] + hs, m[1]); ctx.lineTo(m[0], m[1] + hs); ctx.lineTo(m[0] - hs, m[1]); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }

    // Nœuds
    for (const n of nodes) {
      if (n.kind === 'start') {
        if (isSel('start') || isHov('start')) {
          const c0 = P(n.x, n.y);
          ctx.strokeStyle = '#e0a100'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.arc(...c0, (this.state.rd ? this.state.rd.radius : 12) * s + 4, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
        }
        continue;
      }
      num++;
      const c = P(n.x, n.y);
      const on = isSel('node', n.i), hv = isHov('node', n.i);
      const R = Math.max(7, s * 2.4) * (on || hv ? 1.2 : 1);
      if (n.a && n.a.zone) {
        const z = ov.zones.find((q) => q.id === n.a.zone);
        if (z) { const q = BZ.zoneRect(z); const zc = P((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2); ctx.strokeStyle = z.color; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(...c); ctx.lineTo(...zc); ctx.stroke(); ctx.setLineDash([]); }
      }
      if (n.kind === 'tir') {
        const sh = n.shot;
        const pc = !sh || sh.p <= 0 ? '#d7263d' : sh.p >= 0.9 * 0.999 ? '#1f8a4c' : sh.p >= 0.7 ? '#e08a00' : '#d7263d';
        if (sh && sh.cell) {
          const t = P(sh.cell.x, sh.cell.y);
          ctx.strokeStyle = pc; ctx.lineWidth = Math.max(2, s * 0.6); ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.moveTo(...c); ctx.lineTo(...t); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.fillStyle = '#fff'; ctx.strokeStyle = on ? '#e0a100' : '#111'; ctx.lineWidth = on ? 3 : 2;
        ctx.beginPath(); ctx.arc(...c, R, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(...c, R * 0.45, 0, 2 * Math.PI); ctx.fillStyle = pc; ctx.fill();
        // pastille : nombre de balles + précision
        const txt = (n.n ? '×' + n.n : '×tout') + (sh && sh.p > 0 ? ' · ' + Math.round(sh.p * 100) + '%' : ' · ✗');
        font(Math.max(11, s * 2.4), 750);
        const tw = ctx.measureText(txt).width + 12, th = Math.max(16, s * 3.6);
        const bx = c[0] + R + 4, by = c[1] - R - th * 0.6;
        ctx.fillStyle = pc; ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, tw, th, th / 2); else ctx.rect(bx, by, tw, th);
        ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(txt, bx + tw / 2, by + th / 2 + 0.5);
      } else if (n.kind === 'ramasse') {
        ctx.fillStyle = '#f5d300'; ctx.strokeStyle = on ? '#e0a100' : '#111'; ctx.lineWidth = on ? 3 : 2;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(c[0] - R, c[1] - R, 2 * R, 2 * R, 4); else ctx.rect(c[0] - R, c[1] - R, 2 * R, 2 * R);
        ctx.fill(); ctx.stroke();
      } else if (n.kind === 'park') {
        ctx.fillStyle = '#1b6fd1'; ctx.strokeStyle = on ? '#e0a100' : '#111'; ctx.lineWidth = on ? 3 : 2;
        ctx.beginPath(); ctx.arc(...c, R * 1.1, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        font(R * 1.2, 800); ctx.fillStyle = '#fff'; ctx.fillText('P', c[0], c[1] + 0.5);
      } else {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = on ? '#e0a100' : mainCol; ctx.lineWidth = on ? 3 : 2.5;
        ctx.beginPath(); ctx.arc(...c, R * 0.7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      }
      if (n.kind !== 'park') {
        // numéro de l'étape
        font(Math.max(10, s * 2.2), 800);
        const lx = c[0] - R - 2, ly = c[1] + R + 2;
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(lx, ly, Math.max(7, s * 1.9), 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(String(num), lx, ly + 0.5);
        if (n.a && n.a.lock) ctx.fillText('🔒', c[0] + R + 6, c[1] + R + 4);
      }
    }
    ctx.restore();
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
