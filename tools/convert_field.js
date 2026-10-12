// Outil de développement (à lancer une seule fois) :
//   node tools/convert_field.js "chemin/vers/terrain.step"
// Lit le STEP officiel du terrain BIOBUZZ et produit :
//   data/field_mesh.js   -> maillage 3D allégé (sans visserie ni balles) pour la vue 3D
//   data/field_layout.js -> positions des éléments de jeu, utilisées par le simulateur
// Unités : pouces, origine au centre du terrain, Z vers le haut, côté rouge = x < 0.
'use strict';
const fs = require('fs');
const path = require('path');
const occtimportjs = require('occt-import-js');

const SKIP = /screw|rivet|nut|washer|bearing|cable tie|pin|spacer|plug|bolt|fhts|clip|strap|hinge|rivnut|fastener|panel link|pollen|nectar|under tile|foot bar|damper holder|axle holder/i;

function bbox(arr) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < arr.length; k += 3) {
    for (let a = 0; a < 3; a++) {
      if (arr[k + a] < mn[a]) mn[a] = arr[k + a];
      if (arr[k + a] > mx[a]) mx[a] = arr[k + a];
    }
  }
  return { mn, mx, c: mn.map((v, a) => (v + mx[a]) / 2) };
}

const r2 = (v) => Math.round(v * 100) / 100;

