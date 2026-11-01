// Assistant IA (page 2) : discussion avec Gemini (API Google, appelée directement en fetch).
// Gemini voit les réglages, le plan dessiné et son résultat simulé ; il peut simuler des variantes,
// proposer un plan ou des réglages, lancer l'optimisation et proposer une session dans le cloud :
// l'équipe décide avec les boutons « Appliquer » / « Lancer ».
// La clé API reste dans ce navigateur et part directement vers l'API Gemini de Google.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};
  const G = BZ.G;

  // Modèles proposés avant la connexion ; avec une clé, la liste vient de l'API (BZ.geminiModels).
  BZ.CHAT_MODELS = [
    { id: 'gemini-2.5-flash', nom: 'Gemini 2.5 Flash (rapide, recommandé)' },
    { id: 'gemini-2.5-pro', nom: 'Gemini 2.5 Pro (le plus fort)' },
    { id: 'gemini-2.5-flash-lite', nom: 'Gemini 2.5 Flash-Lite (le moins cher)' },
  ];
  const API = 'https://generativelanguage.googleapis.com/v1beta';

  // Réglages que l'IA a le droit de proposer de changer.
  BZ.CHAT_SETTINGS = {
    'robot.chassis': ['mecanum', 'tank'],
    'robot.deplacement': ['chrono', 'odometrie'],
    'robot.msParMetre': [100, 10000], 'robot.msPour180': [100, 10000], 'robot.puissanceTir': [0, 1],
    'robot.facteurCrabe': [0.3, 1.2], 'robot.pauseMs': [0, 2000],
    'robot.odo.vMax_cm_s': [20, 400], 'robot.odo.accel_cm_s2': [20, 2000],
    'robot.lanceur.sens': ['avant', 'arriere'], 'robot.lanceur.precision': [0, 1],
    'robot.lanceur.distMin_cm': [0, 400], 'robot.lanceur.distMax_cm': [10, 400], 'robot.lanceur.distIdeale_cm': [10, 400],
    'robot.lanceur.monteeMs': [0, 5000], 'robot.lanceur.msParBalle': [50, 3000],
    'robot.intake.sens': ['avant', 'arriere'], 'robot.intake.msParBalle': [50, 3000],
    'robot.intake.sol': 'bool', 'robot.intake.fleur': 'bool', 'robot.intake.nectar': 'bool',
    'match.alliance': ['red', 'blue'], 'match.nectarDepart': [0, 10], 'match.margeSecurite': [0, 10],
    'match.viserPark': 'bool', 'match.nectarHumain': 'bool', 'match.delaiHumain_s': [0, 10],
    'match.tableBascule': 'table',
  };

  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

  // Plan de l'appli <-> plan des outils (cap en degrés, plus lisible pour l'IA).
  BZ.planToTool = function (plan) {
    return {
      depart: plan.start ? { x: r1(plan.start.x), y: r1(plan.start.y), cap_deg: Math.round(G.deg(plan.start.h)), verrouille: !!plan.startLock } : null,
      etapes: (plan.actions || []).map((a) => {
        const o = { type: a.type };
        if (a.type === 'ramasse') o.src = a.src; else { o.x = r1(a.x); o.y = r1(a.y); }
        if (a.type === 'tir' && a.n) o.n = a.n;
        if (a.ctrl) o.courbe = [r1(a.ctrl[0]), r1(a.ctrl[1])];
        if (a.zone) o.zone = a.zone;
        if (a.lock) o.verrouille = true;
        return o;
      }),
      park: plan.park && plan.park.on ? { on: true, t: r1(plan.park.t * 100) / 100 } : { on: false, t: 0.5 },
    };
  };
  const r1 = (v) => Math.round(v * 10) / 10;

  // Vérifie un plan proposé par l'IA et le convertit ; lève une erreur lisible sinon.
  BZ.planFromTool = function (p, current, world, robot) {
    if (!p || typeof p !== 'object') throw new Error('plan manquant');
    if (!Array.isArray(p.etapes)) throw new Error('"etapes" doit être une liste');
    if (p.etapes.length > 20) throw new Error('20 étapes au maximum');
    const num = (v, lo, hi, nom) => {
      if (typeof v !== 'number' || !isFinite(v)) throw new Error(`${nom} doit être un nombre`);
      if (v < lo || v > hi) throw new Error(`${nom} doit être entre ${lo} et ${hi}`);
      return v;
    };
    const half = world.half;
    const srcs = ['jardin', 'nectar'].concat(world.flowers.map((f) => f.id));
    const actions = p.etapes.map((e, i) => {
      if (!e || typeof e !== 'object') throw new Error(`étape ${i + 1} invalide`);
      const a = { type: e.type };
      if (e.type === 'ramasse') {
        if (srcs.indexOf(e.src) < 0) throw new Error(`étape ${i + 1} : src doit être ${srcs.join(', ')}`);
        a.src = e.src;
      } else if (e.type === 'tir' || e.type === 'via') {
        a.x = num(e.x, -half, 0, `étape ${i + 1} : x`);
        a.y = num(e.y, -half, half, `étape ${i + 1} : y`);
        if (e.type === 'tir' && e.n !== undefined && e.n !== null) a.n = Math.round(num(e.n, 1, 4, `étape ${i + 1} : n`));
      } else throw new Error(`étape ${i + 1} : type doit être "tir", "via" ou "ramasse"`);
      if (e.courbe !== undefined && e.courbe !== null) {
        if (!Array.isArray(e.courbe) || e.courbe.length !== 2) throw new Error(`étape ${i + 1} : courbe = [x, y]`);
        a.ctrl = [num(e.courbe[0], -half - 10, 10, 'courbe x'), num(e.courbe[1], -half - 10, half + 10, 'courbe y')];
      }
      if (typeof e.zone === 'string') a.zone = e.zone;
      if (e.verrouille) a.lock = true;
      return a;
    });
    let start = current.start, startLock = !!current.startLock;
    if (p.depart && !current.startLock) {
      const s = { x: num(p.depart.x, -half, 0, 'depart.x'), y: num(p.depart.y, -half, half, 'depart.y'), h: G.wrap(G.rad(num(p.depart.cap_deg, -360, 360, 'depart.cap_deg'))) };
      const errs = BZ.checkStart(world, s);
      if (errs.length) throw new Error('départ interdit (G304) : ' + errs.join(' ; '));
      start = s;
      startLock = !!p.depart.verrouille;
    }
    const park = p.park && p.park.on ? { on: true, t: Math.max(0, Math.min(1, +p.park.t || 0.5)) } : { on: false, t: 0.5 };
    return { start, startLock, actions, park };
  };

  // Vérifie une liste de changements de réglages.
  BZ.settingsFromTool = function (changes) {
    if (!Array.isArray(changes) || !changes.length) throw new Error('"changements" doit être une liste non vide');
    return changes.map((c) => {
      const rule = BZ.CHAT_SETTINGS[c && c.chemin];
      if (!rule) throw new Error(`réglage inconnu ou interdit : ${c && c.chemin}. Autorisés : ${Object.keys(BZ.CHAT_SETTINGS).join(', ')}`);
      let v = c.valeur;
      if (typeof v === 'string' && !(Array.isArray(rule) && typeof rule[0] === 'string')) { try { v = JSON.parse(v); } catch (e) { /* on garde le texte */ } }
      if (rule === 'bool') { if (typeof v !== 'boolean') throw new Error(`${c.chemin} : true ou false`); }
      else if (rule === 'table') {
        if (!Array.isArray(v) || v.length !== 6 || v.some((x) => typeof x !== 'number' || x < 0 || x > 20)) throw new Error(`${c.chemin} : 6 nombres entre 0 et 20`);
        v = v.map((x) => Math.round(x));
      } else if (typeof rule[0] === 'string') { if (rule.indexOf(v) < 0) throw new Error(`${c.chemin} : ${rule.join(' ou ')}`); }
      else if (typeof v !== 'number' || !isFinite(v) || v < rule[0] || v > rule[1]) throw new Error(`${c.chemin} : nombre entre ${rule[0]} et ${rule[1]}`);
      return { chemin: c.chemin, valeur: v };
    });
  };

  // Résumé d'un résultat simulé, pour l'IA.
  BZ.resultSummary = function (r) {
    if (!r) return null;
    return {
      score_espere: r1(r.expected), duree_s: r1(r.endT), bascules_esperees: Math.round(r.eTips * 100) / 100,
      chances_1_bascule: Math.round(r.tipsAtLeast[1] * 100) + ' %', chances_2_bascules: Math.round(r.tipsAtLeast[2] * 100) + ' %',
      chances_3_bascules: Math.round(r.tipsAtLeast[3] * 100) + ' %', leave: r.leave, park: r.park,
      fautes: r.faults.map((f) => `${f.rule} à ${f.t.toFixed(1)} s ${f.info || ''}`.trim()),
      etapes: (r.steps || []).map((s, i) => ({ etape: i + 1, faite: s.done, debut_s: r1(s.t0), fin_s: r1(s.t1) })),
      tirs: r.shots.map((s) => ({ t: r1(s.t), x: r1(s.x), y: r1(s.y), balle: s.kind || 'pollen' })),
    };
  };

  const TOOLS = [
    {
      name: 'simuler_plan',
      description: "Simule un plan d'AUTO avec le robot et les règles actuels et renvoie le score espéré, la durée, les chances de bascule, les fautes et le temps de chaque étape. Utilise-le pour tester tes idées AVANT de proposer quoi que ce soit. Ne modifie rien.",
      parameters: { type: 'object', properties: { plan: { $ref: '#/$defs/plan' } }, required: ['plan'], $defs: null },
    },
    {
      name: 'proposer_plan',
      description: "Propose un plan à l'équipe. L'appli le simule et affiche une carte avec le score avant/après et les boutons « Voir sur le terrain » et « Appliquer ». L'équipe décide ; ne dis pas que le plan est appliqué.",
      parameters: { type: 'object', properties: { plan: { $ref: '#/$defs/plan' }, explication: { type: 'string', description: 'Pourquoi ce plan est meilleur, en 1 à 3 phrases simples.' } }, required: ['plan', 'explication'], $defs: null },
    },
    {
      name: 'lire_reglages',
      description: 'Renvoie tous les réglages actuels du robot et du match (page 1 de l\'appli) et la liste des réglages modifiables.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'modifier_reglages',
      description: "Propose de changer des réglages du robot ou du match (page 1). L'appli affiche une carte avant/après avec « Appliquer » : l'équipe décide. Ne change que ce que l'équipe a mesuré ou demandé.",
      parameters: {
        type: 'object',
        properties: {
          changements: { type: 'array', items: { type: 'object', properties: { chemin: { type: 'string', description: 'ex. robot.lanceur.precision, match.tableBascule' }, valeur: { description: 'nombre, texte, booléen, ou liste de 6 nombres pour match.tableBascule' } }, required: ['chemin', 'valeur'] } },
          explication: { type: 'string' },
        },
        required: ['changements', 'explication'],
      },
    },
    {
      name: 'optimiser_plan',
      description: "Lance l'optimisation dans l'appli (algorithme génétique, sur cet ordinateur) à partir du plan dessiné : elle essaie des milliers de variantes (points de tir, courbes, nombre de balles, départ). Elle tourne en arrière-plan quelques secondes à quelques minutes ; le résultat s'affiche en aperçu sur le terrain avec « Garder ce plan ». Utilise-le quand l'équipe demande d'optimiser.",
      parameters: {
        type: 'object',
        properties: {
          generations: { type: 'integer', description: 'nombre de générations, de 10 à 5000 (300 par défaut, environ une minute)' },
          garder_ordre: { type: 'boolean', description: "true (défaut) : garder l'ordre et la nature des étapes et les étapes verrouillées" },
        },
      },
    },
    {
      name: 'arreter_optimisation',
      description: "Arrête l'optimisation en cours sur cet ordinateur (le meilleur plan trouvé reste en aperçu).",
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'garder_plan_ia',
      description: "Quand l'équipe a décidé : garder le plan trouvé par l'optimisation (garder = true, il remplace son plan) ou revenir à son plan (false). Ne l'appelle que sur une demande claire de l'équipe.",
      parameters: { type: 'object', properties: { garder: { type: 'boolean' } }, required: ['garder'] },
    },
    {
      name: 'lancer_session_cloud',
      description: "Lance tout de suite un entraînement long sur un serveur GitHub (la session continue même ordinateur éteint, 340 min au plus) avec le robot, le match et le plan actuels. Appelle-le quand l'équipe le demande ; demande la durée si elle n'est pas claire. Il faut que GitHub soit connecté : sinon l'outil renvoie une erreur et tu expliques comment coller le jeton dans le chat.",
      parameters: {
        type: 'object',
        properties: {
          nom: { type: 'string', description: 'nom court de la session, ex. « départ gauche 2 bascules »' },
          minutes: { type: 'integer', description: 'durée en minutes, de 5 à 340' },
        },
        required: ['minutes'],
      },
    },
    {
      name: 'lister_sessions',
      description: "Renvoie les sessions dans le cloud (nom, id, statut, avancement, meilleur score, bascules, fautes) et la meilleure. Utilise-le pour répondre à « où en sont mes sessions ? » ou avant de charger / arrêter une session.",
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'charger_session',
      description: "Charge le résultat d'une session dans l'appli (robot, match et meilleur plan de la session remplacent ceux de l'appli, visibles sur le terrain, code prêt dans la page Code). id = l'id donné par lister_sessions, ou \"meilleure\".",
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    {
      name: 'arreter_session',
      description: "Arrête une session en cours dans le cloud (son dernier point d'étape est gardé). Demande d'abord confirmation à l'équipe, puis appelle-le avec l'id de lister_sessions.",
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    {
      name: 'changer_modele',
      description: "Change le modèle Gemini utilisé par le chat (à partir du prochain message). Sans paramètre : renvoie la liste des modèles disponibles.",
      parameters: { type: 'object', properties: { modele: { type: 'string' } } },
    },
  ];
  const PLAN_SCHEMA = {
    type: 'object',
    properties: {
      depart: { type: 'object', description: "Pose de départ (ignorée si l'équipe l'a verrouillée). Collée à un mur de notre côté.", properties: { x: { type: 'number' }, y: { type: 'number' }, cap_deg: { type: 'number' }, verrouille: { type: 'boolean' } }, required: ['x', 'y', 'cap_deg'] },
      etapes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['tir', 'via', 'ramasse'] },
            x: { type: 'number' }, y: { type: 'number' },
            n: { type: 'integer', description: 'tir : nombre de balles (1 à 4), absent = toutes' },
            src: { type: 'string', description: 'ramasse : fleur0 (FLOWER A), fleur1 (FLOWER B), jardin (GARDEN), nectar (LOADING ZONE)' },
            courbe: { type: 'array', items: { type: 'number' }, description: 'point de contrôle [x, y] de la flèche qui arrive à cette étape (facultatif)' },
            zone: { type: 'string' }, verrouille: { type: 'boolean' },
          },
          required: ['type'],
        },
      },
      park: { type: 'object', properties: { on: { type: 'boolean' }, t: { type: 'number', description: '0 = bas de la LOADING ZONE, 1 = haut' } }, required: ['on'] },
    },
    required: ['etapes'],
  };
  // on remplace les références par le schéma du plan (le schéma reste simple et explicite)
  for (const t of TOOLS) {
    const props = t.parameters.properties;
    if (props.plan) props.plan = PLAN_SCHEMA;
    delete t.parameters.$defs;
  }
  BZ.CHAT_TOOLS = TOOLS;

  function systemPrompt(world) {
    const F = world.flowers.map((f) => `${f.nom} (src "${f.id}") au mur en (${r1(f.x)}, ${r1(f.y)}), 4 POLLEN, on la vide en se plaçant devant (${r1(f.frontX + f.nx * 12)}, ${r1(f.frontY + f.ny * 12)})`).join(' ; ');
    const z = world.loading;
    const c = world.cellTargets;
    return [
      "Tu es l'assistant d'une équipe FIRST Tech Challenge (lycéens) qui prépare l'AUTO de 30 s du jeu BIOBUZZ 2026-2027 dans l'appli « BIOBUZZ Auto IA ». Réponds en français simple et concret, sans jargon, en peu de mots.",
      "Ce que tu peux faire : expliquer le plan et son score, trouver pourquoi il perd du temps ou rate des bascules, simuler des variantes avec simuler_plan, puis proposer un plan (proposer_plan) ou des réglages (modifier_reglages). L'équipe décide : tes propositions s'affichent avec un bouton « Appliquer ». N'annonce jamais un score que le simulateur n'a pas donné. Teste toujours un plan avec simuler_plan avant de le proposer. Ne change un réglage du robot que s'il vient d'une mesure de l'équipe ou d'une demande claire.",
      "Tout se fait dans ce chat, en parlant : il n'y a pas d'autre écran pour l'optimisation ou les sessions. Optimisation : optimiser_plan lance l'algorithme génétique de l'appli sur cet ordinateur (il tourne en arrière-plan ; l'équipe voit l'aperçu sur le terrain et décide de le garder). quand elle se termine, l'appli t'envoie un message [Événement de l'appli] avec le résultat : annonce-le en 2 ou 3 phrases (score avant → après, bascules, fautes) et demande si l'équipe garde ce plan (garder_plan_ia). Sessions dans le cloud (serveur GitHub, jusqu'à 340 min, ordinateur éteint possible) : lancer_session_cloud la lance quand l'équipe le demande, lister_sessions donne leur état, charger_session charge un résultat, arreter_session arrête (après confirmation). Une session terminée t'est aussi annoncée par un [Événement de l'appli]. L'état de l'optimisation et des sessions est dans la situation envoyée avec chaque message.",
      "Clés et jetons : l'équipe colle sa clé Gemini ou son jeton GitHub (github_pat_…) SEUL dans un message du chat ; l'appli l'intercepte et le garde dans le navigateur, tu ne le vois jamais. Si GitHub n'est pas connecté, explique-le ainsi : créer un jeton sur github.com/settings/personal-access-tokens/new (dépôt machine-learning-ftc, permissions Actions et Contents en lecture et écriture) puis le coller seul dans le chat. Ne demande jamais de coller une clé avec d'autre texte.",
      "Repère (celui du simulateur, alliance rouge ; le même programme marche en bleu) : pouces, origine au centre du terrain, x vers la droite vu du public, y en s'éloignant du public, cap en degrés dans le sens trigonométrique (0° = vers +x, le centre du terrain). Notre côté : x entre -72 et 0 (passer x > 0 est une faute G402). Murs à ±72.",
      `HIVE au centre (x de -22 à 0, y de -19 à 19 : on ne la touche pas, on ne passe pas dessous). Au départ la CELL du haut s'ouvre vers les y négatifs : on tire depuis y < -17, cible (${r1(c[0].x)}, ${r1(c[0].y)}). Après une bascule, c'est l'autre CELL qui est en haut, ouverte vers les y positifs : on tire depuis y > 17, cible (${r1(c[1].x)}, ${r1(c[1].y)}). Tirer de derrière l'ouverture ne marque pas. La précision est meilleure bien en face de l'ouverture et à la distance idéale du lanceur.`,
      `Balles : 4 POLLEN préchargés dans le robot (capacité 4). ${F}. GARDEN (src "jardin") : 4 POLLEN le long du mur y = -71, près de x = -66. LOADING ZONE : x de ${r1(z.x0)} à ${r1(z.x1)}, y de ${r1(z.y0)} à ${r1(z.y1)} (PARK = finir en partie dedans ; après chaque bascule le joueur humain y pose 1 NECTAR, src "nectar", si l'option est cochée).`,
      'Bascule : la CELL du haut contient 3 NECTAR au départ ; elle bascule quand ses POLLEN atteignent la table de bascule (par défaut 0 NECTAR → 8 POLLEN, 1 → 7, 2 → 6, 3 → 3, 4 → 1). Après une bascule, la nouvelle CELL du haut repart de zéro. Points AUTO : LEAVE 3, PARK 5, chaque bascule 20. Les fautes coûtent des points et une sortie du terrain ou un choc avec la HIVE est interdite.',
      "Un plan = départ + étapes dans l'ordre : \"tir\" (le robot va en (x, y), vise la CELL qui fait face et tire n balles ou toutes), \"via\" (point de passage), \"ramasse\" (va devant la source et ramasse jusqu'à 4 balles au total), puis PARK facultatif. \"courbe\" = point de contrôle de la flèche qui arrive à l'étape. Les étapes \"verrouille\" et les zones de l'équipe doivent être respectées. Une étape impossible est sautée (indiqué dans le résultat).",
    ].join('\n\n');
  }

  function Assistant(app) {
    this.app = app; // { context(), simulate(plan) -> result, world(), robot(), settings(), proposePlan(plan, why, result), proposeSettings(changes, why) }
    this.messages = [];
    this.busy = false;
    this.abort = null;
  }

  Assistant.prototype.reset = function () { this.messages = []; };

  // Exécute un outil demandé par l'IA ; renvoie { content, is_error } (ou une promesse pour les outils GitHub).
  Assistant.prototype.runTool = function (name, input) {
    const app = this.app;
    try {
      if (!input || typeof input !== 'object') throw new Error('entrée invalide');
      if (name === 'lire_reglages') return { content: JSON.stringify(app.settings()) };
      if (name === 'simuler_plan' || name === 'proposer_plan') {
        const plan = BZ.planFromTool(input.plan, app.plan(), app.world(), app.robot());
        const r = app.simulate(plan);
        if (!r) throw new Error('simulation impossible');
        const sum = BZ.resultSummary(r);
        if (name === 'simuler_plan') return { content: JSON.stringify(sum) };
        if (typeof input.explication !== 'string') throw new Error('"explication" manquante');
        app.proposePlan(plan, input.explication, r);
        return { content: JSON.stringify({ statut: "proposé à l'équipe (carte avec Appliquer), en attente de sa décision", resultat: sum }) };
      }
      if (name === 'optimiser_plan') {
        const gens = input.generations === undefined ? 300 : Math.round(Number(input.generations));
        if (!isFinite(gens) || gens < 10 || gens > 5000) throw new Error('generations : entre 10 et 5000');
        const st = app.optimize({ generations: gens, keepOrder: input.garder_ordre !== false });
        return { content: JSON.stringify(st) };
      }
      if (name === 'arreter_optimisation') return { content: JSON.stringify(app.stopOptimization()) };
      if (name === 'garder_plan_ia') {
        if (typeof input.garder !== 'boolean') throw new Error('garder : true ou false');
        return { content: JSON.stringify(app.keepAiPlan(input.garder)) };
      }
      if (name === 'changer_modele') return { content: JSON.stringify(app.setModel(typeof input.modele === 'string' ? input.modele.trim() : '')) };
      // outils qui parlent à GitHub : réponse asynchrone
      const later = (fn) => Promise.resolve().then(fn).then((r) => ({ content: JSON.stringify(r) }), (e) => ({ content: 'Erreur : ' + (e.message || e), is_error: true }));
      if (name === 'lancer_session_cloud') {
        const minutes = Math.round(Number(input.minutes));
        if (!isFinite(minutes) || minutes < 5 || minutes > 340) throw new Error('minutes : entre 5 et 340');
        const nom = typeof input.nom === 'string' ? input.nom.trim().slice(0, 60) : '';
        return later(() => app.launchSession(nom, minutes));
      }
      if (name === 'lister_sessions') return later(() => app.listSessions());
      if (name === 'charger_session' || name === 'arreter_session') {
        if (typeof input.id !== 'string' || !input.id) throw new Error('id manquant (voir lister_sessions)');
        return later(() => (name === 'charger_session' ? app.loadSession(input.id) : app.cancelSession(input.id)));
      }
      if (name === 'modifier_reglages') {
        const ch = BZ.settingsFromTool(input.changements);
        if (typeof input.explication !== 'string') throw new Error('"explication" manquante');
        app.proposeSettings(ch, input.explication);
        return { content: JSON.stringify({ statut: "proposé à l'équipe (carte avant/après avec Appliquer), en attente de sa décision" }) };
      }
      throw new Error('outil inconnu : ' + name);
    } catch (e) {
      return { content: 'Erreur : ' + (e.message || e), is_error: true };
    }
  };

  // Déclarations d'outils au format Gemini (schéma JSON complet, ou schéma OpenAPI simplifié en secours).
  function geminiTools(legacy) {
    const strip = (o) => {
      if (Array.isArray(o)) return o.map(strip);
      if (!o || typeof o !== 'object') return o;
      const r = {};
      for (const [k, v] of Object.entries(o)) r[k] = strip(v);
      if (!r.type && !r.anyOf && r.description !== undefined && !r.properties) r.type = 'string'; // « valeur » libre : texte JSON
      return r;
    };
    return [{
      functionDeclarations: TOOLS.map((t) => {
        const d = { name: t.name, description: t.description };
        const empty = !Object.keys(t.parameters.properties).length;
        if (!empty) { if (legacy) d.parameters = strip(t.parameters); else d.parametersJsonSchema = t.parameters; }
        return d;
      }),
    }];
  }

  // Erreur HTTP de l'API Gemini, avec un message lisible.
  function ApiError(status, body) {
    const e = (body && body.error) || {};
    const err = new Error(e.message || ('HTTP ' + status));
    err.status = status;
    err.reason = e.status || '';
    err.detail = JSON.stringify(e.details || '');
    return err;
  }

  // Accès à Gemini : auth = { key } (clé perso, appel direct) ou { relay, code } (relais de l'équipe, clé cachée).
  const authHeaders = (auth) => (auth.relay ? (auth.code ? { 'X-Biobuzz-Code': auth.code } : {}) : { 'x-goog-api-key': auth.key });
  const relayUrl = (auth) => auth.relay.replace(/\/+$/, '');

  // Un tour de génération en flux (SSE) ; renvoie { parts, finish, block }.
  Assistant.prototype.stream = async function (auth, model, body, onText, signal) {
    const url = auth.relay
      ? `${relayUrl(auth)}/stream?model=${encodeURIComponent(model)}`
      : `${API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: 'POST', signal,
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(auth)),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let j = null;
      try { j = await res.json(); } catch (e) { /* pas de JSON */ }
      throw ApiError(res.status, j);
    }
    const parts = [];
    let finish = '', block = '';
    const add = (p) => {
      const last = parts[parts.length - 1];
      // le texte arrive en morceaux : on les recolle (sauf s'ils portent une signature de pensée)
      if (p.text !== undefined && !p.thought && !p.thoughtSignature && last && last.text !== undefined && !last.thought && !last.thoughtSignature) last.text += p.text;
      else parts.push(Object.assign({}, p));
      if (p.text && !p.thought) onText(p.text);
    };
    const handle = (line) => {
      if (!line.startsWith('data:')) return;
      const j = JSON.parse(line.slice(5).trim());
      if (j.error) throw ApiError(j.error.code || 500, j);
      if (j.promptFeedback && j.promptFeedback.blockReason) block = j.promptFeedback.blockReason;
      const c = j.candidates && j.candidates[0];
      if (!c) return;
      if (c.content && c.content.parts) c.content.parts.forEach(add);
      if (c.finishReason) finish = c.finishReason;
    };
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, k).replace(/\r$/, '')); buf = buf.slice(k + 1); }
    }
    if (buf.trim()) handle(buf.trim());
    return { parts, finish, block };
  };

  // Envoie un message et fait la boucle d'outils. ui : { onText(delta), onTurnStart(), onToolStart(name, input), onTool(name, input, res), onDone(), onError(msg) }
  Assistant.prototype.send = async function (text, auth, model, ui) {
    if (this.busy) return;
    this.busy = true;
    const ctrl = new AbortController();
    this.abort = () => ctrl.abort();
    const world = this.app.world();
    const ctxText = 'Situation actuelle dans l\'appli (JSON) :\n' + JSON.stringify(this.app.context());
    const n0 = this.messages.length;
    this.messages.push({ role: 'user', parts: [{ text: ctxText }, { text }] });
    const body = () => ({
      systemInstruction: { parts: [{ text: systemPrompt(world) }] },
      contents: this.messages,
      tools: geminiTools(this.legacySchema),
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: { maxOutputTokens: 16000 },
    });
    try {
      for (let turn = 0; turn < 12; turn++) {
        ui.onTurnStart && ui.onTurnStart();
        let out;
        try {
          out = await this.stream(auth, model, body(), (d) => ui.onText(d), ctrl.signal);
        } catch (err) {
          // ancien format de schéma : on réessaie une fois avec le schéma simplifié
          if (err.status === 400 && !this.legacySchema && /parameters_?json_?schema/i.test(err.message + err.detail)) { this.legacySchema = true; turn--; continue; }
          throw err;
        }
        if (out.block) { ui.onError('Gemini a bloqué cette demande (' + out.block + '). Reformulez-la.'); this.messages.length = n0; break; }
        if (!out.parts.length) {
          if (out.finish === 'SAFETY' || out.finish === 'PROHIBITED_CONTENT') ui.onError('Gemini a refusé de répondre à cette demande. Reformulez-la.');
          else if (out.finish === 'MAX_TOKENS') ui.onError('Réponse trop longue, coupée. Posez une question plus précise.');
          else ui.onError('Gemini n\'a rien répondu (' + (out.finish || 'réponse vide') + '). Réessayez.');
          this.messages.length = n0;
          break;
        }
        this.messages.push({ role: 'model', parts: out.parts });
        const calls = out.parts.filter((p) => p.functionCall);
        if (!calls.length) {
          if (out.finish === 'MAX_TOKENS') ui.onError('Réponse trop longue, coupée. Posez une question plus précise.');
          break;
        }
        const results = [];
        for (const p of calls) {
          const fc = p.functionCall;
          ui.onToolStart && ui.onToolStart(fc.name, fc.args);
          const res = await this.runTool(fc.name, fc.args || {});
          ui.onTool && ui.onTool(fc.name, fc.args, res);
          let payload;
          try { payload = JSON.parse(res.content); } catch (e) { payload = res.content; }
          const response = res.is_error ? { error: res.content } : { result: payload };
          results.push({ functionResponse: Object.assign({ name: fc.name, response }, fc.id ? { id: fc.id } : {}) });
        }
        this.messages.push({ role: 'user', parts: results });
      }
      ui.onDone && ui.onDone();
    } catch (err) {
      // on revient à l'historique d'avant ce message (il reste cohérent pour la suite)
      this.messages.length = n0;
      ui.onError(BZ.chatErrorText(err));
    } finally {
      this.busy = false;
      this.abort = null;
    }
  };

  BZ.chatErrorText = function (err) {
    if (err && err.name === 'AbortError') return 'Arrêté.';
    if (err && err.status) {
      const m = err.message || '';
      // réponses du relais de l'équipe
      if (err.reason === 'CODE_EQUIPE') return "Code d'équipe manquant ou faux : demandez-le à l'équipe et collez-le dans « Accès à Gemini ».";
      if (['ORIGINE', 'REFUSE', 'LIMITE', 'TROP_GROS', 'MODELE', 'CONFIG'].indexOf(err.reason) >= 0) return 'Relais de l\'équipe : ' + m + '.';
      if (err.status === 400 && /API key|API_KEY/i.test(m + err.detail)) return 'Clé API refusée : vérifiez-la (copiez-la en entier depuis aistudio.google.com).';
      if (err.status === 401 || err.status === 403) return "Cette clé n'a pas accès à l'API Gemini ou à ce modèle (vérifiez-la sur aistudio.google.com).";
      if (err.status === 404) return 'Modèle introuvable : choisissez-en un autre dans la liste.';
      if (err.status === 429) return 'Trop de demandes ou quota gratuit épuisé : attendez un peu ou vérifiez votre compte Google AI Studio.';
      if (err.status >= 500) return 'Le service Gemini a un problème, réessayez dans un moment.';
      return `Erreur de l'API Gemini (${err.status}) : ${m}`;
    }
    if (err instanceof TypeError) return "Pas de connexion à l'API Gemini (Internet ?).";
    return 'Erreur : ' + (err && err.message ? err.message : err);
  };

  // Modèles Gemini disponibles pour cette clé (ceux qui savent discuter).
  BZ.geminiModels = async function (auth) {
    const res = await fetch(auth.relay ? `${relayUrl(auth)}/models` : `${API}/models?pageSize=200`, { headers: authHeaders(auth) });
    let j = null;
    try { j = await res.json(); } catch (e) { /* pas de JSON */ }
    if (!res.ok) throw ApiError(res.status, j);
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0 && /^models\/gemini-/i.test(m.name) && !/embedding|image|tts|audio|live|vision|transcribe|robotics|computer-use|customtools|nano|omni|lyria/i.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), nom: m.displayName || m.name }));
  };

  BZ.Assistant = Assistant;
  if (typeof module !== 'undefined' && module.exports) module.exports = BZ;
})(typeof window !== 'undefined' ? window : globalThis);
