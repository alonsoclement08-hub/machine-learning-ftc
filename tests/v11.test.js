// v11 : plan dessiné (points de passage, courbes, zones) et IA qui optimise ce plan.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { BZ, FIELD } = require('./load.js');
require('../js/plan_editor.js');

function setup(gameOver) {
  const robot = BZ.defaultRobot();
  const game = Object.assign(BZ.defaultGame(), gameOver || {});
  const rd = BZ.robotDerived(robot);
  const world = BZ.buildWorld(FIELD, game, rd);
  const planner = new BZ.Planner(world, 2);
  const start = BZ.legalStarts(world, 6).find((s) => Math.abs(s.h) < 1e-6);
  return { robot, game, world, sim: new BZ.Sim(world, planner, robot, game), start };
}

test('point de passage : le robot passe par le point avant de tirer', () => {
  const { sim, start } = setup();
  const r = sim.run({ start, actions: [{ type: 'via', x: -55, y: -10 }, { type: 'tir', x: -30, y: -55 }], park: { on: false, t: 0 } });
  const moves = r.prims.filter((p) => p.k === 'move');
  assert.ok(moves.some((p) => Math.abs(p.to.x + 55) < 0.01 && Math.abs(p.to.y + 10) < 0.01), 'passe par (-55, -10)');
  assert.strictEqual(r.steps.length, 2);
  assert.ok(r.steps[0].done && r.steps[1].done);
  assert.ok(r.steps[1].t0 >= r.steps[0].t1 - 1e-9);
  assert.strictEqual(r.faults.length, 0, JSON.stringify(r.faults));
});

test('courbe : la flèche courbée est suivie en plusieurs segments', () => {
  const { sim, start } = setup();
  const plan = (ctrl) => ({ start, actions: [{ type: 'tir', x: -30, y: -55, ctrl }], park: { on: false, t: 0 } });
  const droit = sim.run(plan(undefined)), courbe = sim.run(plan([-60, -60]));
  const n = (r) => r.prims.filter((p) => p.k === 'move').length;
  assert.ok(n(courbe) >= n(droit) + 2, `${n(courbe)} segments contre ${n(droit)}`);
  const mid = BZ.bezier([start.x, start.y], [-60, -60], [-30, -55], 1 / 3);
  assert.ok(courbe.prims.some((p) => p.k === 'move' && G(p.to, mid) < 0.5), 'passe par le 1er tiers de la courbe');
  function G(a, b) { return Math.hypot(a.x - b[0], a.y - b[1]); }
});

test('zone interdite : faute si le plan la traverse, plusieurs zones possibles', () => {
  const zones = [{ id: 'a', kind: 'interdite', x0: -50, y0: -20, x1: -30, y1: 0 }, { id: 'b', kind: 'interdite', x0: -70, y0: 50, x1: -60, y1: 60 }];
  const { world, sim, start } = setup({ zones });
  assert.strictEqual(world.obstacles.filter((o) => o.rule === 'PARTENAIRE').length, 2);
  const r = sim.run({ start, actions: [{ type: 'via', x: -40, y: -10 }], park: { on: false, t: 0 } });
  assert.ok(r.faults.some((f) => f.rule === 'PARTENAIRE' || f.rule === 'BLOQUE'));
});

test('optimiser mon plan : garde l\'ordre, les étapes 🔒 et les zones de tir, sans faire pire', () => {
  const zones = [{ id: 'zt', kind: 'tir', x0: -45, y0: -62, x1: -25, y1: -45 }];
  const { robot, game, world, sim, start } = setup({ zones });
  const base = {
    start, startLock: true, park: { on: true, t: 0.5 },
    actions: [
      { type: 'tir', x: -40, y: -50, zone: 'zt' },
      { type: 'ramasse', src: 'fleur1' },
      { type: 'tir', x: -30, y: 50, lock: true },
      { type: 'ramasse', src: 'fleur0' },
      { type: 'tir', x: -35, y: 55, n: 4 },
    ],
  };
  const r0 = sim.run(base);
  const opt = new BZ.Optimizer(FIELD, robot, game, { seed: 3, popSize: 30, base, keepOrder: true });
  for (let i = 0; i < 25; i++) opt.step();
  const b = opt.best;
  assert.ok(b.result.fitness >= r0.fitness - 1e-9, `${b.result.fitness} >= ${r0.fitness}`);
  const kinds = b.actions.filter((a) => !a.auto).map((a) => a.type + (a.src || ''));
  assert.deepStrictEqual(kinds, base.actions.map((a) => a.type + (a.src || '')));
  const locked = b.actions.find((a) => a.lock);
  assert.deepStrictEqual([locked.x, locked.y, locked.ctrl], [-30, 50, undefined]);
  for (const g of opt.pop) {
    const t = g.actions.find((a) => a.zone === 'zt');
    assert.ok(t.x >= -45 && t.x <= -25 && t.y >= -62 && t.y <= -45, `dans la zone : ${t.x}, ${t.y}`);
  }
  assert.strictEqual(opt.starts.length, 1, 'départ verrouillé');
  assert.ok(world.cellTargets.length === 2);
});

test('éditeur : ajouter un tir, courber la flèche, annuler', () => {
  const { robot, game, world, start } = setup();
  let plan = { start, actions: [], park: { on: false, t: 0.5 } };
  const app = {
    world: () => world, robot: () => robot, game: () => game, plan: () => plan,
    apply: (p, z) => { plan = p; game.zones = z; }, changed() {}, toast() {}, setTool() {},
    snapStart: (x, y) => ({ pose: start, errs: [] }),
  };
  const ed = new BZ.PlanEditor(app);
  ed.setTool('tir'); ed.tirN = 3;
  ed.pointer('down', -30, -55, 3);
  assert.deepStrictEqual(plan.actions, [{ type: 'tir', x: -30, y: -55, n: 3 }]);
  ed.setTool('select');
  const node = BZ.planNodes(world, plan)[1];
  const mid = BZ.bezier(node.from, null, [node.x, node.y], 0.5);
  ed.pointer('down', mid[0], mid[1], 3);
  ed.pointer('move', mid[0] + 10, mid[1] + 10, 3);
  ed.pointer('up', mid[0] + 10, mid[1] + 10, 3);
  assert.ok(plan.actions[0].ctrl, 'la flèche est courbée');
  const m2 = BZ.bezier(node.from, plan.actions[0].ctrl, [node.x, node.y], 0.5);
  assert.ok(Math.hypot(m2[0] - mid[0] - 10, m2[1] - mid[1] - 10) < 1e-6, 'la poignée suit le pointeur');
  ed.undo();
  assert.ok(!plan.actions[0].ctrl);
  ed.undo();
  assert.strictEqual(plan.actions.length, 0);
  ed.redo();
  assert.strictEqual(plan.actions.length, 1);
});
