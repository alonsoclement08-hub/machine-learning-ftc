'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { BZ, FIELD } = require('./load');

function setup(gameOver) {
  const robot = BZ.defaultRobot();
  const game = Object.assign(BZ.defaultGame(), { seuilBascule: 6, poidsNectar: 1, tableBascule: null }, gameOver || {});
  const rd = BZ.robotDerived(robot);
  const world = BZ.buildWorld(FIELD, game, rd);
  const planner = new BZ.Planner(world, 2);
  return { robot, game, world, sim: new BZ.Sim(world, planner, robot, game) };
}
const frontStart = (world) => BZ.legalStarts(world, 3).find((s) => s.y < -20 && Math.abs(s.x + world.half - world.rd.hl) < 0.1);

test('HIVE articulée : pivot et angle de bascule (~60°) issus du CAD', () => {
  assert.ok(Math.abs(FIELD.hive.pivot.z - 43.95) < 0.2);
  assert.ok(Math.abs(Math.abs(FIELD.hive.tipAngle.red) - Math.PI / 3) < 0.05);
  assert.strictEqual(Math.sign(FIELD.hive.tipAngle.red), -Math.sign(FIELD.hive.tipAngle.blue));
});

test('NECTAR de départ réglable : avec 4 NECTAR, bascule dès la 2e balle', () => {
  const { sim, world, robot, game } = setup({ nectarDepart: 4 });
  assert.strictEqual(world.startNectar, 4);
  const res = sim.run({ start: frontStart(world), actions: [{ type: 'tir', x: -40, y: -45 }], park: { on: false, t: 0 } });
  const oc = BZ.shotOutcomes(res, world, robot, game, null);
  assert.ok(oc.tips.length >= 1);
  assert.ok(Math.abs(oc.tips[0] - (res.shots[1].t + BZ.FLIGHT)) < 1e-9, 'la bascule arrive quand la 2e balle entre');
});

test('on ne marque que par l\'ouverture de la CELL (pas en tirant de derrière)', () => {
  const { world, robot } = setup();
  const c = world.cellTargets[0]; // CELL du haut au départ (rouge : ouverte vers le public, y < 0)
  const aim = (x, y) => Math.atan2(c.y - y, c.x - x);
  assert.ok(BZ.hitProb(world, robot, -14, -60, aim(-14, -60), c) > 0, 'devant : OK');
  assert.strictEqual(BZ.hitProb(world, robot, -14, 50, aim(-14, 50), c), 0, 'derrière : la balle tape le dessus');
  // après bascule, c'est l'inverse
  const c1 = world.cellTargets[1];
  assert.ok(BZ.hitProb(world, robot, -14, 60, Math.atan2(c1.y - 60, c1.x + 14), c1) > 0);
});

test('arc de tir : passe au-dessus de l\'ouverture et finit dans la CELL', () => {
  const cell = FIELD.hive.cells.red.states[0];
  const A = { x: -14, y: -60, z: 16 }, B = cell.slots[3];
  const end = BZ.shotArc(A, B, 1);
  assert.ok(Math.abs(end.x - B.x) < 1e-9 && Math.abs(end.y - B.y) < 1e-9 && Math.abs(end.z - B.z) < 1e-9);
  // au moment où la balle passe au-dessus de l'ouverture (même y), elle est plus haut que le bord
  let best = null;
  for (let u = 0; u <= 1; u += 0.01) { const p = BZ.shotArc(A, B, u); if (!best || Math.abs(p.y - cell.open.y) < Math.abs(best.y - cell.open.y)) best = p; }
  assert.ok(best.z > cell.open.z, `z=${best.z} au-dessus de ${cell.open.z}`);
});

test('scène HIVE : la HIVE tourne, les balles de l\'ancienne CELL tombent au sol', () => {
  const { sim, world, robot, game } = setup();
  const res = sim.run({ start: frontStart(world), actions: [{ type: 'tir', x: -40, y: -45 }], park: { on: false, t: 0 } });
  const outcomes = BZ.shotOutcomes(res, world, robot, game, null);
  assert.strictEqual(outcomes.tips.length, 1);
  const st = { alliance: 'red', world, game, robot, outcomes, result: res };
  const before = BZ.hiveScene(FIELD, st, outcomes.tips[0] - 0.01);
  const after = BZ.hiveScene(FIELD, st, outcomes.tips[0] + 2);
  assert.strictEqual(before.angle.red, 0);
  assert.ok(Math.abs(after.angle.red - FIELD.hive.tipAngle.red) < 1e-9);
  const onFloor = after.balls.filter((b) => b.z < 3 && !b.miss);
  assert.ok(onFloor.length >= game.seuilBascule, 'les balles de la CELL basculée sont au sol');
  assert.strictEqual(after.upState, 1);
});

