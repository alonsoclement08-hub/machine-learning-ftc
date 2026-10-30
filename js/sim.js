// Simulateur de l'AUTO : exécute un plan d'actions de haut niveau, le traduit en mouvements
// chronométrés (les mêmes que dans le code exporté), vérifie les règles et calcule le score espéré.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};
  const G = BZ.G;

  const DEG = Math.PI / 180;

  // Position d'arrêt devant une source de balles (intake tourné vers la source).
  BZ.pickupPose = function (world, src) {
    const rd = world.rd;
    if (src === 'jardin') {
      const g = world.garden;
      if (!g.balls.length) return null;
      const ny = g.wallNy; // normale vers l'intérieur
      const ballEdge = g.balls[0].y + ny * 1.4;
      const xs = g.balls.map((b) => b.x);
      let cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      cx = Math.max(cx, -world.half + rd.hw + 0.5);
      const facing = Math.atan2(-ny, 0);
      const h = G.wrap(facing - rd.intakeSens);
      return { x: cx, y: ballEdge + ny * (rd.approche + rd.hl), h, dir: [0, -ny], push: rd.approche + 1.0, allow: [],
        reach: (x) => g.balls.filter((b) => Math.abs(b.x - x) <= rd.hw).length };
    }
    if (src === 'nectar') {
      // NECTAR posé par le joueur humain au milieu de la LOADING ZONE (G427.C) : on y va face au mur
      const z = world.loading;
      const cx = (z.x0 + z.x1) / 2, cy = (z.y0 + z.y1) / 2;
      const h = G.wrap(Math.PI - rd.intakeSens);
      return { x: cx + 1.8 + rd.approche + rd.hl, y: cy, h, dir: [-1, 0], push: rd.approche + 1.0, allow: [], reach: () => 1 };
    }
    const f = world.flowers.find((ff) => ff.id === src);
    if (!f) return null;
    const facing = Math.atan2(-f.ny, -f.nx);
    const h = G.wrap(facing - rd.intakeSens);
    return { x: f.frontX + f.nx * (rd.approche + rd.hl), y: f.frontY + f.ny * (rd.approche + rd.hl), h,
      dir: [-f.nx, -f.ny], push: rd.approche + 0.5, allow: [f.id], reach: () => 4 };
  };

  BZ.parkPose = function (world, t, h) {
    const rd = world.rd, z = world.loading;
    const hh = Math.round(h / (Math.PI / 2)) * (Math.PI / 2);
    const ex = Math.abs(Math.cos(hh)) > 0.5 ? rd.hl : rd.hw;
    const ey = Math.abs(Math.cos(hh)) > 0.5 ? rd.hw : rd.hl;
    const x = z.x1 + ex - 3; // 3 in dans la zone, sans toucher le mur
    const y = Math.max(z.y0 + 1 - ey + 3, Math.min(z.y1 - 1 + ey - 3, z.y0 + t * (z.y1 - z.y0)));
    return { x, y, h: G.wrap(hh) };
  };

  // Probabilité qu'une balle tirée depuis (x, y) dans la direction `aim` entre dans la CELL `cell`.
  // Durée de vol d'une balle (s) : la balle compte quand elle arrive dans la CELL.
  BZ.FLIGHT = 0.55;
  // Angle max entre la direction CELL -> tireur et la normale de l'ouverture : la CELL est
  // fermée sur le dessus et l'arrière, on ne peut marquer que par l'ouverture (côté avant).
  BZ.OPEN_HALF_ANGLE = (65 * Math.PI) / 180;

  BZ.hitProb = function (world, robot, x, y, aim, cell) {
    const rd = world.rd;
    const d = G.dist(x, y, cell.x, cell.y);
    if (d < rd.tirMin || d > rd.tirMax) return 0;
    const a = Math.atan2(cell.y - y, cell.x - x);
    const tolA = Math.atan2(7, d); // ouverture utile de la CELL ~ 20 in de large
    if (Math.abs(G.wrap(a - aim)) > tolA) return 0;
    // La précision est maximale à la distance idéale et bien en face de l'ouverture.
    let fa = 1;
    if (cell.normal) {
      const back = Math.atan2(y - cell.y, x - cell.x); // direction CELL -> tireur
      const n = Math.atan2(cell.normal[1], cell.normal[0]);
      const off = Math.abs(G.wrap(back - n));
      if (off > BZ.OPEN_HALF_ANGLE) return 0; // derrière la CELL : la balle tape le dessus
      // zone sûre : jusqu'à 30° de l'axe de l'ouverture, précision pleine ; au-delà elle baisse
      const safe = (30 * Math.PI) / 180;
      fa = off <= safe ? 1 : 1 - 0.3 * Math.pow((off - safe) / (BZ.OPEN_HALF_ANGLE - safe), 2);
    }
    const ideal = rd.tirIdeal || (rd.tirMin + rd.tirMax) / 2;
    const span = d <= ideal ? Math.max(1, ideal - rd.tirMin) : Math.max(1, rd.tirMax - ideal);
    // zone sûre : à ±35 % de la distance idéale, précision pleine ; au-delà elle baisse
    const dz = Math.max(0, Math.abs(d - ideal) / span - 0.35) / 0.65;
    const fd = 1 - 0.25 * dz * dz;
    return Math.max(0, Math.min(1, robot.lanceur.precision * fa * fd));
  };

  // Déroulé d'un match pour l'animation : pour chaque tir, la balle entre-t-elle, dans quelle CELL,
  // et à quel moment la HIVE bascule. rng = null : scénario nominal (chaque tir possible réussit).
  BZ.shotOutcomes = function (result, world, robot, game, rng) {
    const out = { shots: [], tips: [] };
    if (!result) return out;
    let nN = world.startNectar, nP = 0, tips = 0;
    for (const s of result.shots) {
      if (s.t > game.dureeAuto) break;
      const cellIdx = tips % 2;
      const p = BZ.hitProb(world, robot, s.x, s.y, s.aim, world.cellTargets[cellIdx]);
      const hit = rng ? rng() < p : p > 0;
      const tArr = s.t + BZ.FLIGHT;
      out.shots.push(Object.assign({}, s, { hit, cellIdx, tArr, slot: hit ? nN + nP : -1 }));
      if (hit) {
        if (s.kind === 'nectar') nN++; else nP++;
        if (BZ.cellTips(game, nN, nP)) { nN = 0; nP = 0; tips++; out.tips.push(tArr); }
      }
    }
    return out;
  };

  function Sim(world, planner, robot, game) {
    this.world = world; this.planner = planner; this.robot = robot; this.game = game; this.rd = world.rd;
  }

  Sim.prototype.run = function (plan) {
    const world = this.world, rd = this.rd, robot = this.robot, game = this.game;
    const st = {
      x: plan.start.x, y: plan.start.y, h: plan.start.h, t: 0,
      held: Math.min(4, game.prechargees), heldN: 0, cellN: world.startNectar, cellP: 0, tipsBelief: 0,
      nectarQueue: [], nectarLeft: game.nectarHumain ? (game.nectarReserve === undefined ? 5 : game.nectarReserve) : 0,
      avail: { jardin: world.garden.balls.length }, prims: [], faults: {}, shots: [], events: [], moved: false,
      launcherOn: false,
    };
    for (const f of world.flowers) st.avail[f.id] = f.pollen;

    const fault = (rule, info) => {
      if (!st.faults[rule]) st.faults[rule] = { rule, t: st.t, info: info || '' };
    };
    const startErr = BZ.checkStart(world, plan.start);
    if (startErr.length) fault('G304', startErr.join(' ; '));

    const self = this;
    const odo = !!rd.odo;
    const pause = odo ? 0 : rd.pause; // odométrie : pas d'arrêt entre deux mouvements
    const pushPrim = (p) => { p.t0 = st.t; st.t += p.dur || 0; p.t1 = st.t; st.prims.push(p); };

    const checkAt = (x, y, h, allow) => {
      for (const r of BZ.checkPose(world, x, y, h, allow)) fault(r, `x=${x.toFixed(0)} y=${y.toFixed(0)}`);
    };

    const turnTo = (hTarget, allow, label) => {
      const d = G.wrap(hTarget - st.h);
      if (Math.abs(d) < 0.5 * DEG) { st.h = hTarget; return; }
      const n = Math.ceil(Math.abs(d) / (3 * DEG));
      for (let i = 1; i <= n; i++) checkAt(st.x, st.y, st.h + (d * i) / n, allow);
      const from = { x: st.x, y: st.y, h: st.h };
      st.h = G.wrap(st.h + d);
      pushPrim({ k: 'turn', deg: d / DEG, dur: pause + Math.abs(d) / rd.wRot, from, to: { x: st.x, y: st.y, h: st.h }, label });
      st.moved = true;
    };

    const moveTo = (x, y, allow, label) => {
      const dx = x - st.x, dy = y - st.y, L = Math.hypot(dx, dy);
      if (L < 0.5) return;
      if (robot.chassis === 'tank') {
        const a = Math.atan2(dy, dx);
        const fwd = Math.abs(G.wrap(a - st.h)) <= Math.abs(G.wrap(a + Math.PI - st.h));
        turnTo(fwd ? a : G.wrap(a + Math.PI), allow, label);
      }
      const c = Math.cos(st.h), s = Math.sin(st.h);
      const f = dx * c + dy * s, sl = -dx * s + dy * c; // avant, crabe à gauche
      const n = Math.ceil(L / 1.0);
      for (let i = 1; i <= n; i++) checkAt(st.x + (dx * i) / n, st.y + (dy * i) / n, st.h, allow);
      const from = { x: st.x, y: st.y, h: st.h };
      st.x = x; st.y = y;
      const dur = pause + Math.max(Math.abs(f) / rd.vAvant, Math.abs(sl) / rd.vCrabe);
      pushPrim({ k: 'move', f, s: robot.chassis === 'tank' ? 0 : sl, dur, from, to: { x, y, h: st.h }, label });
      st.moved = true;
    };

    // Point dégagé (où le robot peut tourner sur place) atteint en ligne droite depuis (x, y)
    // en suivant le cap h (ou à reculons ; en crabe aussi pour un mecanum).
    const freeAlong = (x, y, h) => {
      const dirs = [h, h + Math.PI];
      if (robot.chassis !== 'tank') for (let k = 1; k < 16; k++) if (k !== 8) dirs.push(h + (k * Math.PI) / 8);
      for (let d = 1; d <= 40; d += 1) {
        for (const a of dirs) {
          const px = x + d * Math.cos(a), py = y + d * Math.sin(a);
          if (self.planner.isFree(px, py)) return [px, py];
        }
      }
      return null;
    };

    // --- Vérifications "à blanc" (sans rien enregistrer) pour choisir la manœuvre la plus rapide.
    const poseOk = (x, y, h) => BZ.checkPose(world, x, y, h, null).length === 0;
    const turnOk = (x, y, h0, h1) => {
      const d = G.wrap(h1 - h0);
      const n = Math.ceil(Math.abs(d) / (3 * DEG));
      for (let i = 1; i <= n; i++) if (!poseOk(x, y, h0 + (d * i) / n)) return false;
      return true;
    };
    const lineOk = (x0, y0, x1, y1, h) => {
      const n = Math.ceil(G.dist(x0, y0, x1, y1) / 1.0);
      for (let i = 1; i <= n; i++) if (!poseOk(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, h)) return false;
      return true;
    };
    const turnTime = (h0, h1) => {
      const d = Math.abs(G.wrap(h1 - h0));
      return d < 0.5 * DEG ? 0 : pause + d / rd.wRot;
    };
    const moveTime = (x0, y0, x1, y1, h) => {
      const dx = x1 - x0, dy = y1 - y0;
      if (Math.hypot(dx, dy) < 0.5) return 0;
      const c = Math.cos(h), s = Math.sin(h);
      const f = dx * c + dy * s, sl = -dx * s + dy * c;
      return pause + Math.max(Math.abs(f) / rd.vAvant, Math.abs(sl) / rd.vCrabe);
    };

    // Manœuvre directe (sans contourner d'obstacle) la plus rapide pour aller en (x, y, hFinal) :
    // - mecanum : on choisit le cap pendant le trajet (cap actuel, cap final, ou dans l'axe du
    //   trajet, en avant ou à reculons) : tourner plus pour rouler en avant peut être plus rapide
    //   qu'avancer en crabe ;
    // - tank : on tourne vers la cible (en avant ou à reculons), on roule, on tourne au cap final.
    // Renvoie null si aucune manœuvre directe n'est possible sans toucher un obstacle.
    const directPlan = (x, y, hFinal) => {
      const L = G.dist(st.x, st.y, x, y);
      let best = null;
      const consider = (hv) => {
        const t = turnTime(st.h, hv) + moveTime(st.x, st.y, x, y, hv) + turnTime(hv, hFinal);
        if (best && t >= best.t) return;
        if (!turnOk(st.x, st.y, st.h, hv)) return;
        if (L >= 0.5 && !lineOk(st.x, st.y, x, y, hv)) return;
        if (!turnOk(x, y, hv, hFinal)) return;
        best = { hv, t };
      };
      const a = Math.atan2(y - st.y, x - st.x);
      if (robot.chassis === 'tank') {
        if (L < 0.5) consider(st.h);
        else { consider(a); consider(G.wrap(a + Math.PI)); }
      } else {
        consider(st.h); consider(hFinal);
        if (L >= 0.5) { consider(a); consider(G.wrap(a + Math.PI)); }
      }
      return best;
    };

    // Raccourcit un chemin du planificateur : un point intermédiaire est retiré si la ligne droite
    // entre ses voisins est libre pour le vrai rectangle du robot (le planificateur, lui, utilise un
    // disque, plus prudent) : moins de segments = moins de pauses.
    const shortcut = (pts, h) => {
      const out = [pts[0]];
      let i = 0;
      while (i < pts.length - 1) {
        let j = pts.length - 1;
        while (j > i + 1 && !lineOk(pts[i][0], pts[i][1], pts[j][0], pts[j][1], h)) j--;
        out.push(pts[j]);
        i = j;
      }
      return out;
    };

    // Va en (x, y) puis s'oriente vers `hFinal`. Les poses collées à un mur ou à une FLOWER sont
    // quittées / rejointes en ligne droite dans l'axe du robot, sans tourner contre l'obstacle.
    const goTo = (x, y, hFinal, label, allowEnd) => {
      const d = directPlan(x, y, hFinal);
      if (d) {
        if (robot.chassis === 'tank') moveTo(x, y, null, label);
        else { turnTo(d.hv, null, label); moveTo(x, y, null, label); }
        turnTo(hFinal, null, label);
        return true;
      }
      if (!self.planner.isFree(st.x, st.y)) {
        const e = freeAlong(st.x, st.y, st.h);
        if (!e) { fault('BLOQUE', 'impossible de se dégager'); return false; }
        moveTo(e[0], e[1], null, label);
      }
      let pre = [x, y];
      if (!self.planner.isFree(x, y)) {
        pre = freeAlong(x, y, hFinal);
        if (!pre) { fault('BLOQUE', 'cible inaccessible'); return false; }
      }
      let pts = self.planner.path(st.x, st.y, pre[0], pre[1]);
      if (!pts) { fault('BLOQUE', 'aucun chemin'); return false; }
      if (robot.chassis !== 'tank') {
        // mecanum : on tourne (si on peut tourner ici) puis on translate au cap final
        if (turnOk(st.x, st.y, st.h, hFinal)) turnTo(hFinal, null, label);
        pts = shortcut(pts, st.h);
      }
      for (let i = 1; i < pts.length; i++) moveTo(pts[i][0], pts[i][1], null, label);
      turnTo(hFinal, null, label);
      if (pre[0] !== x || pre[1] !== y) {
        // approche finale en ligne droite, sans changer de cap (y compris pour un tank)
        const c = Math.cos(st.h), s = Math.sin(st.h);
        const dx = x - st.x, dy = y - st.y;
        const f = dx * c + dy * s;
        if (robot.chassis === 'tank') moveStraight(f, allowEnd, label);
        else moveTo(x, y, allowEnd, label);
      }
      return true;
    };

    // Déplacement dans l'axe du robot (positif = avant), sans rotation.
    const moveStraight = (f, allow, label) => {
      const c = Math.cos(st.h), s = Math.sin(st.h);
      const x = st.x + f * c, y = st.y + f * s;
      const n = Math.ceil(Math.abs(f) / 1.0);
      for (let i = 1; i <= n; i++) checkAt(st.x + (f * c * i) / n, st.y + (f * s * i) / n, st.h, allow);
      if (Math.abs(f) < 0.3) return;
      const from = { x: st.x, y: st.y, h: st.h };
      st.x = x; st.y = y;
      pushPrim({ k: 'move', f, s: 0, dur: pause + Math.abs(f) / rd.vAvant, from, to: { x, y, h: st.h }, label });
      st.moved = true;
    };

    const ensureLauncher = () => {
      if (!st.launcherOn) { pushPrim({ k: 'launcherOn', dur: 0, label: 'Lanceur ON' }); st.launcherOn = true; st.launcherT = st.t; }
    };
    const launcherOff = () => {
      if (st.launcherOn) { pushPrim({ k: 'launcherOff', dur: 0, label: 'Lanceur OFF' }); st.launcherOn = false; }
    };

    // Passe par un point sans viser de cap particulier (points de passage, courbes) :
    // mecanum = on garde le cap et on translate ; tank = on roule face au point.
    const passThrough = (x, y, label) => {
      if (G.dist(st.x, st.y, x, y) < 0.5) return true;
      if (robot.chassis !== 'tank') {
        if (lineOk(st.x, st.y, x, y, st.h)) { moveTo(x, y, null, label); return true; }
        return goTo(x, y, st.h, label);
      }
      const a = Math.atan2(y - st.y, x - st.x);
      const fwd = Math.abs(G.wrap(a - st.h)) <= Math.abs(G.wrap(a + Math.PI - st.h));
      return goTo(x, y, fwd ? a : G.wrap(a + Math.PI), label);
    };
    // Courbe dessinée (Bézier quadratique de la position actuelle à (x, y), point de contrôle
    // `ctrl`) : en chronométré, on la suit en 3 segments droits jusqu'aux 2/3 du chemin.
    const followCurve = (ctrl, x, y, label) => {
      if (!ctrl) return true;
      const x0 = st.x, y0 = st.y;
      for (const u of [1 / 3, 2 / 3]) {
        const px = (1 - u) * (1 - u) * x0 + 2 * u * (1 - u) * ctrl[0] + u * u * x;
        const py = (1 - u) * (1 - u) * y0 + 2 * u * (1 - u) * ctrl[1] + u * u * y;
        if (!passThrough(px, py, label)) return false;
      }
      return true;
    };

    // Odométrie (Pedro Pathing) : un trajet (courbe + approche) est suivi d'un seul geste, sans
    // arrêt ; le mecanum tourne pendant qu'il roule. On recalcule les durées du groupe de
    // mouvements : temps de parcours à vitesse max + accélération / freinage.
    st.groups = [];
    const travel = (fn, info) => {
      const i0 = st.prims.length, t0 = st.t;
      const from = { x: st.x, y: st.y, h: st.h };
      const ok = fn();
      if (odo && ok !== false) odoRetime(i0, t0);
      if (ok !== false && st.prims.length > i0) {
        const g = Object.assign({ from, to: { x: st.x, y: st.y, h: st.h }, i0, i1: st.prims.length }, info || {});
        g.pts = st.prims.slice(i0).filter((p) => p.k === 'move').map((p) => [p.to.x, p.to.y]);
        st.groups.push(g);
        for (let i = i0; i < st.prims.length; i++) st.prims[i].g = st.groups.length - 1;
      }
      return ok;
    };
    const odoRetime = (i0, t0) => {
      const ps = st.prims.slice(i0);
      if (!ps.length) return;
      const moves = ps.filter((p) => p.k === 'move');
      const L = moves.reduce((a, p) => a + Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y), 0);
      const dH = ps.filter((p) => p.k === 'turn').reduce((a, p) => a + p.deg * DEG, 0);
      const acc = rd.vOdo / rd.aOdo; // temps perdu à accélérer puis freiner
      if (robot.chassis !== 'tank' && moves.length) {
        // le cap change pendant la translation : on fond les rotations dans les mouvements
        const tMove = L / rd.vAvant + acc, tTurn = Math.abs(dH) / rd.wRot;
        const total = Math.max(tMove, tTurn);
        const h0 = ps[0].from.h;
        let c = 0;
        const out = [];
        for (const p of moves) {
          const l = Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y);
          const ha = h0 + (dH * c) / Math.max(1e-9, L);
          c += l;
          const hb = h0 + (dH * c) / Math.max(1e-9, L);
          out.push(Object.assign(p, { from: Object.assign({}, p.from, { h: G.wrap(ha) }), to: Object.assign({}, p.to, { h: G.wrap(hb) }), dh: hb - ha, dur: (total * l) / Math.max(1e-9, L) }));
        }
        st.prims.splice(i0, ps.length, ...out);
      } else {
        for (const p of ps) if (p.k === 'move') p.dur = Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y) / rd.vAvant + acc;
      }
      let t = t0;
      for (let i = i0; i < st.prims.length; i++) { const p = st.prims[i]; p.t0 = t; t += p.dur || 0; p.t1 = t; }
      st.t = t;
    };
    // Après une bascule (selon le compte du robot), le joueur humain pose un NECTAR dans la LOADING ZONE.
    const tipBelief = (tArr) => {
      st.tipsBelief++; st.cellN = 0; st.cellP = 0;
      st.events.push({ t: tArr, type: 'tip' });
      if (st.nectarLeft > 0) {
        st.nectarLeft--;
        const ta = tArr + (game.delaiHumain_s === undefined ? 2 : game.delaiHumain_s);
        st.nectarQueue.push(ta);
        st.events.push({ t: ta, type: 'nectarDrop' });
      }
    };

    st.steps = [];
    const actions = (plan.actions || []).slice();
    for (let ai = 0; ai < actions.length; ai++) {
      const a = actions[ai];
      const step = st.steps[ai] = { t0: st.t, t1: st.t, done: false };
      const stepDone = () => { step.t1 = st.t; step.done = true; };
      if (a.type === 'via') {
        if (!travel(() => followCurve(a.ctrl, a.x, a.y, 'Point de passage') && passThrough(a.x, a.y, 'Point de passage'), { ctrl: a.ctrl, kind: 'via' })) break;
        stepDone();
      } else if (a.type === 'tir') {
        if (st.held <= 0) continue;
        // On vise la CELL dont l'ouverture fait face au point de tir (celle d'en haut avant la
        // bascule, ou celle d'en face après). Tirer plus de balles que nécessaire dans la même
        // CELL donne de la marge en cas de raté : la balle en trop arrive dans une CELL basculée.
        let cellIdx = -1, best = 0;
        world.cellTargets.forEach((c, i) => {
          const p = BZ.hitProb(world, robot, a.x, a.y, Math.atan2(c.y - a.y, c.x - a.x), c);
          if (p > best + 1e-9 || (p > 0 && Math.abs(p - best) <= 1e-9 && i === st.tipsBelief % 2)) { best = p; cellIdx = i; }
        });
        // aucune CELL atteignable d'ici (trop loin, derrière la HIVE…) : on garde les balles
        if (cellIdx < 0) continue;
        const cell = world.cellTargets[cellIdx];
        const aimAt = Math.atan2(cell.y - a.y, cell.x - a.x);
        const hF = G.wrap(aimAt - rd.tirSens);
        // Nombre de balles tirées : choisi par l'IA (on peut en garder pour plus tard). Tirer
        // exactement ce qu'il faut est risqué (un raté = pas de bascule) : l'IA arbitre.
        const nTir = Math.max(1, Math.min(st.held, a.n || st.held));
        const label = `Tir de ${nTir} balle(s)` + (nTir < st.held ? ` (garde ${st.held - nTir})` : '');
        ensureLauncher();
        if (!travel(() => followCurve(a.ctrl, a.x, a.y, 'Vers position de tir') && goTo(a.x, a.y, hF, 'Vers position de tir'), { ctrl: a.ctrl, kind: 'tir' })) break;
        const waitSpin = robot.lanceur.monteeMs / 1000 - (st.t - st.launcherT);
        if (waitSpin > 0) pushPrim({ k: 'wait', ms: Math.round(waitSpin * 1000), dur: waitSpin, label: 'Montée du lanceur' });
        const n = nTir;
        const tFeed0 = st.t;
        pushPrim({ k: 'feed', n, ms: robot.lanceur.msParBalle * n, dur: (robot.lanceur.msParBalle * n) / 1000, label });
        for (let b = 0; b < n; b++) {
          // les NECTAR tenus partent en premier
          const kind = b < st.heldN ? 'nectar' : 'pollen';
          const t = tFeed0 + ((b + 1) * robot.lanceur.msParBalle) / 1000;
          st.shots.push({ t, x: st.x, y: st.y, aim: G.wrap(st.h + rd.tirSens), kind });
          if (cellIdx !== st.tipsBelief % 2) continue; // CELL déjà basculée (balle de marge)
          if (kind === 'nectar') st.cellN++; else st.cellP++;
          if (BZ.cellTips(game, st.cellN, st.cellP)) tipBelief(t + BZ.FLIGHT);
        }
        st.heldN = Math.max(0, st.heldN - n);
        st.held -= n;
        // on n'éteint le lanceur que si on ne retire pas juste après
        const next = actions.slice(ai + 1).find((x) => x.type === 'tir');
        if (!next) launcherOff();
        stepDone();
      } else if (a.type === 'ramasse' && a.src === 'nectar') {
        // NECTAR posé par le joueur humain (seulement après une bascule, si l'intake le peut)
        if (!(robot.intake && robot.intake.nectar) || st.held >= 4 || !st.nectarQueue.length) continue;
        const pose = BZ.pickupPose(world, 'nectar');
        const nom = 'NECTAR (LOADING ZONE)';
        if (!travel(() => followCurve(a.ctrl, pose.x, pose.y, 'Vers ' + nom) && goTo(pose.x, pose.y, pose.h, 'Vers ' + nom), { ctrl: a.ctrl, kind: 'ramasse' })) break;
        const ta = st.nectarQueue[0];
        if (ta > st.t) pushPrim({ k: 'wait', ms: Math.round((ta - st.t) * 1000), dur: ta - st.t, label: 'Attente du NECTAR' });
        pushPrim({ k: 'intakeOn', dur: 0, label: 'Intake ON' });
        const sign = rd.intakeSens === 0 ? 1 : -1;
        moveStraight(sign * pose.push, pose.allow, 'Ramassage ' + nom);
        const w = robot.intake.msParBalle / 1000;
        pushPrim({ k: 'wait', ms: Math.round(w * 1000), dur: w, label: 'Ramasse 1 NECTAR' });
        st.events.push({ t: st.t, type: 'pickup', src: 'nectar', n: 1 });
        moveStraight(-sign * pose.push, pose.allow, 'Recul');
        pushPrim({ k: 'intakeOff', dur: 0, label: 'Intake OFF' });
        st.nectarQueue.shift();
        st.held += 1; st.heldN += 1;
        stepDone();
      } else if (a.type === 'ramasse') {
        const can = a.src === 'jardin' ? robot.intake.sol : robot.intake.fleur;
        if (!can || st.held >= 4 || !(st.avail[a.src] > 0)) continue;
        const pose = BZ.pickupPose(world, a.src);
        if (!pose) continue;
        if (a.src === 'jardin' && !self.planner.isFree(pose.x, pose.y) && !freeAlong(pose.x, pose.y, pose.h)) {
          // coin du GARDEN inaccessible dans l'axe (tank collé au mur) : on se décale vers le
          // centre du terrain tant qu'on attrape encore des POLLEN
          for (let dx = 1; dx <= 20; dx++) {
            const x = pose.x + dx;
            if (pose.reach(x) <= 0) break;
            if (self.planner.isFree(x, pose.y) || freeAlong(x, pose.y, pose.h)) { pose.x = x; break; }
          }
        }
        const n = Math.min(4 - st.held, st.avail[a.src], pose.reach(pose.x));
        if (n <= 0) continue;
        const nom = a.src === 'jardin' ? 'GARDEN' : (world.flowers.find((f) => f.id === a.src) || {}).nom;
        if (!travel(() => followCurve(a.ctrl, pose.x, pose.y, 'Vers ' + nom) && goTo(pose.x, pose.y, pose.h, 'Vers ' + nom), { ctrl: a.ctrl, kind: 'ramasse' })) break;
        pushPrim({ k: 'intakeOn', dur: 0, label: 'Intake ON' });
        const allow = pose.allow;
        // l'intake est à l'avant (push > 0) ou à l'arrière (on recule vers la source)
        const sign = rd.intakeSens === 0 ? 1 : -1;
        moveStraight(sign * pose.push, allow, 'Ramassage ' + nom);
        const w = (robot.intake.msParBalle * n) / 1000;
        pushPrim({ k: 'wait', ms: Math.round(w * 1000), dur: w, label: `Ramasse ${n} POLLEN (${nom})` });
        st.events.push({ t: st.t, type: 'pickup', src: a.src, n });
        moveStraight(-sign * pose.push, allow, 'Recul');
        pushPrim({ k: 'intakeOff', dur: 0, label: 'Intake OFF' });
        st.held += n;
        st.avail[a.src] -= n;
        if (st.held > 4) fault('G407');
        stepDone();
      }
    }
    launcherOff();
    if (plan.park && plan.park.on) {
      const p = BZ.parkPose(world, plan.park.t, st.h);
      const t0 = st.t;
      travel(() => followCurve(plan.park.ctrl, p.x, p.y, 'Vers LOADING ZONE (PARK)') && goTo(p.x, p.y, p.h, 'Vers LOADING ZONE (PARK)'), { ctrl: plan.park.ctrl, kind: 'park' });
      st.parkStep = { t0, t1: st.t };
    }

    return this.evaluate(st, plan);
  };

  // Pose du robot à l'instant t (interpolation sur la liste des mouvements).
  BZ.poseAt = function (prims, start, t) {
    let pose = { x: start.x, y: start.y, h: start.h };
    for (const p of prims) {
      if (!p.from) continue;
      if (t >= p.t1) { pose = p.to; continue; }
      if (t <= p.t0) break;
      const moving = Math.max(0, (p.t1 - p.t0) - (p.pauseDur || 0));
      const u = Math.min(1, (t - p.t0) / Math.max(1e-6, moving));
      if (p.k === 'turn') {
        return { x: p.from.x, y: p.from.y, h: G.wrap(p.from.h + G.wrap(p.to.h - p.from.h) * u) };
      }
      return { x: p.from.x + (p.to.x - p.from.x) * u, y: p.from.y + (p.to.y - p.from.y) * u, h: p.dh ? G.wrap(p.from.h + p.dh * u) : p.from.h };
    }
    return pose;
  };

  Sim.prototype.evaluate = function (st, plan) {
    const world = this.world, robot = this.robot, game = this.game;
    const T = game.dureeAuto;
    const endT = st.t;
    for (const p of st.prims) if (p.k === 'turn' || p.k === 'move') p.pauseDur = this.rd.odo ? 0 : this.rd.pause;
    const final = BZ.poseAt(st.prims, plan.start, T);

    // Espérance du nombre de bascules (programmation dynamique exacte sur les tirs).
    // état = (NECTAR, POLLEN dans la CELL du haut, bascules)
    let dist = new Map([[world.startNectar + ',0,0', 1]]);
    for (const s of st.shots) {
      if (s.t > T) break;
      const next = new Map();
      for (const [key, pr] of dist) {
        const [n, q, tips] = key.split(',').map(Number);
        const cell = world.cellTargets[tips % 2];
        const p = BZ.hitProb(world, robot, s.x, s.y, s.aim, cell);
        const add = (k, v) => next.set(k, (next.get(k) || 0) + v);
        if (p > 0) {
          const n2 = s.kind === 'nectar' ? n + 1 : n, q2 = s.kind === 'nectar' ? q : q + 1;
          add(BZ.cellTips(game, n2, q2) ? '0,0,' + (tips + 1) : n2 + ',' + q2 + ',' + tips, pr * p);
        }
        if (p < 1) add(key, pr * (1 - p));
      }
      dist = next;
    }
    let eTips = 0, pAtLeast1 = 0, eFill = 0;
    const tipsDist = [0, 0, 0, 0, 0, 0]; // probabilité d'avoir exactement k bascules
    for (const [key, pr] of dist) {
      const [n, q, tips] = key.split(',').map(Number);
      eTips += tips * pr;
      eFill += Math.min(1, q / Math.max(1, BZ.tipNeed(game, n))) * pr; // part de la bascule suivante déjà faite
      if (tips >= 1) pAtLeast1 += pr;
      tipsDist[Math.min(5, tips)] += pr;
    }
    // chances d'au moins k bascules
    const tipsAtLeast = tipsDist.map((_, k) => tipsDist.slice(k).reduce((a, b) => a + b, 0));

    const leave = st.moved && !BZ.touchesWall(world, final.x, final.y, final.h, 0.25);
    const park = BZ.inLoadingZone(world, final.x, final.y, final.h);

    if (endT > T) st.faults.TEMPS = st.faults.TEMPS || { rule: 'TEMPS', t: T, info: `fin prévue à ${endT.toFixed(1)} s` };
    const faults = Object.values(st.faults);
    let penalty = 0, internal = 0;
    for (const f of faults) {
      const R = BZ.RULES[f.rule];
      penalty += R ? R.points : 0;
      if (!R || R.points === 0) internal += 1;
    }
    const expected = BZ.POINTS.LEAVE * (leave ? 1 : 0) + BZ.POINTS.PARK * (park ? 1 : 0) + BZ.POINTS.TIP * eTips;
    const nominalTips = BZ.shotOutcomes({ shots: st.shots }, world, robot, game, null).tips.length;
    const marge = Math.max(0, endT - (T - game.margeSecurite));
    // petit bonus pour les balles déjà dans la CELL : guide l'IA vers la bascule suivante
    let fitness = expected + 3 * eFill - 3 * penalty - 25 * internal - 15 * marge - 0.05 * endT;
    if (st.faults.G304) fitness -= 1000;
    return {
      plan, prims: st.prims, shots: st.shots, events: st.events, faults, steps: st.steps || [], parkStep: st.parkStep || null, groups: st.groups || [],
      endT, final, leave, park, eTips, pAtLeast1, nominalTips, tipsAtLeast,
      expected, penalty, fitness,
      legal: penalty === 0 && internal === 0,
    };
  };

  BZ.Sim = Sim;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
})(typeof window !== 'undefined' ? window : globalThis);
