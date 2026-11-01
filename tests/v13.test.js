// v13 : outils de l'assistant IA (sans réseau : on appelle directement les outils).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { BZ, FIELD } = require('./load.js');
require('../js/assistant.js');

function fakeApp() {
  const robot = BZ.defaultRobot(), game = BZ.defaultGame();
  const world = BZ.buildWorld(FIELD, game, BZ.robotDerived(robot));
  const sim = new BZ.Sim(world, new BZ.Planner(world, 2), robot, game);
  const start = BZ.legalStarts(world, 6).find((s) => Math.abs(s.h) < 1e-6);
  const log = { plans: [], settings: [] };
  const plan = { start, startLock: true, actions: [{ type: 'tir', x: -40, y: -45 }], park: { on: true, t: 0.5 } };
  const app = {
    world: () => world, robot: () => robot, plan: () => plan, simulate: (p) => sim.run(p),
    settings: () => ({ ok: 1 }), context: () => ({}),
    proposePlan: (p, why, r) => log.plans.push({ p, why, r }), proposeSettings: (c, why) => log.settings.push({ c, why }),
    optimize: (o) => { log.opt = o; return { statut: 'lancée' }; },
    launchSession: async (nom, minutes) => { log.sess = { nom, minutes }; return { statut: 'lancée' }; },
    listSessions: async () => { throw new Error('GitHub n\'est pas connecté'); },
    keepAiPlan: (g) => { log.keep = g; return { statut: 'ok' }; }, stopOptimization: () => ({ statut: 'arrêtée' }), setModel: (m) => ({ modele: m }),
  };
  return { app, log, start, world };
}

test('outils : simuler, proposer un plan, refuser un plan invalide', () => {
  const { app, log, start } = fakeApp();
  const as = new BZ.Assistant(app);
  const plan = { etapes: [{ type: 'tir', x: -40, y: -45, n: 3 }, { type: 'ramasse', src: 'fleur1' }, { type: 'tir', x: -35, y: 55, courbe: [-55, 10] }], park: { on: true, t: 0.5 } };
  const r = as.runTool('simuler_plan', { plan });
  assert.ok(!r.is_error, r.content);
  const sum = JSON.parse(r.content);
  assert.ok(sum.score_espere > 0 && sum.etapes.length === 3);
  const p = as.runTool('proposer_plan', { plan, explication: 'test' });
  assert.ok(!p.is_error, p.content);
  assert.strictEqual(log.plans.length, 1);
  assert.deepStrictEqual(log.plans[0].p.actions[2].ctrl, [-55, 10]);
  assert.deepStrictEqual(log.plans[0].p.start, start, 'départ verrouillé gardé');
  for (const bad of [{ etapes: [{ type: 'tir', x: 30, y: 0 }] }, { etapes: [{ type: 'vole' }] }, { etapes: [{ type: 'ramasse', src: 'lune' }] }, { etapes: 'non' }, null]) {
    const e = as.runTool('simuler_plan', { plan: bad });
    assert.ok(e.is_error && /^Erreur/.test(e.content), JSON.stringify(bad));
  }
  assert.ok(as.runTool('proposer_plan', { plan }).is_error, 'explication obligatoire');
});

test('outils : réglages autorisés seulement, valeurs vérifiées', () => {
  const { app, log } = fakeApp();
  const as = new BZ.Assistant(app);
  const ok = as.runTool('modifier_reglages', { changements: [{ chemin: 'robot.lanceur.precision', valeur: 0.95 }, { chemin: 'match.tableBascule', valeur: [8, 7, 6, 3, 1, 0] }, { chemin: 'robot.intake.nectar', valeur: true }], explication: 'mesuré' });
  assert.ok(!ok.is_error, ok.content);
  assert.strictEqual(log.settings[0].c.length, 3);
  for (const bad of [[{ chemin: 'robot.moteurs.lanceur', valeur: 'x' }], [{ chemin: 'robot.lanceur.precision', valeur: 3 }], [{ chemin: 'robot.chassis', valeur: 'hovercraft' }], [{ chemin: 'match.tableBascule', valeur: [1, 2] }], []]) {
    const e = as.runTool('modifier_reglages', { changements: bad, explication: 'x' });
    assert.ok(e.is_error, JSON.stringify(bad));
  }
  assert.strictEqual(log.settings.length, 1);
});

test('outils : schémas JSON des outils bien formés', () => {
  for (const t of BZ.CHAT_TOOLS) {
    assert.strictEqual(t.parameters.type, 'object');
    assert.ok(!JSON.stringify(t.parameters).includes('$ref'), t.name);
    assert.ok(t.description.length > 20);
  }
  const plan = BZ.planToTool({ start: { x: -60, y: -40, h: Math.PI / 2 }, actions: [{ type: 'tir', x: -40, y: -45, n: 2, ctrl: [-50, -50] }], park: { on: true, t: 0.3 } });
  assert.deepStrictEqual(plan.depart, { x: -60, y: -40, cap_deg: 90, verrouille: false });
  assert.deepStrictEqual(plan.etapes[0], { type: 'tir', x: -40, y: -45, n: 2, courbe: [-50, -50] });
});

test('outils : optimisation et sessions cloud pilotées par le chat', async () => {
  const { app, log } = fakeApp();
  const as = new BZ.Assistant(app);
  assert.ok(!as.runTool('optimiser_plan', {}).is_error);
  assert.deepStrictEqual(log.opt, { generations: 300, keepOrder: true });
  assert.ok(!as.runTool('optimiser_plan', { generations: 800, garder_ordre: false }).is_error);
  assert.deepStrictEqual(log.opt, { generations: 800, keepOrder: false });
  assert.ok(as.runTool('optimiser_plan', { generations: 3 }).is_error);
  const ok = await as.runTool('lancer_session_cloud', { nom: 'essai', minutes: 120 });
  assert.ok(!ok.is_error, ok.content);
  assert.deepStrictEqual(log.sess, { nom: 'essai', minutes: 120 });
  assert.ok((await as.runTool('lancer_session_cloud', { minutes: 900 })).is_error);
  const ls = await as.runTool('lister_sessions', {});
  assert.ok(ls.is_error && /GitHub/.test(ls.content), 'erreur lisible sans GitHub');
  assert.ok(as.runTool('charger_session', {}).is_error, 'id obligatoire');
  assert.ok(!as.runTool('garder_plan_ia', { garder: true }).is_error);
  assert.strictEqual(log.keep, true);
  assert.ok(as.runTool('garder_plan_ia', {}).is_error);
});

test('réglages : une valeur envoyée en texte JSON est acceptée', () => {
  const { app, log } = fakeApp();
  const as = new BZ.Assistant(app);
  const r = as.runTool('modifier_reglages', { changements: [{ chemin: 'robot.lanceur.precision', valeur: '0.9' }, { chemin: 'robot.chassis', valeur: 'tank' }], explication: 'x' });
  assert.ok(!r.is_error, r.content);
  assert.strictEqual(log.settings[0].c[0].valeur, 0.9);
});

test('liste des outils du chat', () => {
  assert.deepStrictEqual(BZ.CHAT_TOOLS.map((t) => t.name).sort(), ['arreter_optimisation', 'arreter_session', 'changer_modele', 'charger_session', 'garder_plan_ia', 'lancer_session_cloud', 'lire_reglages', 'lister_sessions', 'modifier_reglages', 'optimiser_plan', 'proposer_plan', 'simuler_plan']);
});