test('modèle 3D : rotations de 90° et dimensions', () => {
  // pavé 30 x 20 x 10 cm (8 sommets, 12 triangles)
  const pos = new Float32Array([0, 0, 0, 30, 0, 0, 30, 20, 0, 0, 20, 0, 0, 0, 10, 30, 0, 10, 30, 20, 10, 0, 20, 10]);
  const idx = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  const m = { name: 'pave', meshes: [{ pos, idx, color: [1, 0, 0] }] };
  m.rot = BZ.guessRotation(m);
  let d = BZ.robotModelDims(m);
  assert.deepStrictEqual([d.longueur, d.largeur, d.hauteur].map(Math.round), [30, 20, 10]);
  BZ.rotateModel(m, 'z', 1);
  d = BZ.robotModelDims(m);
  assert.deepStrictEqual([d.longueur, d.largeur, d.hauteur].map(Math.round), [20, 30, 10]);
  BZ.rotateModel(m, 'x', 1);
  d = BZ.robotModelDims(m);
  assert.deepStrictEqual([d.longueur, d.largeur, d.hauteur].map(Math.round), [20, 10, 30]);
  // fichier exporté "Y en haut" (Inventor) : deviné automatiquement
  const posY = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) { posY[i] = pos[i]; posY[i + 1] = pos[i + 2]; posY[i + 2] = pos[i + 1]; }
  const mY = { meshes: [{ pos: posY, idx, color: [1, 0, 0] }] };
  mY.rot = BZ.guessRotation(mY);
  d = BZ.robotModelDims(mY);
  assert.strictEqual(Math.round(d.hauteur), 10);
});

// ---------- STL ----------
function boxTris(L, W, H) {
  const v = [[0, 0, 0], [L, 0, 0], [L, W, 0], [0, W, 0], [0, 0, H], [L, 0, H], [L, W, H], [0, W, H]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.map((t) => t.map((i) => v[i]));
}
function binaryStl(L, W, H) {
  const tris = boxTris(L, W, H);
  const buf = new ArrayBuffer(84 + 50 * tris.length);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((p, k) => p.forEach((c, a) => dv.setFloat32(84 + i * 50 + 12 + k * 12 + a * 4, c, true))));
  return buf;
}
function asciiStl(L, W, H) {
  const s = 'solid pave\n' + boxTris(L, W, H).map((t) => ' facet normal 0 0 0\n  outer loop\n' +
    t.map((p) => `   vertex ${p[0]} ${p[1]} ${p[2]}\n`).join('') + '  endloop\n endfacet\n').join('') + 'endsolid pave\n';
  return new TextEncoder().encode(s).buffer;
}
const dims = (m) => { const d = BZ.robotModelDims(m); return [d.longueur, d.largeur, d.hauteur].map((v) => Math.round(v * 10) / 10); };

test('STL binaire : lu, unité mm devinée, dimensions en cm', () => {
  const m = BZ.stlModel('robot.stl', binaryStl(400, 300, 200));
  assert.strictEqual(m.unit, 'mm');
  assert.strictEqual(m.tris, 12);
  assert.deepStrictEqual(dims(m), [40, 30, 20]);
  BZ.setModelUnit(m, 'cm');
  assert.deepStrictEqual(dims(m), [400, 300, 200]);
});

test('STL ASCII : lu correctement', () => {
  const m = BZ.stlModel('robot.stl', asciiStl(300, 300, 300));
  assert.strictEqual(m.tris, 12);
  assert.deepStrictEqual(dims(m), [30, 30, 30]);
});