async function main() {
  const stepPath = process.argv[2];
  if (!stepPath) throw new Error('Usage: node tools/convert_field.js terrain.step');
  const occt = await occtimportjs();
  console.log('Lecture du STEP (quelques minutes)...');
  const res = occt.ReadStepFile(new Uint8Array(fs.readFileSync(stepPath)), {
    linearUnit: 'inch',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.01,
    angularDeflection: 0.6,
  });
  if (!res.success) throw new Error('Lecture STEP impossible');

  const parts = res.meshes.map((m) => ({
    name: m.name || '',
    color: m.color || [0.6, 0.6, 0.6],
    pos: m.attributes.position.array,
    idx: m.index.array,
    box: bbox(m.attributes.position.array),
  }));
  const named = (re) => parts.filter((p) => re.test(p.name));

  // ---------- Maillage allégé, regroupé par couleur ----------
  const groups = new Map();
  let tris = 0;
  for (const p of parts) {
    if (SKIP.test(p.name)) continue;
    const isTape = /gaffer tape/i.test(p.name);
    const key = p.color.map((c) => Math.round(c * 20)).join(',');
    if (!groups.has(key)) groups.set(key, { color: p.color, pos: [], idx: [] });
    const g = groups.get(key);
    const base = g.pos.length / 3;
    for (let k = 0; k < p.pos.length; k += 3) {
      g.pos.push(p.pos[k], p.pos[k + 1], p.pos[k + 2] + (isTape ? 0.08 : 0));
    }
    for (const i of p.idx) g.idx.push(i + base);
    tris += p.idx.length / 3;
  }
  const out = [];
  for (const g of groups.values()) {
    const q = new Int16Array(g.pos.length);
    for (let k = 0; k < g.pos.length; k++) q[k] = Math.round(g.pos[k] * 100);
    const idx = g.pos.length / 3 > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx);
    out.push({
      color: g.color.map((c) => r2(c)),
      idx32: idx instanceof Uint32Array,
      pos: Buffer.from(q.buffer).toString('base64'),
      idx: Buffer.from(idx.buffer).toString('base64'),
    });
  }
  const dataDir = path.join(__dirname, '..', 'data');
  fs.writeFileSync(
    path.join(dataDir, 'field_mesh.js'),
    '// Généré par tools/convert_field.js à partir du STEP officiel du terrain BIOBUZZ.\n' +
      '// Positions en centièmes de pouce (Int16), indices Uint16/Uint32, encodés en base64.\n' +
      'window.FIELD_MESH = ' + JSON.stringify({ scale: 0.01, groups: out }) + ';\n'
  );
  console.log(`field_mesh.js : ${out.length} groupes, ${tris} triangles`);

  // ---------- Positions des éléments de jeu ----------
  const balls = (re) => named(re).map((p) => ({ x: r2(p.box.c[0]), y: r2(p.box.c[1]), z: r2(p.box.c[2]) }));
  const pollen = balls(/pollen/i);
  const redNectar = balls(/red nectar/i);
  const blueNectar = balls(/blue nectar/i);
  const glass = named(/side glass/i);
  const half = r2(Math.min(...glass.map((g) => Math.max(Math.abs(g.box.c[0]), Math.abs(g.box.c[1])))) - 0.12);

  const flowers = named(/flower layer c/i).map((p) => {
    const c = p.box.c;
    // normale vers l'intérieur du terrain (opposée au mur le plus proche)
    const n = Math.abs(c[0]) > Math.abs(c[1]) ? [-Math.sign(c[0]), 0] : [0, -Math.sign(c[1])];
    return { x: r2(c[0]), y: r2(c[1]), r: r2((p.box.mx[0] - p.box.mn[0]) / 2), topZ: 21.5, nx: n[0], ny: n[1],
      alliance: c[0] < 0 ? 'red' : 'blue' };
  });
  const insideField = (b) => Math.abs(b.x) < half && Math.abs(b.y) < half;
  for (const f of flowers) {
    f.pollen = pollen.filter((b) => Math.hypot(b.x - f.x, b.y - f.y) < 3).length;
  }

  const tapes = named(/gaffer tape/i).filter((p) => Math.abs(p.box.c[0]) < half);
  const zoneOf = (color, test) => {
    const ts = tapes.filter((p) => new RegExp(color, 'i').test(p.name) && test(p));
    const mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
    for (const t of ts) for (let a = 0; a < 2; a++) { mn[a] = Math.min(mn[a], t.box.mn[a]); mx[a] = Math.max(mx[a], t.box.mx[a]); }
    // la zone s'étend jusqu'au mur
    for (let a = 0; a < 2; a++) {
      if (mn[a] < -half + 2) mn[a] = -half;
      if (mx[a] > half - 2) mx[a] = half;
    }
    return { x0: r2(mn[0]), y0: r2(mn[1]), x1: r2(mx[0]), y1: r2(mx[1]) };
  };
  const loading = {
    red: zoneOf('red', (p) => /11in|20\.69in/.test(p.name)),
    blue: zoneOf('blue', (p) => /11in|20\.69in/.test(p.name)),
  };
  const garden = {
    red: zoneOf('red', (p) => /22\.69in/.test(p.name)),
    blue: zoneOf('blue', (p) => /22\.69in/.test(p.name)),
  };
  const gardenPollen = (z) => pollen.filter((b) => insideField(b) && b.x >= z.x0 - 2 && b.x <= z.x1 + 2 && b.y >= z.y0 - 3 && b.y <= z.y1 + 3);

  // HIVE : pieds du châssis en A et sommet
  const feet = named(/frame foot/i).map((p) => ({ x: r2(p.box.c[0]), y: r2(p.box.c[1]) }));
  const legs = named(/a-frame leg/i).map((p) => p.box);
  const legMinAbsX = Math.min(...legs.map((b) => Math.min(Math.abs(b.mn[0]), Math.abs(b.mx[0]))));
  const legMaxAbsX = Math.max(...legs.map((b) => Math.max(Math.abs(b.mn[0]), Math.abs(b.mx[0]))));
  const legMaxAbsY = Math.max(...legs.map((b) => Math.max(Math.abs(b.mn[1]), Math.abs(b.mx[1]))));
  const cellCenters = (color) => {
    const skins = named(new RegExp('hive goal top skin', 'i')).filter((p) => (color === 'red' ? p.box.c[0] < 0 : p.box.c[0] > 0));
    return skins.map((p) => ({ x: r2(p.box.c[0]), y: r2(p.box.c[1]), z: r2(p.box.c[2]) }));
  };
  const nectarInCell = (arr) => arr.filter((b) => b.z > 20);
  const cells = {};
  for (const color of ['red', 'blue']) {
    const nectar = nectarInCell(color === 'red' ? redNectar : blueNectar);
    const ny = nectar.reduce((s, b) => s + b.y, 0) / nectar.length;
    const cs = cellCenters(color).sort((a, b) => b.z - a.z); // la plus haute = vers le haut
    // cible de tir = ouverture de la CELL vers le haut ; l'autre = position après bascule
    const up = cs[0], down = cs[1];
    cells[color] = {
      up: { x: up.x, y: r2((up.y + ny) / 2), z: r2(up.z - 4) },
      // après une bascule, la CELL du bas remonte à la position symétrique (par rapport au pivot y=0)
      down: { x: down.x, y: r2(-((up.y + ny) / 2)), z: r2(up.z - 4) },
      startNectar: nectar.length,
    };
  }

  const layout = {
    source: path.basename(stepPath),
    units: 'inch',
    half,
    tile: 24,
    flowers,
    loadingZone: loading,
    garden,
    gardenPollen: { red: gardenPollen(garden.red).length, blue: gardenPollen(garden.blue).length },
    gardenBalls: { red: gardenPollen(garden.red), blue: gardenPollen(garden.blue) },
    hive: {
      feet,
      // empreinte au sol d'un châssis en A (vue de dessus) : triangle pieds / sommet
      redFrame: [[-r2(legMaxAbsX), -r2(legMaxAbsY)], [-r2(legMaxAbsX), r2(legMaxAbsY)], [-r2(legMinAbsX), 0]],
      blueFrame: [[r2(legMaxAbsX), r2(legMaxAbsY)], [r2(legMaxAbsX), -r2(legMaxAbsY)], [r2(legMinAbsX), 0]],
      pivotZ: 43.95,
      cells,
    },
    pollenOnField: pollen.filter(insideField),
    nectar: { red: redNectar, blue: blueNectar },
  };
  fs.writeFileSync(
    path.join(dataDir, 'field_layout.js'),
    '// Généré par tools/convert_field.js à partir du STEP officiel du terrain BIOBUZZ.\n' +
      '// Pouces, origine au centre du terrain, x < 0 = côté ROUGE (colonnes A-C), y vers le mur arrière.\n' +
      '(function (root) {\n  var FIELD = ' + JSON.stringify(layout, null, 2).replace(/\n/g, '\n  ') + ';\n' +
      "  if (typeof module !== 'undefined' && module.exports) module.exports = FIELD; else root.FIELD = FIELD;\n" +
      "})(typeof window !== 'undefined' ? window : globalThis);\n"
  );
  console.log('field_layout.js écrit');
  console.log(JSON.stringify({ half, flowers, loading, garden, cells, feet }, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
