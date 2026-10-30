// Assistant IA (page 2) : discussion avec Claude via le SDK officiel Anthropic (vendor/anthropic-sdk.js).
// Claude voit les réglages, le plan dessiné et son résultat simulé ; il peut simuler des variantes
// et proposer un plan ou des réglages : l'équipe décide avec les boutons « Appliquer ».
// La clé API reste dans ce navigateur et part directement vers l'API Anthropic.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};
  const G = BZ.G;

  BZ.CHAT_MODELS = [
    { id: 'claude-opus-5-5', nom: 'Claude Opus 5.5 (le plus fort)' },
    { id: 'claude-sonnet-5-5', nom: 'Claude Sonnet 5.5 (rapide)' },
    { id: 'claude-haiku-5-5', nom: 'Claude Haiku 5.5 (le moins cher)' },
  ];

  // Réglages que Claude a le droit de proposer de changer.
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

  // Plan de l'appli <-> plan des outils (cap en degrés, plus lisible pour Claude).
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

  // Vérifie un plan proposé par Claude et le convertit ; lève une erreur lisible sinon.
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
      if (rule === 'bool') { if (typeof v !== 'boolean') throw new Error(`${c.chemin} : true ou false`); }
      else if (rule === 'table') {
        if (!Array.isArray(v) || v.length !== 6 || v.some((x) => typeof x !== 'number' || x < 0 || x > 20)) throw new Error(`${c.chemin} : 6 nombres entre 0 et 20`);
        v = v.map((x) => Math.round(x));
      } else if (typeof rule[0] === 'string') { if (rule.indexOf(v) < 0) throw new Error(`${c.chemin} : ${rule.join(' ou ')}`); }
      else if (typeof v !== 'number' || !isFinite(v) || v < rule[0] || v > rule[1]) throw new Error(`${c.chemin} : nombre entre ${rule[0]} et ${rule[1]}`);
      return { chemin: c.chemin, valeur: v };
    });
  };

  // Résumé d'un résultat simulé, pour Claude.
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
      input_schema: { type: 'object', properties: { plan: { $ref: '#/$defs/plan' } }, required: ['plan'], $defs: null },
    },
    {
      name: 'proposer_plan',
      description: "Propose un plan à l'équipe. L'appli le simule et affiche une carte avec le score avant/après et les boutons « Voir sur le terrain » et « Appliquer ». L'équipe décide ; ne dis pas que le plan est appliqué.",
      input_schema: { type: 'object', properties: { plan: { $ref: '#/$defs/plan' }, explication: { type: 'string', description: 'Pourquoi ce plan est meilleur, en 1 à 3 phrases simples.' } }, required: ['plan', 'explication'], $defs: null },
    },
    {
      name: 'lire_reglages',
      description: 'Renvoie tous les réglages actuels du robot et du match (page 1 de l\'appli) et la liste des réglages modifiables.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'modifier_reglages',
      description: "Propose de changer des réglages du robot ou du match (page 1). L'appli affiche une carte avant/après avec « Appliquer » : l'équipe décide. Ne change que ce que l'équipe a mesuré ou demandé.",
      input_schema: {
        type: 'object',
        properties: {
          changements: { type: 'array', items: { type: 'object', properties: { chemin: { type: 'string', description: 'ex. robot.lanceur.precision, match.tableBascule' }, valeur: { description: 'nombre, texte, booléen, ou liste de 6 nombres pour match.tableBascule' } }, required: ['chemin', 'valeur'] } },
          explication: { type: 'string' },
        },
        required: ['changements', 'explication'],
      },
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
    const props = t.input_schema.properties;
    if (props.plan) props.plan = PLAN_SCHEMA;
    delete t.input_schema.$defs;
    t.eager_input_streaming = true; // les entrées arrivent au fil de l'eau ; on les valide nous-mêmes
  }
  BZ.CHAT_TOOLS = TOOLS;

  function systemPrompt(world) {
    const F = world.flowers.map((f) => `${f.nom} (src "${f.id}") au mur en (${r1(f.x)}, ${r1(f.y)}), 4 POLLEN, on la vide en se plaçant devant (${r1(f.frontX + f.nx * 12)}, ${r1(f.frontY + f.ny * 12)})`).join(' ; ');
    const z = world.loading;
    const c = world.cellTargets;
    return [
      "Tu es l'assistant d'une équipe FIRST Tech Challenge (lycéens) qui prépare l'AUTO de 30 s du jeu BIOBUZZ 2026-2027 dans l'appli « BIOBUZZ Auto IA ». Réponds en français simple et concret, sans jargon, en peu de mots.",
      "Ce que tu peux faire : expliquer le plan et son score, trouver pourquoi il perd du temps ou rate des bascules, simuler des variantes avec simuler_plan, puis proposer un plan (proposer_plan) ou des réglages (modifier_reglages). L'équipe décide : tes propositions s'affichent avec un bouton « Appliquer ». N'annonce jamais un score que le simulateur n'a pas donné. Teste toujours un plan avec simuler_plan avant de le proposer. Ne change un réglage du robot que s'il vient d'une mesure de l'équipe ou d'une demande claire.",
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

  Assistant.prototype.client = function (key) {
    if (!root.Anthropic) throw new Error('SDK Anthropic absent (vendor/anthropic-sdk.js)');
    return new root.Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  };

  Assistant.prototype.reset = function () { this.messages = []; };

  // Exécute un outil demandé par Claude ; renvoie { content, is_error }.
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

  // Envoie un message et fait la boucle d'outils. ui : { onText(delta), onTurnStart(), onTool(name, input, res), onDone(), onError(msg) }
  Assistant.prototype.send = async function (text, key, model, ui) {
    if (this.busy) return;
    this.busy = true;
    const A = root.Anthropic;
    const client = this.client(key);
    const world = this.app.world();
    const ctxText = 'Situation actuelle dans l\'appli (JSON) :\n' + JSON.stringify(this.app.context());
    const n0 = this.messages.length;
    this.messages.push({ role: 'user', content: [{ type: 'text', text: ctxText }, { type: 'text', text }] });
    const params = {
      model,
      max_tokens: 16000,
      system: [{ type: 'text', text: systemPrompt(world), cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      output_config: { effort: 'medium' },
    };
    if (model !== 'claude-haiku-5-5') { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
    let jsonRetries = 0;
    try {
      for (let turn = 0; turn < 12; turn++) {
        ui.onTurnStart && ui.onTurnStart();
        const stream = client.beta.messages.stream(Object.assign({}, params, { messages: this.messages }));
        this.abort = () => stream.abort();
        stream.on('text', (d) => ui.onText(d));
        let msg;
        try {
          msg = await stream.finalMessage();
          jsonRetries = 0;
        } catch (err) {
          // entrée d'outil illisible (flux interrompu) : on relance le tour, deux fois au plus
          if (err instanceof A.APIError || err instanceof A.APIUserAbortError || jsonRetries++ >= 2) throw err;
          continue;
        }
        if (msg.stop_reason === 'refusal') {
          this.messages.push({ role: 'assistant', content: msg.content });
          ui.onError('Claude a refusé de répondre à cette demande. Reformulez-la.');
          break;
        }
        this.messages.push({ role: 'assistant', content: msg.content });
        if (msg.stop_reason === 'pause_turn') continue;
        const uses = msg.content.filter((b) => b.type === 'tool_use');
        if (!uses.length) break;
        if (msg.stop_reason === 'max_tokens') { ui.onError('Réponse trop longue, coupée. Posez une question plus précise.'); break; }
        const results = uses.map((u) => {
          const res = this.runTool(u.name, u.input);
          ui.onTool && ui.onTool(u.name, u.input, res);
          return Object.assign({ type: 'tool_result', tool_use_id: u.id, content: res.content }, res.is_error ? { is_error: true } : {});
        });
        this.messages.push({ role: 'user', content: results });
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
    const A = root.Anthropic;
    if (A) {
      if (err instanceof A.APIUserAbortError) return 'Arrêté.';
      if (err instanceof A.AuthenticationError) return 'Clé API refusée : vérifiez-la (elle commence par sk-ant-).';
      if (err instanceof A.PermissionDeniedError) return "Cette clé n'a pas accès à ce modèle.";
      if (err instanceof A.RateLimitError) return 'Trop de demandes ou crédit épuisé : attendez un peu ou vérifiez votre compte Anthropic.';
      if (err instanceof A.BadRequestError) return 'Demande refusée par l\'API : ' + (err.message || '');
      if (err instanceof A.APIConnectionError) return "Pas de connexion à l'API Anthropic (Internet ?).";
      if (err instanceof A.InternalServerError) return 'Le service Anthropic a un problème, réessayez dans un moment.';
      if (err instanceof A.APIError) return `Erreur de l'API (${err.status}) : ${err.message}`;
    }
    return 'Erreur : ' + (err && err.message ? err.message : err);
  };

  BZ.Assistant = Assistant;
  if (typeof module !== 'undefined' && module.exports) module.exports = BZ;
})(typeof window !== 'undefined' ? window : globalThis);