test('format inconnu ou faux STEP : erreur immédiate (pas de chargement infini)', async () => {
  const fake = (name, text) => ({ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
  await assert.rejects(BZ.readRobotFile(fake('robot.obj', 'o cube')), /non reconnu/);
  await assert.rejects(BZ.readRobotFile(fake('robot.step', 'solid nope')), /pas un vrai STEP/);
  const m = await BZ.readRobotFile({ name: 'r.STL', arrayBuffer: async () => binaryStl(450, 450, 400) });
  assert.deepStrictEqual(dims(m), [45, 45, 40]);
});

test('le code du worker STEP est du JavaScript valide (sinon : repli qui fige la page)', () => {
  assert.ok(BZ._workerCode && BZ._workerCode.length > 100);
  // eslint-disable-next-line no-new-func
  assert.doesNotThrow(() => new Function(BZ._workerCode));
});

test('tir partiel : on peut garder des balles pour plus tard', () => {
  const { sim, world } = setup();
  const res = sim.run({ start: frontStart(world), actions: [{ type: 'tir', x: -40, y: -45, n: 3 }, { type: 'tir', x: -20, y: 50 }], park: { on: false, t: 0 } });
  const feeds = res.prims.filter((p) => p.k === 'feed').map((p) => p.n);
  // 3 balles (3 NECTAR + 3 = bascule), la 4e est gardée et tirée de l'autre côté de la HIVE
  assert.deepStrictEqual(feeds, [3, 1]);
  assert.ok(res.shots[3].y > 0, 'dernier tir depuis l\'autre côté de la HIVE');
});

test('balles de marge : tirer plus que nécessaire dans la même CELL rend la bascule plus sûre', () => {
  const { sim, world } = setup();
  const start = frontStart(world);
  const juste = sim.run({ start, actions: [{ type: 'tir', x: -40, y: -45, n: 3 }], park: { on: false, t: 0 } });
  const marge = sim.run({ start, actions: [{ type: 'tir', x: -40, y: -45 }], park: { on: false, t: 0 } });
  assert.strictEqual(marge.shots.length, 4);
  assert.ok(marge.tipsAtLeast[1] > juste.tipsAtLeast[1] + 0.05, `${marge.tipsAtLeast[1]} > ${juste.tipsAtLeast[1]}`);
});

test('NECTAR plus lourds : 3 NECTAR (poids 1,67) + 3 POLLEN font basculer une CELL de 8', () => {
  const { sim, world, robot, game } = setup({ seuilBascule: 8, poidsNectar: 1.67 });
  assert.ok(Math.abs(world.startFill - 5.01) < 1e-9);
  const res = sim.run({ start: frontStart(world), actions: [{ type: 'tir', x: -40, y: -45, n: 3 }], park: { on: false, t: 0 } });
  const out = BZ.shotOutcomes(res, world, robot, game, null);
  assert.strictEqual(out.tips.length, 1);
  assert.ok(Math.abs(out.tips[0] - res.shots[2].tArr) < 1e-9 || Math.abs(out.tips[0] - (res.shots[2].t + BZ.FLIGHT)) < 1e-9);
  // ensuite il faut 8 POLLEN pour la bascule suivante
  const scene = BZ.hiveScene(FIELD, { alliance: 'red', world, game, robot, outcomes: out, result: res }, 29);
  assert.strictEqual(scene.pollen, 0);
});

test('précision : meilleure en face de l\'ouverture à la distance idéale qu\'en biais ou trop loin', () => {
  const { world, robot } = setup();
  const c = world.cellTargets[0];
  const p = (x, y) => BZ.hitProb(world, robot, x, y, Math.atan2(c.y - y, c.x - x), c);
  const ideal = world.rd.tirIdeal;
  const face = p(c.x, c.y - ideal);
  const biais = p(c.x - ideal * 0.8, c.y - ideal * 0.6);
  const loin = p(c.x, c.y - world.rd.tirMax + 1);
  assert.ok(face > biais && face > loin, `face ${face} biais ${biais} loin ${loin}`);
});

test('reproductible : un plan rejoué avec un simulateur neuf donne le même score', () => {
  const robot = BZ.defaultRobot();
  const opt = new BZ.Optimizer(FIELD, robot, BZ.defaultGame(), { seed: 11, popSize: 40 });
  for (let i = 0; i < 20; i++) opt.step();
  const r = opt.bestResult();
  const fresh = new BZ.Optimizer(FIELD, robot, BZ.defaultGame(), { seed: 99, popSize: 2 });
  const again = fresh.sim.run(r.plan);
  assert.strictEqual(again.shots.length, r.shots.length);
  assert.ok(Math.abs(again.expected - r.expected) < 1e-9, `${again.expected} vs ${r.expected}`);
});
