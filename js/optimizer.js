// "Machine learning" : algorithme génétique qui fait évoluer une population de plans d'AUTO.
// Chaque plan = position de départ + suite d'actions (tirer depuis un point, ramasser à une source)
// + PARK éventuel. Le simulateur donne le score ; les meilleurs plans se reproduisent et mutent.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};
  const G = BZ.G;

  function Optimizer(FIELD, robot, game, opts) {
    opts = opts || {};
    this.robot = robot; this.game = game;
    this.rd = BZ.robotDerived(robot);
    this.world = BZ.buildWorld(FIELD, game, this.rd);
    this.planner = new BZ.Planner(this.world, 2);
    this.sim = new BZ.Sim(this.world, this.planner, robot, game);
    this.rand = G.rng(opts.seed || 12345);
    this.popSize = opts.popSize || 70;
    this.maxActions = 10;
    this.base = opts.base ? JSON.parse(JSON.stringify(opts.base)) : null; // plan dessiné par l'équipe
    this.keepOrder = !!(this.base && opts.keepOrder);
    const fixedStart = game.departImpose || (this.base && this.base.startLock ? this.base.start : null);
    this.starts = fixedStart ? [fixedStart] : BZ.legalStarts(this.world, 3);
    if (this.base && this.base.start && !fixedStart && !BZ.checkStart(this.world, this.base.start).length) this.starts.push(this.base.start);
    if (!this.starts.length) throw new Error('Aucune position de départ légale : robot trop grand ?');
    this.zones = {};
    for (const z of game.zones || []) this.zones[z.id] = BZ.zoneRect(z);
    this.sources = ['jardin'].concat(this.world.flowers.map((f) => f.id));
    this.canNectar = !!(robot.intake && robot.intake.nectar && game.nectarHumain);
    if (this.canNectar) this.sources.push('nectar');
    this.shootSpots = this.computeShootSpots();
    this.bestSpots = this.rankSpots();
    this.generation = 0;
    this.history = [];
    this.best = null;
    this.pop = [];
    this.evals = 0;
    this.seedPopulation();
    if (this.base) this.seedBase();
  }

  // Garde un point dans sa zone (zone de tir / de passage) ou au moins de notre côté du terrain.
  Optimizer.prototype.clampPoint = function (a) {
    const R = this.rd.radius, half = this.world.half;
    const z = a.zone && this.zones[a.zone];
    if (z) {
      a.x = Math.min(z.x1, Math.max(z.x0, a.x));
      a.y = Math.min(z.y1, Math.max(z.y0, a.y));
    }
    a.x = Math.min(-R, Math.max(-half + R, a.x));
    a.y = Math.min(half - R, Math.max(-half + R, a.y));
  };

  // Le plan de l'équipe entre dans la population (et sert de base en mode « garder l'ordre »).
  Optimizer.prototype.seedBase = function () {
    const b = this.base;
    let idx = this.starts.findIndex((s) => Math.abs(s.x - b.start.x) < 0.05 && Math.abs(s.y - b.start.y) < 0.05 && Math.abs(G.wrap(s.h - b.start.h)) < 1e-3);
    if (idx < 0) idx = 0;
    const g = { startIdx: idx, actions: b.actions.map((a) => Object.assign({}, a)), park: Object.assign({ on: false, t: 0.5 }, b.park) };
    this.baseGenome = g;
    this.evaluate(g);
    if (this.keepOrder) {
      this.pop = [g];
      while (this.pop.length < this.popSize) {
        let c = this.clone(g);
        const nm = 1 + Math.floor(this.rand() * 3);
        for (let k = 0; k < nm; k++) c = this.softMutate(c);
        this.pop.push(c);
      }
    } else this.pop[this.pop.length - 1] = g;
    if (!this.best || g.result.fitness > this.best.result.fitness) this.best = g;
  };

  // Mutation « douce » : ne change ni l'ordre ni la nature des étapes, ne touche pas aux étapes 🔒.
  // Elle déplace les points (dans leur zone), courbe les flèches, change le nombre de balles,
  // ajoute ou retire des points de passage automatiques, et bouge un peu le départ et le PARK.
  Optimizer.prototype.softMutate = function (g) {
    const c = this.clone(g);
    const A = c.actions;
    const free = A.map((a, i) => (a.lock ? -1 : i)).filter((i) => i >= 0);
    const pts = free.filter((i) => A[i].type === 'tir' || A[i].type === 'via');
    const r = this.rand();
    if (r < 0.4 && pts.length) {
      const a = A[this.pick(pts)];
      const sigma = this.rand() < 0.6 ? 3 : 10;
      a.x += (this.rand() - 0.5) * 2 * sigma;
      a.y += (this.rand() - 0.5) * 2 * sigma;
      this.clampPoint(a);
    } else if (r < 0.58 && (free.length || (c.park && c.park.on && !c.park.lock))) {
      // courbe d'une flèche : ajoute, déplace ou retire le point de contrôle
      const useP = c.park && c.park.on && !c.park.lock && (!free.length || this.rand() < 0.15);
      const a = useP ? c.park : A[this.pick(free)];
      if (a.ctrl && this.rand() < 0.3) delete a.ctrl;
      else {
        let tgt = a.x !== undefined ? [a.x, a.y] : null;
        if (!tgt) { const p = useP ? BZ.parkPose(this.world, a.t, 0) : BZ.pickupPose(this.world, a.src); tgt = p ? [p.x, p.y] : [-50, 0]; }
        const base = a.ctrl || tgt;
        const sigma = a.ctrl ? 6 : 18;
        a.ctrl = [base[0] + (this.rand() - 0.5) * 2 * sigma, base[1] + (this.rand() - 0.5) * 2 * sigma];
      }
    } else if (r < 0.7) {
      const shots = free.filter((i) => A[i].type === 'tir');
      if (shots.length) A[this.pick(shots)].n = this.randomN();
    } else if (r < 0.82) {
      // point de passage automatique : en ajouter un (avant une étape libre) ou en retirer un
      const autos = A.map((a, i) => (a.auto ? i : -1)).filter((i) => i >= 0);
      if (autos.length && this.rand() < 0.45) A.splice(this.pick(autos), 1);
      else if (A.length < 16) {
        const k = Math.floor(this.rand() * (A.length + 1));
        if (k < A.length && A[k].lock) return c;
        const s = this.pick(this.shootSpots) || [-40, 0];
        const v = { type: 'via', x: s[0], y: s[1], auto: true };
        this.clampPoint(v);
        A.splice(k, 0, v);
      }
    } else if (r < 0.92) {
      if (this.starts.length > 1) c.startIdx = Math.max(0, Math.min(this.starts.length - 1, c.startIdx + this.pick([-2, -1, 1, 2])));
    } else if (c.park && !c.park.lock) {
      c.park.t = Math.min(1, Math.max(0, c.park.t + (this.rand() - 0.5) * 0.4));
    }
    return c;
  };

  // Points de tir candidats : libres pour le robot et à bonne distance d'une des deux CELLS.
  Optimizer.prototype.computeShootSpots = function () {
    const spots = [];
    const half = this.world.half;
    for (let x = -half; x <= 0; x += 3) {
      for (let y = -half; y <= half; y += 3) {
        if (!this.planner.isFree(x, y)) continue;
        // à bonne distance ET du côté de l'ouverture d'une des deux CELLS
        const ok = this.world.cellTargets.some((c) => BZ.hitProb(this.world, this.robot, x, y, Math.atan2(c.y - y, c.x - x), c) > 0);
        if (ok) spots.push([x, y]);
      }
    }
    return spots;
  };

  // Meilleurs points de tir pour chaque état de la HIVE (CELL du haut d'un côté ou de l'autre),
  // classés par probabilité de marquer (en face de l'ouverture, à la distance idéale).
  Optimizer.prototype.rankSpots = function () {
    return this.world.cellTargets.map((c) => this.shootSpots
      .map(([x, y]) => ({ x, y, p: BZ.hitProb(this.world, this.robot, x, y, Math.atan2(c.y - y, c.x - x), c) }))
      .filter((s) => s.p > 0)
      .sort((a, b) => b.p - a.p)
      .slice(0, 25));
  };

  Optimizer.prototype.pick = function (arr) { return arr[Math.floor(this.rand() * arr.length)]; };

  // Nombre de balles tirées : souvent "toutes", parfois 1 à 4 (pour en garder pour plus tard).
  Optimizer.prototype.randomN = function () {
    return this.rand() < 0.55 ? undefined : 1 + Math.floor(this.rand() * 4);
  };

  Optimizer.prototype.randomShot = function (state) {
    const best = state !== undefined ? this.bestSpots[state] : null;
    if (best && best.length && this.rand() < 0.7) {
      const s = this.pick(best.slice(0, 10));
      return { type: 'tir', x: s.x, y: s.y, n: this.randomN() };
    }
    if (!this.shootSpots.length) return { type: 'tir', x: -40, y: 0 };
    const s = this.pick(this.shootSpots);
    return { type: 'tir', x: s[0], y: s[1], n: this.randomN() };
  };

  // Plan "réfléchi" : tire juste ce qu'il faut pour faire basculer, change de côté de la HIVE
  // après chaque bascule (l'ouverture de la CELL change de côté), ramasse entre deux tirs.
  Optimizer.prototype.smartPlan = function () {
    let fill = 0, cellN = this.world.startNectar, state = 0, held = Math.min(4, this.game.prechargees);
    const avail = { jardin: this.world.garden.balls.length };
    for (const f of this.world.flowers) avail[f.id] = f.pollen;
    const order = this.sources.slice().sort(() => this.rand() - 0.5);
    const actions = [];
    let srcI = 0;
    while (actions.length < this.maxActions - 1) {
      if (held > 0) {
        const need = Math.max(1, BZ.tipNeed(this.game, cellN) - fill);
        // soit juste ce qu'il faut (+1 de marge si possible), soit tout
        let n = this.rand() < 0.6 ? Math.min(held, need + (this.rand() < 0.5 ? 1 : 0)) : held;
        n = Math.max(1, n);
        actions.push(Object.assign(this.randomShot(state), { n: n === held ? undefined : n }));
        held -= n; fill += n;
        if (BZ.cellTips(this.game, cellN, fill)) { fill = 0; cellN = 0; state ^= 1; }
      } else {
        let k = 0;
        while (k < order.length && !(avail[order[(srcI + k) % order.length]] > 0)) k++;
        if (k >= order.length) break;
        const src = order[(srcI + k) % order.length];
        srcI += k + 1;
        const take = Math.min(4, avail[src]);
        avail[src] -= take; held += take;
        actions.push({ type: 'ramasse', src });
      }
    }
    return {
      startIdx: Math.floor(this.rand() * this.starts.length),
      actions,
      park: { on: this.game.viserPark && this.rand() < 0.5, t: this.rand() },
    };
  };

  // Point de tir sûr (presque la meilleure précision possible) qui fait le moins de chemin
  // entre d'où l'on vient et où l'on va ensuite.
  Optimizer.prototype.spotBetween = function (state, from, to) {
    const best = this.bestSpots[state];
    if (!best || !best.length) return null;
    const ok = best.filter((s) => s.p >= best[0].p - 0.02);
    let pick = null, bc = Infinity;
    for (const s of ok) {
      const c = (from ? G.dist(from.x, from.y, s.x, s.y) : 0) + (to ? G.dist(s.x, s.y, to.x, to.y) : 0) + this.rand() * 6;
      if (c < bc) { bc = c; pick = s; }
    }
    return pick;
  };

  // Stratégie de l'équipe : tirer les balles préchargées (les 3 NECTAR déjà dans la CELL
  // suffisent presque : 1re bascule), FLOWER 1 -> tir de l'autre côté, FLOWER 2 -> tir (2e bascule),
  // GARDEN -> tir pour commencer à remplir la CELL suivante, puis PARK. L'IA part de là et
  // optimise ensuite les points de tir, le départ et les manœuvres.
  Optimizer.prototype.teamPlan = function () {
    const world = this.world, game = this.game;
    const flowers = world.flowers.map((f) => f.id);
    if (this.rand() < 0.5) flowers.reverse();
    const order = flowers.concat(['jardin']);
    const pose = (src) => BZ.pickupPose(world, src);
    const parkP = BZ.parkPose(world, 0.5, 0);
    let fill = 0, cellN = world.startNectar, state = 0, held = Math.min(4, game.prechargees);
    const actions = [];
    // départ : au plus près du premier point de tir (ou au hasard, pour varier)
    const firstSpot = this.spotBetween(0, null, pose(order[0]));
    let startIdx = Math.floor(this.rand() * this.starts.length);
    if (firstSpot && this.rand() < 0.7) {
      let bd = Infinity;
      this.starts.forEach((s, i) => {
        const d = G.dist(s.x, s.y, firstSpot.x, firstSpot.y) + this.rand() * 10;
        if (d < bd) { bd = d; startIdx = i; }
      });
    }
    let here = this.starts[startIdx];
    let lastState = 0;
    const shoot = (next, nWanted, insurance) => {
      if (held <= 0) return;
      // "marge" : on retire dans la CELL précédente au cas où un raté aurait empêché la bascule
      const target = insurance ? lastState : state;
      lastState = target;
      const s = this.spotBetween(target, here, next);
      if (!s) return;
      const n = Math.max(1, Math.min(held, nWanted || held));
      actions.push({ type: 'tir', x: s.x, y: s.y, n: n === held ? undefined : n });
      here = s;
      held -= n; fill += n;
      if (BZ.cellTips(game, cellN, fill)) { fill = 0; cellN = 0; state ^= 1; }
    };
    const need = Math.max(1, BZ.tipNeed(game, cellN) - fill);
    // juste ce qu'il faut pour la 1re bascule, ou une balle de plus en cas de raté
    shoot(pose(order[0]), this.rand() < 0.5 ? need : need + 1);
    // le joueur humain pose un NECTAR après la bascule : si l'intake peut le prendre, il allège la suivante
    if (this.canNectar && this.rand() < 0.5) { actions.push({ type: 'ramasse', src: 'nectar' }); held = Math.min(4, held + 1); }
    for (let i = 0; i < order.length; i++) {
      const p = pose(order[i]);
      if (!p) continue;
      actions.push({ type: 'ramasse', src: order[i] });
      held = Math.min(4, held + 4);
      here = p;
      shoot(i + 1 < order.length ? pose(order[i + 1]) : parkP, undefined, state !== lastState && this.rand() < 0.5);
    }
    return { startIdx, actions: actions.slice(0, this.maxActions), park: { on: !!game.viserPark, t: this.rand() } };
  };

  Optimizer.prototype.randomAction = function () {
    return this.rand() < 0.5 ? this.randomShot() : { type: 'ramasse', src: this.pick(this.sources) };
  };

  Optimizer.prototype.randomPlan = function () {
    const n = 1 + Math.floor(this.rand() * 5);
    const actions = [this.randomShot()];
    for (let i = 1; i < n; i++) {
      actions.push({ type: 'ramasse', src: this.pick(this.sources) });
      actions.push(this.randomShot());
    }
    return {
      startIdx: Math.floor(this.rand() * this.starts.length),
      actions: actions.slice(0, this.maxActions),
      park: { on: this.game.viserPark && this.rand() < 0.8, t: this.rand() },
    };
  };

  Optimizer.prototype.toPlan = function (g) {
    return { start: this.starts[g.startIdx], actions: g.actions, park: g.park };
  };

  Optimizer.prototype.evaluate = function (g) {
    if (!g.result) {
      g.result = this.sim.run(this.toPlan(g));
      this.evals++;
    }
    return g.result.fitness;
  };

  Optimizer.prototype.seedPopulation = function () {
    this.pop = [];
    for (let i = 0; i < this.popSize; i++) {
      this.pop.push(i % 3 === 0 ? this.teamPlan() : i % 3 === 1 ? this.smartPlan() : this.randomPlan());
    }
  };

  Optimizer.prototype.clone = function (g) {
    const cp = (a) => { const b = Object.assign({}, a); if (a.ctrl) b.ctrl = a.ctrl.slice(); return b; };
    return { startIdx: g.startIdx, actions: g.actions.map(cp), park: cp(g.park || { on: false, t: 0.5 }) };
  };

  Optimizer.prototype.mutate = function (g) {
    const c = this.clone(g);
    const r = this.rand();
    const A = c.actions;
    if (r < 0.3 && A.length) {
      // déplace un point de tir
      const shots = A.filter((a) => a.type === 'tir');
      if (shots.length) {
        const s = this.pick(shots);
        const sigma = this.rand() < 0.5 ? 3 : 10;
        s.x += (this.rand() - 0.5) * 2 * sigma;
        s.y += (this.rand() - 0.5) * 2 * sigma;
        this.clampPoint(s);
      }
    } else if (r < 0.42 && A.length < this.maxActions) {
      A.splice(Math.floor(this.rand() * (A.length + 1)), 0, this.randomAction());
    } else if (r < 0.54 && A.length > 1) {
      A.splice(Math.floor(this.rand() * A.length), 1);
    } else if (r < 0.64 && A.length > 1) {
      const i = Math.floor(this.rand() * A.length), j = Math.floor(this.rand() * A.length);
      [A[i], A[j]] = [A[j], A[i]];
    } else if (r < 0.68) {
      const pk = A.filter((a) => a.type === 'ramasse');
      if (pk.length) this.pick(pk).src = this.pick(this.sources);
    } else if (r < 0.7 && this.base) {
      // en partant d'un plan dessiné, l'IA peut aussi courber les flèches
      return this.softMutate(c);
    } else if (r < 0.74) {
      // change le nombre de balles d'un tir
      const shots = A.filter((a) => a.type === 'tir');
      if (shots.length) this.pick(shots).n = this.randomN();
    } else if (r < 0.86) {
      if (this.rand() < 0.6) {
        const d = Math.round((this.rand() - 0.5) * 6);
        c.startIdx = Math.max(0, Math.min(this.starts.length - 1, c.startIdx + d));
      } else c.startIdx = Math.floor(this.rand() * this.starts.length);
    } else if (r < 0.94) {
      c.park.t = Math.min(1, Math.max(0, c.park.t + (this.rand() - 0.5) * 0.4));
    } else {
      c.park.on = this.game.viserPark ? !c.park.on : false;
    }
    return c;
  };

  Optimizer.prototype.crossover = function (a, b) {
    const i = Math.floor(this.rand() * (a.actions.length + 1));
    const j = Math.floor(this.rand() * (b.actions.length + 1));
    const actions = a.actions.slice(0, i).concat(b.actions.slice(j)).slice(0, this.maxActions).map((x) => Object.assign({}, x));
    if (!actions.length) actions.push(this.randomShot());
    return { startIdx: this.rand() < 0.5 ? a.startIdx : b.startIdx, actions, park: Object.assign({}, this.rand() < 0.5 ? a.park : b.park) };
  };

  Optimizer.prototype.tournament = function () {
    let best = null;
    for (let k = 0; k < 3; k++) {
      const c = this.pick(this.pop);
      if (!best || c.result.fitness > best.result.fitness) best = c;
    }
    return best;
  };

  // Recherche locale : essaie de déplacer chaque point de tir de quelques pouces (et le départ
  // d'un cran) et garde ce qui améliore le score. Budget limité d'évaluations par génération.
  Optimizer.prototype.refine = function (g, budget) {
    let best = g;
    const steps = [3, -3];
    const shotIdx = g.actions.map((a, i) => ((a.type === 'tir' || (a.type === 'via' && this.base)) && !a.lock ? i : -1)).filter((i) => i >= 0);
    let tries = 0;
    for (let k = 0; k < budget && tries < budget; k++) {
      const c = this.clone(best);
      if (shotIdx.length && this.rand() < 0.8) {
        const a = c.actions[this.pick(shotIdx)];
        const k = this.pick([0.5, 1, 1, 2]); // pas de 1,5 / 3 / 6 in
        if (this.rand() < 0.5) a.x += this.pick(steps) * k;
        else a.y += this.pick(steps) * k;
        this.clampPoint(a);
      } else if (this.starts.length > 1) {
        c.startIdx = Math.max(0, Math.min(this.starts.length - 1, c.startIdx + this.pick([-1, 1])));
      }
      this.evaluate(c);
      tries++;
      if (c.result.fitness > best.result.fitness + 1e-9) best = c;
    }
    return best;
  };

  // Une génération complète.
  Optimizer.prototype.step = function () {
    for (const g of this.pop) this.evaluate(g);
    this.pop.sort((a, b) => b.result.fitness - a.result.fitness);
    // affinage du meilleur plan : petits déplacements des points de tir et du départ
    const refined = this.refine(this.pop[0], 14);
    if (refined !== this.pop[0]) this.pop.unshift(refined);
    if (!this.best || this.pop[0].result.fitness > this.best.result.fitness) this.best = this.pop[0];
    this.history.push({ gen: this.generation, best: this.best.result.fitness, expected: this.best.result.expected });
    const next = this.pop.slice(0, 4); // élitisme
    if (this.keepOrder) {
      while (next.length < this.popSize) {
        let child = this.clone(this.tournament());
        const nm = 1 + Math.floor(this.rand() * 2);
        for (let k = 0; k < nm; k++) child = this.softMutate(child);
        next.push(child);
      }
      this.pop = next;
      this.generation++;
      return this.best;
    }
    // un peu de sang neuf à chaque génération
    for (let i = 0; i < 2; i++) next.push(this.randomPlan());
    for (let i = 0; i < 2; i++) next.push(this.smartPlan());
    for (let i = 0; i < 2; i++) next.push(this.teamPlan());
    while (next.length < this.popSize) {
      let child;
      if (this.rand() < 0.35) child = this.crossover(this.tournament(), this.tournament());
      else child = this.clone(this.tournament());
      const nm = 1 + Math.floor(this.rand() * 2);
      for (let k = 0; k < nm; k++) child = this.mutate(child);
      next.push(child);
    }
    this.pop = next;
    this.generation++;
    return this.best;
  };

  Optimizer.prototype.bestResult = function () { return this.best ? this.best.result : null; };

  // Ajoute un plan connu (ex. le meilleur d'un essai précédent) dans la population.
  Optimizer.prototype.addPlan = function (plan) {
    let idx = this.starts.findIndex((s) => Math.abs(s.x - plan.start.x) < 0.05 && Math.abs(s.y - plan.start.y) < 0.05 && Math.abs(s.h - plan.start.h) < 1e-3);
    if (idx < 0) {
      if (this.game.departImpose) return; // départ imposé différent : plan incompatible
      if (BZ.checkStart(this.world, plan.start).length) return;
      this.starts.push(plan.start);
      idx = this.starts.length - 1;
    }
    const g = { startIdx: idx, actions: plan.actions.map((a) => Object.assign({}, a)), park: Object.assign({ on: false, t: 0.5 }, plan.park) };
    this.evaluate(g);
    this.pop[this.pop.length - 1] = g;
    if (!this.best || g.result.fitness > this.best.result.fitness) this.best = g;
  };

  BZ.Optimizer = Optimizer;
  if (typeof module !== 'undefined' && module.exports) module.exports = Optimizer;
})(typeof window !== 'undefined' ? window : globalThis);
