'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { BZ, FIELD } = require('./load');

function setup(chassis) {
  const robot = BZ.defaultRobot();
  robot.chassis = chassis || 'mecanum';
  const game = BZ.defaultGame();
  game.seuilBascule = 6; // les tests de barème ci-dessous sont écrits pour un seuil de 6
  const rd = BZ.robotDerived(robot);
  const world = BZ.buildWorld(FIELD, game, rd);
  const planner = new BZ.Planner(world, 2);
  return { robot, game, rd, world, planner, sim: new BZ.Sim(world, planner, robot, game) };
}

test('terrain : données issues du STEP officiel', () => {
  assert.ok(Math.abs(FIELD.half - 70.6) < 0.5, 'terrain ~144 in');
  assert.strictEqual(FIELD.flowers.length, 4);
  assert.strictEqual(FIELD.flowers.filter((f) => f.alliance === 'red').length, 2);
  assert.strictEqual(FIELD.gardenPollen.red, 4);
  assert.strictEqual(FIELD.hive.cells.red.startNectar, 3);
  const total = FIELD.flowers.reduce((s, f) => s + f.pollen, 0) + FIELD.gardenPollen.red + FIELD.gardenPollen.blue;
  assert.strictEqual(total, 24, '16 POLLEN dans les FLOWERS + 8 dans les GARDENS (+16 préchargés)');
});

test('positions de départ légales (G304)', () => {
  const { world } = setup();
  const starts = BZ.legalStarts(world, 3);
  assert.ok(starts.length > 20);
  for (const s of starts) assert.deepStrictEqual(BZ.checkStart(world, s), []);
  // au milieu du terrain : ne touche pas le mur
  assert.ok(BZ.checkStart(world, { x: -30, y: 0, h: 0 }).length > 0);
  // dans la LOADING ZONE
  const z = world.loading;
  assert.ok(BZ.checkStart(world, { x: -world.half + world.rd.hl, y: (z.y0 + z.y1) / 2, h: 0 }).length > 0);
});

test('barème : LEAVE + PARK + bascule', () => {
  const { sim, world } = setup();
  const start = BZ.legalStarts(world, 3).find((s) => s.y < -20 && Math.abs(s.x + world.half - world.rd.hl) < 0.1);
  const res = sim.run({ start, actions: [{ type: 'tir', x: -40, y: -45 }], park: { on: true, t: 0.5 } });
  assert.deepStrictEqual(res.faults.map((f) => f.rule), []);
  assert.strictEqual(res.leave, true);
  assert.strictEqual(res.park, true);
  // 3 NECTAR + 4 POLLEN >= 6 : une bascule si au moins 3 balles sur 4 entrent
  assert.strictEqual(res.nominalTips, 1);
  // la précision dépend de la position de tir (distance idéale, face à l'ouverture)
  const s0 = res.shots[0];
  const p = BZ.hitProb(world, BZ.defaultRobot(), s0.x, s0.y, s0.aim, world.cellTargets[0]);
  assert.ok(p > 0.5 && p <= 0.85, `p=${p}`);
  const pTip = p ** 4 + 4 * p ** 3 * (1 - p);
  assert.ok(Math.abs(res.eTips - pTip) < 1e-9, `eTips=${res.eTips} attendu ${pTip}`);
  assert.ok(Math.abs(res.expected - (3 + 5 + 20 * pTip)) < 1e-9);
});

test('faute G402 : passage du côté adverse', () => {
  const { world } = setup();
  assert.ok(BZ.checkPose(world, 5, 40, 0).includes('G402'));
  assert.ok(!BZ.checkPose(world, -30, 40, 0).includes('G402'));
});

test('faute G417 : contact avec la HIVE', () => {
  const { world } = setup();
  assert.ok(BZ.checkPose(world, -20, 0, 0).includes('G417'));
});

test('faute G405 : sortie du terrain', () => {
  const { world } = setup();
  assert.ok(BZ.checkPose(world, -world.half, 0, 0).includes('G405'));
});

test('G407 : jamais plus de 4 balles contrôlées', () => {
  const { sim, world } = setup();
  const start = BZ.legalStarts(world, 3)[5];
  // le robot a déjà 4 balles préchargées : ramasser avant de tirer ne doit rien prendre
  const res = sim.run({ start, actions: [{ type: 'ramasse', src: 'jardin' }, { type: 'ramasse', src: 'fleur0' }], park: { on: false, t: 0 } });
  assert.ok(!res.faults.some((f) => f.rule === 'G407'));
  assert.strictEqual(res.events.filter((e) => e.type === 'pickup').length, 0);
});

test('FLOWER : on ne peut toucher que celle dont on sort le POLLEN', () => {
  const { world } = setup();
  const f = world.flowers[0];
  const pose = BZ.pickupPose(world, f.id);
  const touch = { x: pose.x - Math.cos(pose.h) * (pose.push + 1), y: pose.y - Math.sin(pose.h) * (pose.push + 1) };
  const inside = { x: f.x + f.nx * (world.rd.hl + 1), y: f.y + f.ny * (world.rd.hl + 1) };
  assert.ok(BZ.checkPose(world, inside.x, inside.y, pose.h).includes('FLOWER_CHOC'));
  assert.ok(!BZ.checkPose(world, inside.x, inside.y, pose.h, [f.id]).includes('FLOWER_CHOC'));
  assert.ok(touch);
});

test('départ illégal = plan rejeté (G304)', () => {
  const { sim } = setup();
  const res = sim.run({ start: { x: -30, y: 0, h: 0 }, actions: [], park: { on: false, t: 0 } });
  assert.ok(res.faults.some((f) => f.rule === 'G304'));
  assert.ok(res.fitness < -500);
});

for (const chassis of ['mecanum', 'tank']) {
  test(`optimiseur (${chassis}) : plan sans faute, dans les 30 s, qui marque`, () => {
    const robot = BZ.defaultRobot();
    robot.chassis = chassis;
    const opt = new BZ.Optimizer(FIELD, robot, BZ.defaultGame(), { seed: 7, popSize: 50 });
    for (let i = 0; i < 25; i++) opt.step();
    const r = opt.bestResult();
    assert.deepStrictEqual(r.faults.map((f) => f.rule), []);
    assert.ok(r.endT <= 29.0 + 1e-6, `fin à ${r.endT}`);
    assert.ok(r.expected >= 25, `score espéré ${r.expected}`);
    assert.ok(r.leave);
    // rejouer le plan donne exactement le même résultat (déterminisme)
    const again = opt.sim.run(r.plan);
    assert.strictEqual(again.expected, r.expected);
    // un tank ne fait jamais de crabe
    if (chassis === 'tank') assert.ok(r.prims.every((p) => p.k !== 'move' || p.s === 0));
  });
}
