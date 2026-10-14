// Entraînement long, sans navigateur (utilisé par GitHub Actions, ou en local avec Node) :
//   node tools/train_cli.js [config.json] [minutes]
// Lit la config exportée par l'appli (robot + match), fait tourner l'algorithme génétique avec
// plusieurs redémarrages pendant le temps demandé, et écrit dans entrainement/ :
//   resultat.json, AutoBiobuzzIA.java, AutoBiobuzzIA.blk, rapport.md
// et data/cloud_result.js (chargé automatiquement par l'appli au démarrage).
// Les fichiers sont réécrits régulièrement : si l'entraînement est coupé, on garde le meilleur.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['geometry', 'robot', 'rules', 'planner', 'sim', 'hive_scene', 'optimizer', 'export_java', 'export_blockly']) {
  require(path.join(ROOT, 'js', f + '.js'));
}
const BZ = globalThis.BZ;
const FIELD = require(path.join(ROOT, 'data', 'field_layout.js'));

const cfgPath = path.resolve(process.argv[2] || path.join(ROOT, 'entrainement', 'config.json'));
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const MAX = parseFloat(process.env.MAX_MINUTES || '0') || Infinity; // GitHub : un job dure 6 h max
const minutes = Math.min(MAX, Math.max(0.1, parseFloat(process.argv[3] || cfg.minutes || 60)));
const OUT = path.join(ROOT, 'entrainement');
fs.mkdirSync(OUT, { recursive: true });

const merge = (def, obj) => {
  if (!obj || typeof obj !== 'object') return def;
  for (const k of Object.keys(def)) {
    if (def[k] && typeof def[k] === 'object' && !Array.isArray(def[k])) def[k] = merge(def[k], obj[k]);
    else if (obj[k] !== undefined) def[k] = obj[k];
  }
  return def;
};
const robot = merge(BZ.defaultRobot(), cfg.robot);
const game = merge(BZ.defaultGame(), cfg.game);
game.zonePartenaire = (cfg.game && cfg.game.zonePartenaire) || null;
game.departImpose = (cfg.game && cfg.game.departImpose) || null;

const t0 = Date.now();
const deadline = t0 + minutes * 60000;
let best = null, bestOpt = null, runs = 0, gens = 0, evals = 0;
const history = [];

function save(final) {
  if (!best) return;
  const world = bestOpt.world;
  const startText = BZ.describeStart(world, best.plan.start, robot);
  const summary = {
    version: 1,
    date: new Date().toISOString(),
    termine: !!final,
    minutes: Math.round((Date.now() - t0) / 600) / 100,
    essais: runs, generations: gens, strategiesTestees: evals,
    score: best.expected, bascules: best.eTips, basculesMax: best.nominalTips,
    duree: best.endT, leave: best.leave, park: best.park,
    fautes: best.faults.map((f) => f.rule),
    plan: best.plan, robot, game, departTexte: startText, historique: history,
  };
  fs.writeFileSync(path.join(OUT, 'resultat.json'), JSON.stringify(summary, null, 1));
  fs.writeFileSync(path.join(OUT, 'AutoBiobuzzIA.java'), BZ.exportJava(best, robot, { startText }));
  fs.writeFileSync(path.join(OUT, 'AutoBiobuzzIA.blk'), BZ.exportBlockly(best, robot, { startText }));
  fs.writeFileSync(path.join(ROOT, 'data', 'cloud_result.js'),
    '// Résultat du dernier entraînement dans le cloud (généré par tools/train_cli.js).\n' +
    'window.CLOUD_RESULT = ' + JSON.stringify(summary) + ';\n');
  const lines = [
    `# Résultat de l'entraînement`, '',
    `- Date : ${summary.date}${final ? '' : ' (en cours)'}`,
    `- Durée d'entraînement : ${summary.minutes} min · ${runs} essais · ${gens} générations · ${evals} stratégies testées`,
    `- **Score AUTO espéré : ${best.expected.toFixed(1)} pts** (LEAVE ${best.leave ? 'oui' : 'non'}, PARK ${best.park ? 'oui' : 'non'}, bascules espérées ${best.eTips.toFixed(2)} / max ${best.nominalTips})`,
    `- Durée du plan : ${best.endT.toFixed(1)} s · Fautes : ${best.faults.length ? best.faults.map((f) => f.rule).join(', ') : 'aucune'}`,
    '', '## Placement de départ', ...startText.map((s) => '- ' + s), '',
    '## Étapes', ...best.prims.filter((p) => p.label).map((p) => `- ${p.t0.toFixed(1)} s : ${p.label}`),
  ];
  fs.writeFileSync(path.join(OUT, 'rapport.md'), lines.join('\n') + '\n');
}

let lastSave = Date.now();
console.log(`Entraînement pendant ${minutes} min (robot « ${robot.nom} », ${robot.chassis})`);
while (Date.now() < deadline) {
  // un "essai" = une population neuve (graine différente) qui hérite du meilleur plan trouvé
  const opt = new BZ.Optimizer(FIELD, robot, game, { seed: 1000 + runs * 7919, popSize: 90 });
  if (best) opt.addPlan(best.plan);
  runs++;
  let stall = 0, lastBest = -Infinity;
  while (Date.now() < deadline && stall < 120) {
    opt.step();
    gens++;
    const f = opt.best.result.fitness;
    if (f > lastBest + 1e-6) { lastBest = f; stall = 0; } else stall++;
    if (Date.now() - lastSave > 60000) { lastSave = Date.now(); if (best) save(false); }
  }
  evals += opt.evals;
  const r = opt.bestResult();
  if (r && (!best || r.fitness > best.fitness)) {
    best = r; bestOpt = opt;
    history.push({ minute: Math.round((Date.now() - t0) / 6000) / 10, score: Math.round(r.expected * 100) / 100 });
    console.log(`[${((Date.now() - t0) / 60000).toFixed(1)} min] essai ${runs} : nouveau meilleur score ${r.expected.toFixed(2)} pts (${r.faults.length} faute(s))`);
    save(false);
  }
}
save(true);
console.log(`Terminé : ${runs} essais, ${gens} générations, meilleur score ${best ? best.expected.toFixed(2) : '-'} pts`);
