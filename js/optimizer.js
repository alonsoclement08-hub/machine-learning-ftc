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
    this.maxActions = 7;
    this.starts = game.departImpose ? [game.departImpose] : BZ.legalStarts(this.world, 3);
    if (!this.starts.length) throw new Error('Aucune position de départ légale : robot trop grand ?');
    this.sources = ['jardin'].concat(this.world.flowers.map((f) => f.id));
    this.shootSpots = this.computeShootSpots();
    this.generation = 0;
    this.history = [];
    this.best = null;
    this.pop = [];
    this.evals = 0;
    this.seedPopulation();
  }

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

  Optimizer.prototype.pick = function (arr) { return arr[Math.floor(this.rand() * arr.length)]; };

  Optimizer.prototype.randomShot = function () {
    if (!this.shootSpots.length) return { type: 'tir', x: -40, y: 0 };
    const s = this.pick(this.shootSpots);
    return { type: 'tir', x: s[0], y: s[1] };
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
    for (let i = 0; i < this.popSize; i++) this.pop.push(this.randomPlan());
  };

  Optimizer.prototype.clone = function (g) {
    return { startIdx: g.startIdx, actions: g.actions.map((a) => Object.assign({}, a)), park: Object.assign({}, g.park) };
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
        s.x = Math.min(-this.rd.radius, Math.max(-this.world.half + this.rd.radius, s.x));
        s.y = Math.min(this.world.half - this.rd.radius, Math.max(-this.world.half + this.rd.radius, s.y));
      }
    } else if (r < 0.42 && A.length < this.maxActions) {
      A.splice(Math.floor(this.rand() * (A.length + 1)), 0, this.randomAction());
    } else if (r < 0.54 && A.length > 1) {
      A.splice(Math.floor(this.rand() * A.length), 1);
    } else if (r < 0.64 && A.length > 1) {
      const i = Math.floor(this.rand() * A.length), j = Math.floor(this.rand() * A.length);
      [A[i], A[j]] = [A[j], A[i]];
    } else if (r < 0.72) {
      const pk = A.filter((a) => a.type === 'ramasse');
      if (pk.length) this.pick(pk).src = this.pick(this.sources);
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

  // Une génération complète.
  Optimizer.prototype.step = function () {
    for (const g of this.pop) this.evaluate(g);
    this.pop.sort((a, b) => b.result.fitness - a.result.fitness);
    if (!this.best || this.pop[0].result.fitness > this.best.result.fitness) this.best = this.pop[0];
    this.history.push({ gen: this.generation, best: this.best.result.fitness, expected: this.best.result.expected });
    const next = this.pop.slice(0, 4); // élitisme
    // un peu de sang neuf à chaque génération
    for (let i = 0; i < 4; i++) next.push(this.randomPlan());
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
