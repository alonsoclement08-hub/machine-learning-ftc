// Éditeur de plan : on dessine l'AUTO sur le terrain (flèches courbables, tirs, ramassages, zones,
// PARK, départ). Les coordonnées sont celles du simulateur (repère rouge, pouces) ; les vues 2D et
// 3D convertissent les clics et dessinent `editor.overlay()`.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};
  const G = BZ.G;

  BZ.ZONE_COLORS = ['#7a3cff', '#00a6a6', '#ff6a00', '#e0217c', '#2d9c3c', '#3a6df0'];
  BZ.ZONE_KINDS = {
    tir: { nom: 'Zone de tir', aide: "l'IA choisit le point de tir dans la zone" },
    passage: { nom: 'Zone de passage', aide: "l'IA garde le point de passage dans la zone" },
    interdite: { nom: 'Zone interdite', aide: 'le robot ne doit pas y entrer (partenaire…)' },
  };

  // Point d'une Bézier quadratique (sans point de contrôle : segment droit).
  BZ.bezier = function (a, c, b, u) {
    if (!c) return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    const v = 1 - u;
    return [v * v * a[0] + 2 * u * v * c[0] + u * u * b[0], v * v * a[1] + 2 * u * v * c[1] + u * u * b[1]];
  };

  // CELL visée depuis un point de tir et probabilité de marquer.
  BZ.shotInfo = function (world, robot, x, y) {
    let cellIdx = -1, p = 0;
    world.cellTargets.forEach((c, i) => {
      const q = BZ.hitProb(world, robot, x, y, Math.atan2(c.y - y, c.x - x), c);
      if (q > p) { p = q; cellIdx = i; }
    });
    return { cellIdx, p, cell: cellIdx >= 0 ? world.cellTargets[cellIdx] : null };
  };

  BZ.zoneRect = (z) => ({ x0: Math.min(z.x0, z.x1), y0: Math.min(z.y0, z.y1), x1: Math.max(z.x0, z.x1), y1: Math.max(z.y0, z.y1) });

  // Géométrie du plan (ce qu'on dessine) : départ, puis un nœud par étape et le PARK.
  BZ.planNodes = function (world, plan) {
    const nodes = [];
    if (!plan || !plan.start) return nodes;
    let prev = [plan.start.x, plan.start.y];
    nodes.push({ kind: 'start', x: plan.start.x, y: plan.start.y, h: plan.start.h });
    (plan.actions || []).forEach((a, i) => {
      let x, y;
      if (a.type === 'ramasse') {
        const p = BZ.pickupPose(world, a.src);
        if (!p) return;
        x = p.x; y = p.y;
      } else { x = a.x; y = a.y; }
      nodes.push({ kind: a.type, i, x, y, from: prev, ctrl: a.ctrl || null, a });
      prev = [x, y];
    });
    if (plan.park && plan.park.on) {
      const p = BZ.parkPose(world, plan.park.t, 0);
      nodes.push({ kind: 'park', i: 'park', x: p.x, y: p.y, from: prev, ctrl: plan.park.ctrl || null });
    }
    return nodes;
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  let zoneSeq = 1;

  // app : { world(), robot(), game(), plan(), apply(plan, zones, {transient}), snapStart(x, y, deg) -> {pose, errs}, changed() }
  function PlanEditor(app) {
    this.app = app;
    this.tool = 'select';
    this.tirN = 0; // 0 = toutes les balles
    this.zoneKind = 'tir';
    this.zoneColor = BZ.ZONE_COLORS[0];
    this.sel = null; // {type:'node', i} | {type:'ctrl', i} | {type:'zone', id} | {type:'start'}
    this.hover = null;
    this.drag = null;
    this.draftZone = null;
    this.startDeg = 0;
    this.startPreview = null;
    this.undoStack = [];
    this.redoStack = [];
  }

  PlanEditor.prototype.snapshot = function () {
    return { plan: clone(this.app.plan()), zones: clone(this.app.game().zones || []) };
  };
  // Enregistre l'état actuel pour « Annuler », puis applique la modification.
  PlanEditor.prototype.commit = function (mutate) {
    const before = this.snapshot();
    const plan = clone(this.app.plan());
    const zones = clone(this.app.game().zones || []);
    if (mutate(plan, zones) === false) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.app.apply(plan, zones, {});
  };
  PlanEditor.prototype.undo = function () {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.sel = null;
    this.app.apply(s.plan, s.zones, {});
  };
  PlanEditor.prototype.redo = function () {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.sel = null;
    this.app.apply(s.plan, s.zones, {});
  };

  PlanEditor.prototype.setTool = function (t) {
    this.tool = t;
    this.draftZone = null;
    this.startPreview = null;
    if (t === 'start') this.startDeg = Math.round(G.deg(this.app.plan().start ? this.app.plan().start.h : 0));
    this.app.changed();
  };

  // Où insérer une nouvelle étape : après l'étape sélectionnée, sinon à la fin.
  PlanEditor.prototype.insertIndex = function (plan) {
    if (this.sel && this.sel.type === 'node' && typeof this.sel.i === 'number') return this.sel.i + 1;
    return plan.actions.length;
  };

  // Objet sous le pointeur (r = rayon de prise en pouces).
  PlanEditor.prototype.hit = function (x, y, r) {
    const world = this.app.world(), plan = this.app.plan();
    const nodes = BZ.planNodes(world, plan);
    // poignées de courbe (milieu de chaque flèche)
    for (const n of nodes) {
      if (!n.from) continue;
      const m = BZ.bezier(n.from, n.ctrl, [n.x, n.y], 0.5);
      if (G.dist(x, y, m[0], m[1]) <= r * 0.9) return { type: 'ctrl', i: n.i, node: n };
    }
    let best = null, bd = r;
    for (const n of nodes) {
      const d = G.dist(x, y, n.x, n.y);
      if (n.kind === 'start') { if (d <= Math.max(r, world.rd.hw) && d < bd + 4) { if (!best || d < bd) { best = { type: 'start' }; bd = d; } } continue; }
      if (d <= bd) { best = { type: 'node', i: n.i, node: n }; bd = d; }
    }
    if (best) return best;
    // zones : coins puis intérieur (la plus récente au-dessus)
    const zones = (this.app.game().zones || []).slice().reverse();
    for (const z of zones) {
      const q = BZ.zoneRect(z);
      const corners = [[q.x0, q.y0], [q.x1, q.y0], [q.x1, q.y1], [q.x0, q.y1]];
      for (let k = 0; k < 4; k++) if (G.dist(x, y, corners[k][0], corners[k][1]) <= r * 0.8) return { type: 'zone', id: z.id, corner: k };
    }
    for (const z of zones) {
      const q = BZ.zoneRect(z);
      if (x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1) return { type: 'zone', id: z.id };
    }
    return null;
  };

  // Source de balles près d'un point (FLOWER ou GARDEN).
  PlanEditor.prototype.sourceAt = function (x, y) {
    const world = this.app.world();
    let best = null, bd = 16;
    for (const f of world.flowers) {
      const d = Math.min(G.dist(x, y, f.x, f.y), G.dist(x, y, f.frontX, f.frontY));
      if (d < bd) { bd = d; best = f.id; }
    }
    const g = world.garden;
    for (const b of g.balls) { const d = G.dist(x, y, b.x, b.y); if (d < bd) { bd = d; best = 'jardin'; } }
    const p = BZ.pickupPose(world, 'jardin');
    if (p && G.dist(x, y, p.x, p.y) < bd) best = 'jardin';
    return best;
  };

  PlanEditor.prototype.pointer = function (kind, x, y, r, ev) {
    const app = this.app, world = app.world();
    const tool = this.tool;
    if (tool === 'orbit') return false;
    if (kind === 'move' && !this.drag) {
      if (tool === 'start') {
        const s = app.snapStart(x, y, this.startDeg);
        this.startPreview = s;
        app.changed(true);
        return true;
      }
      const h = this.hit(x, y, r);
      const key = h ? h.type + (h.i !== undefined ? h.i : '') + (h.id || '') : null;
      if (key !== this.hoverKey) { this.hoverKey = key; this.hover = h; app.changed(true); }
      return !!h;
    }
    if (kind === 'down') {
      if (tool === 'select') {
        const h = this.hit(x, y, r);
        this.sel = h ? { type: h.type, i: h.i, id: h.id } : null;
        if (h) {
          this.drag = { h, x0: x, y0: y, before: this.snapshot(), moved: false };
          if (h.type === 'zone') {
            const z = (app.game().zones || []).find((q) => q.id === h.id);
            this.drag.z0 = z ? clone(z) : null;
          }
        }
        app.changed();
        return true;
      }
      if (tool === 'via' || tool === 'tir') {
        this.commit((plan) => {
          const a = tool === 'via' ? { type: 'via', x, y } : { type: 'tir', x, y };
          if (tool === 'tir' && this.tirN) a.n = this.tirN;
          const k = this.insertIndex(plan);
          plan.actions.splice(k, 0, a);
          this.sel = { type: 'node', i: k };
        });
        return true;
      }
      if (tool === 'ramasse') {
        const src = this.sourceAt(x, y);
        if (!src) { app.toast('Cliquez sur une FLOWER ou sur le GARDEN de votre côté.'); return true; }
        this.commit((plan) => {
          const k = this.insertIndex(plan);
          plan.actions.splice(k, 0, { type: 'ramasse', src });
          this.sel = { type: 'node', i: k };
        });
        return true;
      }
      if (tool === 'park') {
        const z = world.loading;
        this.commit((plan) => {
          plan.park = Object.assign({}, plan.park || {}, { on: true, t: Math.max(0, Math.min(1, (y - z.y0) / (z.y1 - z.y0))) });
          this.sel = { type: 'node', i: 'park' };
        });
        return true;
      }
      if (tool === 'start') {
        const s = app.snapStart(x, y, this.startDeg);
        if (s.errs.length) { app.toast('Départ interdit (G304) : ' + s.errs.join(' ; ')); return true; }
        this.commit((plan) => { plan.start = s.pose; plan.startLock = true; });
        this.startPreview = null;
        return true;
      }
      if (tool === 'zone') {
        this.draftZone = { x0: x, y0: y, x1: x, y1: y };
        this.drag = { zoneDraft: true };
        return true;
      }
      return false;
    }
    if (kind === 'move' && this.drag) {
      if (this.drag.zoneDraft) { this.draftZone.x1 = x; this.draftZone.y1 = y; app.changed(true); return true; }
      const d = this.drag, h = d.h;
      if (!d.moved && G.dist(x, y, d.x0, d.y0) < r * 0.3) return true;
      d.moved = true;
      const plan = clone(app.plan());
      const zones = clone(app.game().zones || []);
      if (h.type === 'node') {
        if (h.i === 'park') {
          const z = world.loading;
          plan.park.t = Math.max(0, Math.min(1, (y - z.y0) / (z.y1 - z.y0)));
        } else {
          const a = plan.actions[h.i];
          if (a.type === 'ramasse') {
            const src = this.sourceAt(x, y);
            if (src) a.src = src;
          } else { a.x = x; a.y = y; }
        }
      } else if (h.type === 'ctrl') {
        const n = h.node;
        const c = [2 * x - 0.5 * (n.from[0] + n.x), 2 * y - 0.5 * (n.from[1] + n.y)];
        if (h.i === 'park') plan.park.ctrl = c; else plan.actions[h.i].ctrl = c;
      } else if (h.type === 'zone' && d.z0) {
        const z = zones.find((q) => q.id === h.id);
        if (z) {
          if (h.corner === undefined) {
            const dx = x - d.x0, dy = y - d.y0;
            z.x0 = d.z0.x0 + dx; z.x1 = d.z0.x1 + dx; z.y0 = d.z0.y0 + dy; z.y1 = d.z0.y1 + dy;
          } else {
            const q = BZ.zoneRect(d.z0);
            const c = [[q.x1, q.y1], [q.x0, q.y1], [q.x0, q.y0], [q.x1, q.y0]][h.corner]; // coin opposé fixe
            Object.assign(z, { x0: c[0], y0: c[1], x1: x, y1: y });
          }
        }
      } else if (h.type === 'start') {
        const s = app.snapStart(x, y, Math.round(G.deg(plan.start.h)));
        if (!s.errs.length) { plan.start = s.pose; plan.startLock = true; }
      }
      app.apply(plan, zones, { transient: true });
      return true;
    }
    if (kind === 'up' && this.drag) {
      const d = this.drag;
      this.drag = null;
      if (d.zoneDraft) {
        const z = BZ.zoneRect(this.draftZone);
        this.draftZone = null;
        if (z.x1 - z.x0 < 3 || z.y1 - z.y0 < 3) { app.changed(); return true; }
        const id = 'z' + Date.now().toString(36) + (zoneSeq++);
        this.commit((plan, zones) => {
          zones.push(Object.assign({ id, kind: this.zoneKind, color: this.zoneColor }, z));
          // une zone de tir / de passage se rattache à l'étape sélectionnée du bon type
          const s = this.sel;
          if (s && s.type === 'node' && typeof s.i === 'number') {
            const a = plan.actions[s.i];
            if (a && ((this.zoneKind === 'tir' && a.type === 'tir') || (this.zoneKind === 'passage' && a.type === 'via'))) a.zone = id;
          }
          this.sel = { type: 'zone', id };
        });
        return true;
      }
      if (d.moved) {
        this.undoStack.push(d.before);
        this.redoStack = [];
        app.apply(app.plan(), app.game().zones || [], {});
      }
      return true;
    }
    return false;
  };

  PlanEditor.prototype.deleteSel = function () {
    const s = this.sel;
    if (!s) return;
    this.commit((plan, zones) => {
      if (s.type === 'node') {
        if (s.i === 'park') plan.park = Object.assign({}, plan.park, { on: false });
        else plan.actions.splice(s.i, 1);
      } else if (s.type === 'ctrl') {
        if (s.i === 'park') delete plan.park.ctrl; else delete plan.actions[s.i].ctrl;
      } else if (s.type === 'zone') {
        const k = zones.findIndex((z) => z.id === s.id);
        if (k >= 0) zones.splice(k, 1);
        for (const a of plan.actions) if (a.zone === s.id) delete a.zone;
      } else if (s.type === 'start') {
        plan.startLock = false;
      } else return false;
    });
    this.sel = null;
    this.app.changed();
  };

  PlanEditor.prototype.rotateStart = function (d) {
    this.startDeg = ((this.startDeg + d) % 360 + 540) % 360 - 180;
    const plan = this.app.plan();
    if (this.tool === 'start' && this.startPreview) {
      const p = this.startPreview.pose;
      this.startPreview = this.app.snapStart(p.x, p.y, this.startDeg);
      this.app.changed(true);
    } else if (plan.start) {
      const s = this.app.snapStart(plan.start.x, plan.start.y, this.startDeg);
      if (s.errs.length) { this.app.toast('Impossible de tourner ici (G304) : ' + s.errs.join(' ; ')); return; }
      this.commit((pl) => { pl.start = s.pose; pl.startLock = true; });
    }
  };

  PlanEditor.prototype.key = function (e) {
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { if (e.shiftKey) this.redo(); else this.undo(); return true; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'Y')) { this.redo(); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (k === 'Delete' || k === 'Backspace') { this.deleteSel(); return true; }
    if (k === 'Escape') { this.sel = null; this.app.setTool('select'); return true; }
    if (this.tool === 'start' || (this.sel && this.sel.type === 'start')) {
      if (k === 'r' || k === 'R' || k === 'e' || k === 'E') { this.rotateStart(-90); return true; }
      if (k === 'q' || k === 'Q') { this.rotateStart(90); return true; }
    }
    const map = { v: 'select', a: 'via', t: 'tir', p: 'ramasse', z: 'zone', d: 'start' };
    if (map[k.toLowerCase()]) { this.app.setTool(map[k.toLowerCase()]); return true; }
    return false;
  };

  // Ce que les vues doivent dessiner.
  PlanEditor.prototype.overlay = function (planOverride) {
    const world = this.app.world(), robot = this.app.robot(), plan = planOverride || this.app.plan();
    const nodes = BZ.planNodes(world, plan);
    for (const n of nodes) {
      if (n.kind === 'tir') {
        n.shot = BZ.shotInfo(world, robot, n.x, n.y);
        n.n = n.a.n || 0;
      }
    }
    return {
      nodes, zones: this.app.game().zones || [], sel: this.sel, hover: this.hover, tool: this.tool,
      draftZone: this.draftZone, draftKind: this.zoneKind, draftColor: this.zoneColor, startPreview: this.tool === 'start' ? this.startPreview : null,
      startLock: !!plan.startLock,
    };
  };

  BZ.PlanEditor = PlanEditor;
})(typeof window !== 'undefined' ? window : globalThis);
