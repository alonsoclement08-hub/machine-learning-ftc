// v12 : table de bascule, NECTAR du joueur humain, mode odométrie et export Pedro Pathing.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { BZ, FIELD } = require('./load.js');

function setup(robotOver, gameOver) {
  const robot = BZ.defaultRobot();
  for (const [k, v] of Object.entries(robotOver || {})) {
    if (v && typeof v === 'object') Object.assign(robot[k], v); else robot[k] = v;
  }
  const game = Object.assign(BZ.defaultGame(), gameOver || {});
  const rd = BZ.robotDerived(robot);
  const world = BZ.buildWorld(FIELD, game, rd);
  const planner = new BZ.Planner(world, 2);
  const start = BZ.legalStarts(world, 6).find((s) => Math.abs(s.h) < 1e-6);
  return { robot, game, world, sim: new BZ.Sim(world, planner, robot, game), start };
}

test('table de bascule : 3 NECTAR + 3 POLLEN, 1 NECTAR + 7, 0 NECTAR + 8', () => {
  const g = BZ.defaultGame();
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 9].map((n) => BZ.tipNeed(g, n)), [8, 7, 6, 3, 1, 0, 0]);
  assert.ok(BZ.cellTips(g, 3, 3) && !BZ.cellTips(g, 3, 2));
  assert.ok(BZ.cellTips(g, 1, 7) && !BZ.cellTips(g, 1, 6));
  assert.ok(BZ.cellTips(g, 0, 8) && !BZ.cellTips(g, 0, 7));
  const { sim, world, robot, game, start } = setup();
  const r = sim.run({ start, actions: [{ type: 'tir', x: -40, y: -45, n: 3 }], park: { on: false, t: 0 } });
  assert.strictEqual(BZ.shotOutcomes(r, world, robot, game, null).tips.length, 1, '3 POLLEN sur 3 NECTAR : bascule');
});

test('NECTAR du joueur humain : seulement après une bascule et si l\'intake peut le prendre', () => {
  const plan = (start) => ({ start, actions: [{ type: 'tir', x: -40, y: -45, n: 3 }, { type: 'ramasse', src: 'nectar' }, { type: 'tir', x: -35, y: 55 }], park: { on: false, t: 0 } });
  const sans = setup();
  const r0 = sans.sim.run(plan(sans.start));
  assert.ok(!r0.steps[1].done, 'intake sans NECTAR : étape sautée');
  const avec = setup({ intake: { nectar: true } });
  const r1 = avec.sim.run(plan(avec.start));
  assert.ok(r1.steps[1].done, 'NECTAR ramassé');
  const tip = r1.events.find((e) => e.type === 'tip');
  const drop = r1.events.find((e) => e.type === 'nectarDrop');
  assert.ok(drop && Math.abs(drop.t - tip.t - avec.game.delaiHumain_s) < 1e-9, 'posé 2 s après la bascule');
  const pick = r1.events.find((e) => e.type === 'pickup' && e.src === 'nectar');
  assert.ok(pick.t >= drop.t, 'pas ramassé avant d\'être posé');
  const kinds = r1.shots.map((s) => s.kind);
  assert.deepStrictEqual(kinds.slice(3), ['nectar', 'pollen'], 'le NECTAR est tiré en premier');
  // sans bascule avant, pas de NECTAR à prendre
  const r2 = avec.sim.run({ start: avec.start, actions: [{ type: 'ramasse', src: 'nectar' }], park: { on: false, t: 0 } });
  assert.ok(!r2.steps[0].done);
});

test('odométrie : le même plan est plus rapide (pas d\'arrêts), le cap change en roulant', () => {
  const plan = (start) => ({ start, actions: [{ type: 'tir', x: -40, y: -45 }, { type: 'ramasse', src: 'fleur1' }, { type: 'tir', x: -35, y: 55, ctrl: [-55, 10] }], park: { on: true, t: 0.5 } });
  const chrono = setup({ msParMetre: 1000 });
  const odo = setup({ msParMetre: 1000, deplacement: 'odometrie', odo: { vMax_cm_s: 100, accel_cm_s2: 200 } });
  const a = chrono.sim.run(plan(chrono.start)), b = odo.sim.run(plan(odo.start));
  assert.ok(b.endT < a.endT, `${b.endT} < ${a.endT}`);
  assert.strictEqual(b.faults.length, 0, JSON.stringify(b.faults));
  assert.ok(b.prims.some((p) => p.k === 'move' && p.dh), 'rotation fondue dans le déplacement');
  // la pose interpolée tourne pendant le mouvement
  const m = b.prims.find((p) => p.k === 'move' && Math.abs(p.dh || 0) > 0.2);
  const mid = BZ.poseAt(b.prims, b.plan.start, (m.t0 + m.t1) / 2);
  assert.ok(Math.abs(BZ.G.wrap(mid.h - m.from.h)) > 0.05);
});

test('export Pedro : Pedro Pathing v3, départ et trajets du plan, courbe dessinée', () => {
  const odo = setup({ deplacement: 'odometrie' });
  const r = odo.sim.run({ start: odo.start, actions: [{ type: 'tir', x: -35, y: -50, ctrl: [-60, -60] }, { type: 'ramasse', src: 'fleur0' }], park: { on: true, t: 0.5 } });
  const java = BZ.exportPedro(r, odo.robot, { startText: ['test'] });
  assert.match(java, /import static com\.pedropathing\.api\.Paths\.line;/);
  assert.match(java, /follower = Constants\.create\(hardwareMap\);/);
  assert.match(java, /static final Pose DEPART = P\(/);
  assert.match(java, /suivre\(curve\(P\(.*\), P\(-60\.0, -60\.0, 0\.0\), P\(-35\.0, -50\.0, /);
  assert.match(java, /tirer\(\d\);/);
  assert.match(java, /intake\.setPower\(PUISSANCE_INTAKE\);/);
  const opens = (java.match(/\{/g) || []).length, closes = (java.match(/\}/g) || []).length;
  assert.strictEqual(opens, closes, 'accolades équilibrées');
});
