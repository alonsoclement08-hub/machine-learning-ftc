// Interface : terrain en grand + île d'outils (dessin du plan), barre de droite à 3 pages
// (robot & match, chat IA, optimiser / sessions / code).
(function () {
  'use strict';
  const BZ = window.BZ;
  const G = BZ.G;
  const $ = (id) => document.getElementById(id);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---------------- État ----------------
  const LS_KEY = 'biobuzz-auto-ia-v1';
  const PLAN_KEY = 'biobuzz-plan-v1';
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { saved = null; }
  const merge = (def, obj) => {
    if (!obj || typeof obj !== 'object') return def;
    for (const k of Object.keys(def)) {
      if (def[k] && typeof def[k] === 'object' && !Array.isArray(def[k])) def[k] = merge(def[k], obj[k]);
      else if (obj[k] !== undefined) def[k] = obj[k];
    }
    return def;
  };
  let robot = merge(BZ.defaultRobot(), saved && saved.robot);
  const game = merge(BZ.defaultGame(), saved && saved.game);
  if (saved && saved.game) { game.zonePartenaire = saved.game.zonePartenaire || null; game.departImpose = saved.game.departImpose || null; }
  // anciennes versions : seuil de bascule à 6 par défaut -> 8 (3 NECTAR + 5 POLLEN)
  if (saved && saved.game && !saved.game.v) { if (game.seuilBascule === 6) game.seuilBascule = 8; game.v = 2; }
  // v3 : les NECTAR pèsent plus lourd (poidsNectar) ; le seuil est un poids en POLLEN
  if (saved && saved.game && (saved.game.v || 0) < 3) { game.poidsNectar = BZ.defaultGame().poidsNectar; game.v = 3; }
  if (!Array.isArray(game.zones)) game.zones = [];
  // v4 : table de bascule officielle (POLLEN nécessaires selon les NECTAR dans la CELL)
  if (saved && saved.game && (saved.game.v || 0) < 4) { game.tableBascule = BZ.DEFAULT_TIP_TABLE.slice(); game.v = 4; }
  if (!Array.isArray(game.tableBascule)) game.tableBascule = BZ.DEFAULT_TIP_TABLE.slice();
  // v11 : la zone partenaire devient une zone « interdite » dessinée sur le terrain
  if (game.zonePartenaire) {
    game.zones.push(Object.assign({ id: 'zpart', kind: 'interdite', color: '#7a3cff' }, game.zonePartenaire));
    game.zonePartenaire = null;
  }
  const legacyStart = game.departImpose;
  game.departImpose = null; // le départ appartient maintenant au plan (verrouillable)

  let myPlan = null; // plan dessiné par l'équipe
  try { myPlan = JSON.parse(localStorage.getItem(PLAN_KEY) || 'null'); } catch (e) { myPlan = null; }
  let opt = null; // Optimizer courant
  let best = null; // résultat simulé du plan affiché
  let aiPreview = null; // {result, plan} : meilleur plan de l'IA en aperçu (avant « Garder »)
  let training = false;
  let playing = false;
  let tNow = 0;
  let robotModel = null; // modèle 3D importé {name, meshes, rot}
  let robotTop = null; // silhouette vue de dessus (vue 2D)
  let codeShown = 'java';
  let is3d = false;

  const persist = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ robot, game })); } catch (e) { /* pas de stockage */ }
  };
  // Petit dessin du jeu d'icônes (sprite SVG en tête de index.html).
  const ic = (n, c) => `<svg class="ic${c ? ' ' + c : ''}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const okTxt = (t) => `<span class="ok">${ic('check')}${t}</span>`;
  const badTxt = (t) => `<span class="bad">${ic('x')}${t}</span>`;
  const persistPlan = () => {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(myPlan)); } catch (e) { /* pas de stockage */ }
  };

  const view2d = new BZ.Field2D($('field2d'));
  // place laissée au terrain entre l'île (en haut) et la barre du bas ; plus compacte en paysage sur téléphone
  const landscapeQ = window.matchMedia('(orientation: landscape) and (max-height: 560px)');
  const setInsets = () => { view2d.insets = landscapeQ.matches ? { top: 42, bottom: 42 } : { top: 64, bottom: 62 }; view2d.resize(); };
  setInsets();
  if (landscapeQ.addEventListener) landscapeQ.addEventListener('change', setInsets); else if (landscapeQ.addListener) landscapeQ.addListener(setInsets);
  const view3d = new BZ.Field3D($('field3d'));

  // ---------------- Formulaires ----------------
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a ? a[k] : undefined), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

  function fillForm(form, obj) {
    for (const el of form.elements) {
      if (!el.name) continue;
      const v = getPath(obj, el.name);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v === undefined || v === null ? '' : v;
    }
  }
  function readForm(form, obj) {
    for (const el of form.elements) {
      if (!el.name) continue;
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'number') { v = parseFloat(el.value); if (!isFinite(v)) continue; }
      else v = el.value;
      setPath(obj, el.name, v);
    }
  }

  fillForm($('robotForm'), robot);
  fillForm($('gameForm'), game);
  const markOdo = () => $('robotForm').classList.toggle('odo', robot.deplacement === 'odometrie');
  markOdo();

  $('robotForm').addEventListener('input', () => {
    readForm($('robotForm'), robot);
    markOdo();
    persist();
    showRobotWarnings();
    if (!robotModel) preview.show(null, robot);
    invalidate();
  });
  $('gameForm').addEventListener('input', () => {
    readForm($('gameForm'), game);
    persist();
    invalidate();
  });

  function showRobotWarnings() {
    const w = BZ.robotWarnings(robot);
    $('robotWarnings').innerHTML = w.map((x) => `<p>${ic('alert')}${x}</p>`).join('');
  }

  // Liste des règles
  $('rulesList').innerHTML = Object.entries(BZ.RULES)
    .filter(([k]) => /^G/.test(k))
    .map(([k, r]) => `<li><b>${k}</b> – ${r.titre}. <span class="hint">${r.texte}</span></li>`).join('');

  // ---------------- Barre de droite : 3 pages qu'on fait glisser ----------------
  const pager = $('pager');
  const PAGE_KEY = 'biobuzz-page';
  let pageIdx = 0;
  function goPage(i, instant) {
    pageIdx = Math.max(0, Math.min(2, i));
    pager.scrollTo({ left: pageIdx * pager.clientWidth, behavior: instant ? 'auto' : 'smooth' });
    markPage();
  }
  function markPage() {
    document.querySelectorAll('.pdot').forEach((d) => d.classList.toggle('active', +d.dataset.page === pageIdx));
    try { localStorage.setItem(PAGE_KEY, String(pageIdx)); } catch (e) { /* rien */ }
    if (pageIdx === 2) refreshExport();
  }
  let pageRaf = 0;
  pager.addEventListener('scroll', () => {
    cancelAnimationFrame(pageRaf);
    pageRaf = requestAnimationFrame(() => {
      const i = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
      if (i !== pageIdx) { pageIdx = i; markPage(); }
    });
  });
  document.querySelectorAll('.pdot').forEach((d) => d.addEventListener('click', () => goPage(+d.dataset.page)));
  $('pagePrev').addEventListener('click', () => goPage(pageIdx - 1));
  $('pageNext').addEventListener('click', () => goPage(pageIdx + 1));
  new ResizeObserver(() => pager.scrollTo({ left: pageIdx * pager.clientWidth })).observe(pager);

  // ---------------- 2D / 3D ----------------
  document.querySelectorAll('.segbtn').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.segbtn').forEach((x) => x.classList.toggle('active', x === b));
    is3d = b.dataset.view === '3d';
    $('stage').classList.toggle('is3d', is3d);
    $('field2d').classList.toggle('active', !is3d);
    $('field3d').classList.toggle('active', is3d);
    if (is3d) { view3d.init(); view3d.resize(); }
    else if (editor.tool === 'orbit') setTool('select');
    pushState();
  }));

  // ---------------- Monde, simulation ----------------
  let ctx = null; // {world, planner, sim} pour les réglages actuels
  function simCtx() {
    if (!ctx) {
      const rd = BZ.robotDerived(robot);
      const world = BZ.buildWorld(window.FIELD, game, rd);
      const planner = new BZ.Planner(world, 2);
      ctx = { world, planner, sim: new BZ.Sim(world, planner, robot, game) };
    }
    return ctx;
  }
  const worldNow = () => simCtx().world;
  function simulate(plan) {
    if (!plan || !plan.start) return null;
    try { return simCtx().sim.run(plan); } catch (e) { console.error(e); return null; }
  }

  // Pose de départ par défaut : un départ légal, robot face au terrain.
  function defaultStart(world) {
    const starts = BZ.legalStarts(world, 6);
    return starts.find((s) => Math.abs(s.h) < 1e-6) || starts[0] || { x: -60, y: -40, h: 0 };
  }

  // Plan de l'équipe (préchargées -> FLOWER 1 -> FLOWER 2 -> GARDEN -> PARK), avec un départ fixé.
  function teamPlan() {
    const o = new BZ.Optimizer(window.FIELD, robot, game, { seed: (Date.now() & 0xffff) + 1, popSize: 4 });
    let bestG = null;
    for (let k = 0; k < 40; k++) { const g = o.teamPlan(); o.evaluate(g); if (!bestG || g.result.fitness > bestG.result.fitness) bestG = g; }
    const p = o.toPlan(bestG);
    // robot trop lent pour tout faire en 30 s : on retire les dernières étapes (ramasser + tirer)
    let r = bestG.result;
    while (r.endT > game.dureeAuto && p.actions.length > 2) {
      p.actions = p.actions.slice(0, -2);
      r = o.sim.run(p);
    }
    return { start: p.start, startLock: false, actions: p.actions, park: p.park };
  }

  function ensurePlan() {
    const w = worldNow();
    if (!myPlan || !myPlan.start || !Array.isArray(myPlan.actions)) {
      try { myPlan = teamPlan(); } catch (e) { myPlan = { start: defaultStart(w), startLock: false, actions: [], park: { on: true, t: 0.5 } }; }
    }
    if (legacyStart) { myPlan.start = legacyStart; myPlan.startLock = true; }
    if (!myPlan.park) myPlan.park = { on: false, t: 0.5 };
    persistPlan();
  }

  // Recalcule le résultat du plan affiché.
  function resim() {
    best = aiPreview ? aiPreview.result : simulate(myPlan);
  }

  function invalidate() {
    // les réglages ont changé : nouveau monde, l'IA repart de zéro, on rejoue le plan
    ctx = null;
    stopTraining();
    opt = null;
    aiPreview = null;
    $('genCount').textContent = '0';
    $('evalCount').textContent = '0';
    resim();
    pushState();
  }

  // Déroulé des tirs pour l'animation (nominal, ou tiré au hasard si « aléatoire »).
  let randomSeed = 1;
  function outcomesFor(result, world) {
    if (!result) return null;
    const rng = $('randomMatch').checked ? G.rng(randomSeed) : null;
    return BZ.shotOutcomes(result, world, robot, game, rng);
  }

  function pushState() {
    const world = worldNow();
    const shown = aiPreview ? aiPreview.plan : myPlan;
    const st = {
      alliance: game.alliance, robot, game, rd: BZ.robotDerived(robot), world, result: best,
      outcomes: outcomesFor(best, world), idlePose: best ? null : (myPlan && myPlan.start), robotTop,
      overlay: editor.overlay(shown),
    };
    view2d.setState(st);
    if (view3d.ready) view3d.setState(st);
    updateKpis();
    renderSteps();
    renderCard();
    renderIsland();
    renderAiBar();
    if (pageIdx === 2) refreshExport();
  }

  function updateKpis() {
    const r = best;
    $('kpiScore').textContent = r ? r.expected.toFixed(1) + ' pts' : '–';
    $('kpiTips').textContent = r ? `${r.eTips.toFixed(2)} (max ${r.nominalTips})` : '–';
    $('kpiTime').textContent = r ? r.endT.toFixed(1) + ' s' : '–';
    const nf = r ? r.faults.length : null;
    $('kpiFaults').textContent = r ? (nf ? nf : '0') : '–';
    $('kpiFaults').className = r ? (nf ? 'bad' : 'good') : '';
    $('kpiTime').className = r && r.endT > game.dureeAuto ? 'bad' : '';
    $('bestScore').textContent = opt && opt.best ? opt.best.result.expected.toFixed(1) : '–';
  }

  // ---------------- Éditeur de plan ----------------
  const toastEl = document.createElement('div');
  toastEl.className = 'toast'; toastEl.hidden = true;
  $('stage').appendChild(toastEl);
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
  }

  // Colle le robot au mur le plus proche de notre côté, avec l'orientation choisie.
  function snapStart(x, y, deg) {
    const w = worldNow(), rd = w.rd, half = w.half;
    const h = G.rad(deg);
    const ex = Math.abs(Math.cos(h)) > 0.5 ? rd.hl : rd.hw, ey = Math.abs(Math.cos(h)) > 0.5 ? rd.hw : rd.hl;
    const dl = x + half, db = y + half, dt = half - y;
    const m = Math.min(dl, db, dt);
    if (m === dl) x = -half + ex; else if (m === db) y = -half + ey; else y = half - ey;
    x = Math.max(-half + ex, Math.min(-ex, x));
    y = Math.max(-half + ey, Math.min(half - ey, y));
    const s = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, h: G.wrap(h) };
    return { pose: s, errs: BZ.checkStart(w, s) };
  }

  let lastZonesKey = JSON.stringify(game.zones);
  const editor = new BZ.PlanEditor({
    world: worldNow,
    robot: () => robot,
    game: () => game,
    plan: () => myPlan,
    snapStart,
    toast,
    setTool: (t) => setTool(t),
    // Applique une modification du plan (et des zones) ; transient = pendant un glisser.
    apply(plan, zones, o) {
      myPlan = plan;
      game.zones = zones;
      const zk = JSON.stringify(zones.map((z) => (z.kind === 'interdite' ? [z.x0, z.y0, z.x1, z.y1] : z.id)));
      if (zk !== lastZonesKey) { lastZonesKey = zk; ctx = null; }
      if (!o.transient) { persistPlan(); persist(); opt = null; stopTraining(); }
      resim();
      pushState();
    },
    changed(light) { if (light) { const st = view2d.state; if (st) { st.overlay = editor.overlay(aiPreview ? aiPreview.plan : myPlan); view2d.draw(); if (view3d.ready) view3d.setState(st); } } else pushState(); },
  });

  function setTool(t) {
    if (t === 'orbit' && !is3d) t = 'select';
    editor.setTool(t);
    document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    renderIsland();
  }
  document.querySelectorAll('.tool[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('undoBtn').addEventListener('click', () => editor.undo());
  $('redoBtn').addEventListener('click', () => editor.redo());
  $('delBtn').addEventListener('click', () => editor.deleteSel());

  // Double-clic (ou double-tap) sur un objet du plan : sa fiche (ce que c'est, nom, actions).
  let lastTap = null;
  let card = null; // fiche ouverte : {px, py} = point du double-clic dans le terrain (pixels CSS)
  const onPointer = (kind, x, y, r, e) => {
    if (aiPreview) { if (kind === 'down') toast('Aperçu de l\'IA : gardez-le ou revenez à votre plan avant de modifier.'); return false; }
    if (kind === 'down') {
      const now = performance.now(), prev = lastTap;
      lastTap = { t: now, x, y, undo: editor.undoStack.length };
      if (prev && now - prev.t < 400 && G.dist(x, y, prev.x, prev.y) < r * 1.5) {
        lastTap = null;
        // avec un outil de dessin, le premier clic a pu poser un objet par-dessus : on l'annule
        if (editor.tool !== 'select' && editor.undoStack.length === prev.undo + 1) { editor.undo(); editor.redoStack.pop(); }
        const h = editor.hit(x, y, r);
        if (h) { openCard(h, e); return true; }
      }
      if (card) closeCard();
    }
    return editor.pointer(kind, x, y, r, e);
  };
  view2d.onPointer = onPointer;
  view3d.onPointer = onPointer;
  view2d.onPointerCursor = view3d.onPointerCursor = () => (editor.tool === 'select' ? 'pointer' : 'crosshair');
  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (aiPreview) return;
    if (card && e.key === 'Escape') { closeCard(); e.preventDefault(); return; }
    if (editor.key(e)) e.preventDefault();
  });

  // Options de l'île selon l'outil / la sélection.
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const chip = (act, label, on, extra) => `<button class="chip${on ? ' on' : ''}${extra ? ' ' + extra : ''}" type="button" data-act="${act}">${label}</button>`;
  const nChips = (cur) => [0, 1, 2, 3, 4].map((n) => chip('n:' + n, n ? '×' + n : 'toutes', (cur || 0) === n)).join('');
  const kindChips = (cur) => Object.entries(BZ.ZONE_KINDS).map(([k, v]) => chip('kind:' + k, v.nom.replace('Zone ', ''), cur === k)).join('');
  const swatches = (cur) => BZ.ZONE_COLORS.map((c) => `<button class="swatch${c === cur ? ' on' : ''}" type="button" data-act="color:${c}" style="background:${c}" aria-label="couleur ${c}"></button>`).join('');
  const srcName = (src) => (src === 'jardin' ? 'GARDEN' : src === 'nectar' ? 'NECTAR (LOADING ZONE)' : (worldNow().flowers.find((f) => f.id === src) || {}).nom || src);

  function renderIsland() {
    const t = editor.tool, sel = editor.sel;
    let h = '';
    if (aiPreview) h = '';
    else if (t === 'tir') h = `<span class="lbl">Balles par tir</span>${nChips(editor.tirN)}<span class="lbl">Cliquez où le robot s'arrête pour tirer.</span>`;
    else if (t === 'via') h = '<span class="lbl">Cliquez pour ajouter un point de passage. Avec l\'outil Choisir, tirez le losange au milieu d\'une flèche pour la courber.</span>';
    else if (t === 'ramasse') h = `<span class="lbl">Cliquez sur une FLOWER ou sur le GARDEN de votre côté${robot.intake.nectar ? ', ou dans la LOADING ZONE pour le NECTAR posé après une bascule' : ''}.</span>`;
    else if (t === 'park') h = `<span class="lbl">Cliquez dans la LOADING ZONE.</span>${chip('park:off', 'Pas de PARK', !(myPlan.park && myPlan.park.on))}`;
    else if (t === 'zone') h = `<span class="lbl">Type</span>${kindChips(editor.zoneKind)}<span class="lbl">Couleur</span>${swatches(editor.zoneColor)}<span class="lbl">${esc(BZ.ZONE_KINDS[editor.zoneKind].aide)} · glissez sur le terrain.</span>`;
    else if (t === 'start') h = `${chip('rot:90', '⟲ 90°')}${chip('rot:-90', '⟳ 90°')}${chip('start:free', 'Laisser l\'IA choisir', !myPlan.startLock)}<span class="lbl">Bougez la souris : le robot se colle au mur. R / Q pour tourner.</span>`;
    else if (t === 'orbit') h = `${chip('view:top', 'Dessus')}${chip('view:front', 'Face')}${chip('view:side', 'Côté')}${chip('view:iso', 'Iso')}<span class="lbl">Glisser = tourner · clic droit ou Maj = déplacer · molette = zoom</span>`;
    else if (sel && !card) h = selOpts(sel);
    $('islOpts').innerHTML = h ? `<div><div class="opts">${h}</div></div>` : '<div></div>';
    $('island').classList.toggle('open', !!h);
    $('undoBtn').disabled = !editor.undoStack.length;
    $('redoBtn').disabled = !editor.redoStack.length;
    $('delBtn').disabled = !sel;
  }

  // Réglages de l'objet sélectionné (dans l'île, ou dans la fiche du double-clic).
  function selOpts(sel) {
    let h = '';
    {
      if (sel.type === 'node' && sel.i === 'park') h = `<span class="lbl">PARK</span>${chip('lock', myPlan.park.lock ? ic('lock') + 'Verrouillé' : ic('unlock') + 'Libre', myPlan.park.lock)}${myPlan.park.ctrl ? chip('straight', 'Redresser la flèche') : ''}${chip('del', 'Retirer le PARK', false, 'danger')}`;
      else if (sel.type === 'node') {
        const a = myPlan.actions[sel.i];
        if (a) {
          const zs = game.zones.filter((z) => z.kind === (a.type === 'tir' ? 'tir' : 'passage'));
          const zsel = a.type !== 'ramasse' && zs.length ? `<span class="lbl">Zone</span><select data-act="zone"><option value="">aucune</option>${zs.map((z, k) => `<option value="${z.id}"${a.zone === z.id ? ' selected' : ''}>${esc(BZ.ZONE_KINDS[z.kind].nom)} ${k + 1}</option>`).join('')}</select>` : '';
          h = `<span class="lbl">Étape ${sel.i + 1}</span>`;
          if (a.type === 'tir') h += nChips(a.n);
          if (a.type === 'ramasse') h += ['fleur0', 'fleur1', 'jardin'].concat(robot.intake.nectar ? ['nectar'] : []).map((s2) => chip('src:' + s2, srcName(s2), a.src === s2)).join('');
          h += zsel + chip('lock', a.lock ? ic('lock') + 'Verrouillée' : ic('unlock') + 'Libre', !!a.lock) + (a.ctrl ? chip('straight', 'Redresser') : '') + chip('del', 'Supprimer', false, 'danger');
        }
      } else if (sel.type === 'ctrl') h = `${chip('straight', 'Redresser la flèche')}<span class="lbl">Glissez le losange pour courber.</span>`;
      else if (sel.type === 'zone') {
        const z = game.zones.find((q) => q.id === sel.id);
        if (z) h = `<span class="lbl">Zone</span>${kindChips(z.kind)}${swatches(z.color)}${chip('del', 'Supprimer', false, 'danger')}`;
      } else if (sel.type === 'start') h = `<span class="lbl">Départ</span>${chip('rot:90', ic('rotate-ccw') + '90°')}${chip('rot:-90', ic('rotate-cw') + '90°')}${chip('start:free', myPlan.startLock ? ic('lock') + 'Fixé (libérer)' : ic('unlock') + 'Choisi par l\'IA', !!myPlan.startLock)}`;
    }
    return h;
  }

  function islandAction(act, value) {
    const sel = editor.sel;
    const [k, v] = act.split(':');
    if (k === 'view') { view3d.setView(v); return; }
    if (k === 'rot') { editor.rotateStart(+v); return; }
    if (editor.tool === 'tir' && k === 'n') { editor.tirN = +v; renderIsland(); return; }
    if (editor.tool === 'zone' && k === 'kind') { editor.zoneKind = v; renderIsland(); return; }
    if (editor.tool === 'zone' && k === 'color') { editor.zoneColor = act.slice(6); renderIsland(); return; }
    if (k === 'park' && v === 'off') { editor.commit((p) => { p.park = Object.assign({}, p.park, { on: !(p.park && p.park.on) }); }); return; }
    if (k === 'start') { editor.commit((p) => { p.startLock = !p.startLock; }); return; }
    if (k === 'del') { editor.deleteSel(); return; }
    if (!sel) return;
    if (k === 'move') {
      editor.commit((p) => {
        const A = p.actions, i = sel.i, j = v === 'up' ? i - 1 : i + 1;
        if (typeof i !== 'number' || j < 0 || j >= A.length) return false;
        [A[i], A[j]] = [A[j], A[i]];
        editor.sel = { type: 'node', i: j };
      });
      return;
    }
    editor.commit((p, zones) => {
      const target = sel.type === 'node' || sel.type === 'ctrl' ? (sel.i === 'park' ? p.park : p.actions[sel.i]) : null;
      if (k === 'n' && target) { if (+v) target.n = +v; else delete target.n; }
      else if (k === 'lock' && target) target.lock = !target.lock;
      else if (k === 'straight' && target) delete target.ctrl;
      else if (k === 'src' && target) target.src = v;
      else if (k === 'zone' && target) { if (value) target.zone = value; else delete target.zone; }
      else if (sel.type === 'zone') {
        const z = zones.find((q) => q.id === sel.id);
        if (!z) return false;
        if (k === 'kind') { z.kind = v; for (const a of p.actions) if (a.zone === z.id && !((v === 'tir' && a.type === 'tir') || (v === 'passage' && a.type === 'via'))) delete a.zone; }
        else if (k === 'color') z.color = act.slice(6);
        else return false;
      } else return false;
    });
  }
  $('islOpts').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && b.tagName !== 'SELECT') islandAction(b.dataset.act); });
  $('islOpts').addEventListener('change', (e) => { const s2 = e.target.closest('select[data-act]'); if (s2) islandAction(s2.dataset.act, s2.value); });

  // ---------------- Île déplaçable ----------------
  // On la fait glisser par la poignée (six points) ; sa place est gardée (double-clic : retour au centre).
  const ISL_KEY = 'biobuzz-island-pos';
  const island = $('island'), stageEl = $('stage');
  let islPos = null; // {fx, fy} : position relative (0..1) dans le terrain
  try { islPos = JSON.parse(localStorage.getItem(ISL_KEY) || 'null'); } catch (e) { islPos = null; }
  function placeIsland() {
    if (!islPos) { island.classList.remove('moved'); island.style.left = ''; island.style.top = ''; return; }
    const W = stageEl.clientWidth, H = stageEl.clientHeight, w = island.offsetWidth, h = island.offsetHeight;
    const x = Math.max(6, Math.min(W - w - 6, islPos.fx * (W - w)));
    const y = Math.max(6, Math.min(H - h - 6, islPos.fy * (H - h)));
    island.classList.add('moved');
    island.style.left = x + 'px'; island.style.top = y + 'px';
  }
  let islDrag = null;
  $('islGrip').addEventListener('pointerdown', (e) => {
    const r = island.getBoundingClientRect(), sr = stageEl.getBoundingClientRect();
    islDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sr };
    island.classList.add('dragging');
    $('islGrip').setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  $('islGrip').addEventListener('pointermove', (e) => {
    if (!islDrag) return;
    const sr = islDrag.sr, w = island.offsetWidth, h = island.offsetHeight;
    const x = e.clientX - sr.left - islDrag.dx, y = e.clientY - sr.top - islDrag.dy;
    islPos = { fx: Math.max(0, Math.min(1, x / Math.max(1, sr.width - w))), fy: Math.max(0, Math.min(1, y / Math.max(1, sr.height - h))) };
    placeIsland();
  });
  const endIslDrag = () => {
    if (!islDrag) return;
    islDrag = null;
    island.classList.remove('dragging');
    try { localStorage.setItem(ISL_KEY, JSON.stringify(islPos)); } catch (e) { /* rien */ }
  };
  $('islGrip').addEventListener('pointerup', endIslDrag);
  $('islGrip').addEventListener('pointercancel', endIslDrag);
  $('islGrip').addEventListener('dblclick', () => { islPos = null; try { localStorage.removeItem(ISL_KEY); } catch (e) { /* rien */ } placeIsland(); });
  const islRO = new ResizeObserver(placeIsland);
  islRO.observe(stageEl); islRO.observe(island);

  // ---------------- Fiche d'un objet (double-clic) ----------------
  // Dit ce qu'est l'objet, permet de lui donner un nom, de le régler et de le supprimer.
  const cardEl = document.createElement('div');
  cardEl.className = 'ocard'; cardEl.hidden = true;
  cardEl.setAttribute('role', 'dialog');
  $('stage').appendChild(cardEl);

  function openCard(h, e) {
    editor.sel = { type: h.type, i: h.i, id: h.id };
    const sr = stageEl.getBoundingClientRect();
    card = { px: e.clientX - sr.left, py: e.clientY - sr.top };
    if (editor.tool !== 'select') setTool('select');
    pushState();
  }
  function closeCard() {
    if (!card) return;
    card = null;
    cardEl.hidden = true;
    renderIsland();
  }

  // Ce qu'est l'objet sélectionné, en clair. `target` : où ranger son nom (null = pas de nom).
  function describeSel(sel) {
    const r = best, w = worldNow();
    const timing = (st) => (st ? (st.done ? ['clock', `De ${st.t0.toFixed(1)} à ${st.t1.toFixed(1)} s pendant l'AUTO`] : ['alert', 'Étape sautée par la simulation (plus le temps, ou impossible)']) : null);
    const lockTxt = (o) => (o.lock ? ['lock', 'Verrouillée : l\'IA ne la modifie pas'] : ['unlock', 'Libre : l\'IA peut l\'ajuster']);
    if (sel.type === 'node' && sel.i === 'park') {
      const p = myPlan.park;
      if (!p || !p.on) return null;
      return { ic: 'park', title: 'PARK', target: p,
        what: 'Fin de l\'AUTO : le robot se gare dans la LOADING ZONE pour marquer les points de PARK.',
        info: [timing(r && r.parkStep), lockTxt(p)] };
    }
    if (sel.type === 'node') {
      const a = myPlan.actions[sel.i];
      if (!a) return null;
      const info = [timing(r && r.steps ? r.steps[sel.i] : null)];
      let title, what;
      if (a.type === 'tir') {
        const sh = BZ.shotInfo(w, robot, a.x, a.y);
        title = 'Tir';
        what = `Le robot s'arrête ici et lance ${a.n ? a.n + ' balle' + (a.n > 1 ? 's' : '') : 'toutes ses balles'} dans la CELL.`;
        info.push(sh.cell ? ['target', `Vise la ${sh.cellIdx === 0 ? 'CELL du haut' : 'CELL d\'après bascule'} · chance de marquer : ${Math.round(sh.p * 100)} %`] : ['alert', 'Aucune CELL atteignable d\'ici : rapprochez le point de tir.']);
      } else if (a.type === 'via') {
        title = a.auto ? 'Point de passage (ajouté par l\'IA)' : 'Point de passage';
        what = 'Le robot passe par ce point en allant vers l\'étape suivante : pour contourner un obstacle ou choisir son chemin.';
      } else if (a.type === 'ramasse') {
        title = 'Ramassage';
        what = `Le robot va chercher des balles : ${srcName(a.src)}.`;
      } else { title = a.type; what = ''; }
      const z = a.zone && game.zones.find((q) => q.id === a.zone);
      if (z) info.push(['zone', `Rattachée à : ${z.note || BZ.ZONE_KINDS[z.kind].nom}`]);
      info.push(lockTxt(a));
      return { ic: ICON[a.type] || 'diamond', title: `Étape ${sel.i + 1} · ${title}`, what, info, target: a };
    }
    if (sel.type === 'ctrl') {
      return { ic: 'curve', title: 'Courbe de flèche', target: null,
        what: `Poignée de la flèche qui mène ${sel.i === 'park' ? 'au PARK' : 'à l\'étape ' + (sel.i + 1)}. Glissez-la pour courber le trajet ; « Redresser » remet la flèche droite.`,
        info: [] };
    }
    if (sel.type === 'zone') {
      const z = game.zones.find((q) => q.id === sel.id);
      if (!z) return null;
      const k = BZ.ZONE_KINDS[z.kind], q = BZ.zoneRect(z);
      const L = q.x1 - q.x0, H = q.y1 - q.y0;
      const users = myPlan.actions.map((a, i) => (a.zone === z.id ? i + 1 : 0)).filter(Boolean);
      return { ic: 'zone', title: k.nom, target: z,
        what: k.aide.charAt(0).toUpperCase() + k.aide.slice(1) + '.',
        info: [['ruler', `${Math.round(L)} × ${Math.round(H)} in (${Math.round(L * 2.54)} × ${Math.round(H * 2.54)} cm)`],
          users.length ? ['list', `Utilisée par l'étape ${users.join(', ')}`] : (z.kind === 'interdite' ? null : ['list', 'Rattachée à aucune étape'])] };
    }
    if (sel.type === 'start') {
      return { ic: 'robot', title: 'Départ du robot', target: null,
        what: 'Position et orientation du robot au début de l\'AUTO, collé au mur (règle G304).',
        info: [myPlan.startLock ? ['lock', 'Fixé par vous'] : ['unlock', 'L\'IA peut choisir un meilleur départ'], ['rotate-cw', 'R / Q ou les boutons de rotation pour le tourner.']] };
    }
    return null;
  }

  function renderCard() {
    if (!card) return;
    const sel = editor.sel, d = sel && !aiPreview ? describeSel(sel) : null;
    if (!d) { closeCard(); return; }
    const reorder = sel.type === 'node' && typeof sel.i === 'number'
      ? chip('move:up', ic('up') + 'Plus tôt', false, sel.i > 0 ? '' : 'off') + chip('move:down', ic('down') + 'Plus tard', false, sel.i < myPlan.actions.length - 1 ? '' : 'off') : '';
    const opts = selOpts(sel).replace(/^<span class="lbl">Étape \d+<\/span>/, ''); // le titre le dit déjà
    cardEl.innerHTML = `<div class="oc-head"><span class="oc-ic">${ic(d.ic)}</span><b>${esc(d.title)}</b><button class="oc-x" type="button" data-act="close" aria-label="Fermer">${ic('x')}</button></div>` +
      `<p class="oc-what">${esc(d.what)}</p>` +
      (d.info.filter(Boolean).length ? `<ul class="oc-info">${d.info.filter(Boolean).map(([n, t]) => `<li>${ic(n)}<span>${esc(t)}</span></li>`).join('')}</ul>` : '') +
      (d.target ? `<label class="oc-note">Nom (ce que c'est)<input type="text" maxlength="40" data-note placeholder="ex. : tir depuis le coin" value="${esc(d.target.note || '')}"></label>` : '') +
      `<div class="opts">${reorder}${opts}</div>`;
    cardEl.hidden = false;
    // à côté du double-clic, sans sortir du terrain
    const W = stageEl.clientWidth, H = stageEl.clientHeight, cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
    let x = card.px + 14, y = card.py + 14;
    if (x + cw > W - 6) x = card.px - cw - 14;
    if (y + ch > H - 6) y = H - ch - 6;
    cardEl.style.left = Math.max(6, x) + 'px';
    cardEl.style.top = Math.max(6, y) + 'px';
  }
  cardEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT' || b.classList.contains('off')) return;
    if (b.dataset.act === 'close') { closeCard(); return; }
    islandAction(b.dataset.act);
  });
  cardEl.addEventListener('change', (e) => { const s2 = e.target.closest('select[data-act]'); if (s2) islandAction(s2.dataset.act, s2.value); });
  // le nom s'enregistre en direct, sans relancer l'optimisation
  cardEl.addEventListener('input', (e) => {
    if (!e.target.matches('[data-note]')) return;
    const d = editor.sel && describeSel(editor.sel);
    if (!d || !d.target) return;
    const v = e.target.value.trim();
    if (v) d.target.note = v; else delete d.target.note;
    persistPlan(); persist();
    editor.app.changed(true);
    renderSteps();
  });
  cardEl.addEventListener('keydown', (e) => { if (e.key === 'Escape' || (e.key === 'Enter' && e.target.matches('[data-note]'))) { e.stopPropagation(); closeCard(); } });

  // ---------------- Liste des étapes ----------------
  const ICON = { tir: 'target', via: 'route', ramasse: 'grab', park: 'park' };
  function stepText(a) {
    if (a.note) return a.note;
    if (a.type === 'tir') return `Tir ${a.n ? '×' + a.n : '(toutes)'}` + (a.zone ? ' · zone' : '');
    if (a.type === 'via') return a.auto ? 'Passage (IA)' : 'Point de passage';
    if (a.type === 'ramasse') return 'Ramasser · ' + srcName(a.src);
    return a.type;
  }
  function renderSteps() {
    const plan = aiPreview ? aiPreview.plan : myPlan;
    const r = best;
    const items = [];
    const sel = editor.sel || {};
    (plan.actions || []).forEach((a, i) => {
      const s = r && r.steps ? r.steps[i] : null;
      const cls = [sel.type === 'node' && sel.i === i ? 'sel' : '', s && !s.done ? 'skip' : '', s && tNow >= s.t0 && tNow < s.t1 ? 'now' : ''].filter(Boolean).join(' ');
      const tt = s ? (s.done ? `${s.t0.toFixed(1)}–${s.t1.toFixed(1)} s` : 'sautée') : '';
      items.push(`<li class="${cls}" data-i="${i}"><span class="pi">${ic(ICON[a.type] || 'diamond')}</span><span class="ptxt">${i + 1}. ${esc(stepText(a))} ${a.lock ? ic('lock', 'tiny') : ''}<br><span class="pt">${tt}</span></span>` +
        (aiPreview ? '' : `<button class="pb" data-act="up" title="Monter">${ic('up')}</button><button class="pb" data-act="down" title="Descendre">${ic('down')}</button><button class="pb" data-act="lock" title="Verrouiller pour l'IA">${ic(a.lock ? 'lock' : 'unlock')}</button><button class="pb" data-act="del" title="Supprimer">${ic('x')}</button>`) + '</li>');
    });
    if (plan.park && plan.park.on) {
      const ps = r && r.parkStep;
      items.push(`<li class="${sel.i === 'park' ? 'sel' : ''}" data-i="park"><span class="pi">${ic('park')}</span><span class="ptxt">${plan.park.note ? esc(plan.park.note) : 'PARK (LOADING ZONE)'}<br><span class="pt">${ps ? ps.t0.toFixed(1) + '–' + ps.t1.toFixed(1) + ' s' : ''}</span></span></li>`);
    }
    if (!items.length) items.push('<li class="chances">Choisissez un outil dans l\'île en haut et dessinez votre AUTO sur le terrain.</li>');
    if (r) {
      items.push(`<li class="chances">Fin à ${r.endT.toFixed(1)} s · LEAVE ${ic(r.leave ? 'check' : 'x', 'tiny')} · PARK ${ic(r.park ? 'check' : 'x', 'tiny')}` +
        (r.tipsAtLeast ? ' · ' + [1, 2, 3].filter((k) => k <= Math.max(1, r.nominalTips)).map((k) => `${k} bascule${k > 1 ? 's' : ''} : <b>${Math.round(r.tipsAtLeast[k] * 100)} %</b>`).join(' · ') : '') + '</li>');
    }
    $('planSteps').innerHTML = items.join('');
    $('dockSummary').textContent = `${(plan.actions || []).length} étapes` + (r ? ` · ${r.expected.toFixed(1)} pts · ${r.endT.toFixed(1)} s` : '');
    $('faultList').innerHTML = r && r.faults.length
      ? r.faults.map((f) => `<p>${ic('alert')}<b>${f.rule}</b> ${(BZ.RULES[f.rule] || {}).titre || ''} ${f.info ? '(' + esc(f.info) + ')' : ''} à ${f.t.toFixed(1)} s</p>`).join('')
      : (r ? `<p>${okTxt('Aucune faute : le plan respecte les règles vérifiées.')}</p>` : '');
  }
  $('planSteps').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    const i = li.dataset.i === 'park' ? 'park' : +li.dataset.i;
    const b = e.target.closest('[data-act]');
    if (!b) { editor.sel = { type: 'node', i }; setTool('select'); pushState(); return; }
    const act = b.dataset.act;
    if (act === 'del') { editor.sel = { type: 'node', i }; editor.deleteSel(); return; }
    editor.commit((p) => {
      const A = p.actions;
      if (act === 'up' && i > 0) { [A[i - 1], A[i]] = [A[i], A[i - 1]]; editor.sel = { type: 'node', i: i - 1 }; }
      else if (act === 'down' && i < A.length - 1) { [A[i + 1], A[i]] = [A[i], A[i + 1]]; editor.sel = { type: 'node', i: i + 1 }; }
      else if (act === 'lock') A[i].lock = !A[i].lock;
      else return false;
    });
  });
  $('dockToggle').addEventListener('click', () => $('dock').classList.toggle('collapsed'));
  $('planTeam').addEventListener('click', () => {
    if (aiPreview) return;
    const t = teamPlan();
    editor.commit((p) => { Object.assign(p, t, { start: p.startLock ? p.start : t.start, startLock: p.startLock }); });
  });
  $('planFromAI').addEventListener('click', () => {
    if (aiPreview) { keepAi(); return; }
    if (!opt || !opt.best) { goPage(1); toast('Lancez d\'abord l\'optimisation (page « Assistant »).'); return; }
    aiPreview = { result: opt.best.result, plan: planFromGenome(opt.best) }; keepAi();
  });
  $('planClear').addEventListener('click', () => { if (!aiPreview) editor.commit((p) => { p.actions = []; p.park = { on: false, t: 0.5 }; }); });
  $('planSave').addEventListener('click', () => download('plan-auto.json', JSON.stringify({ version: 1, plan: myPlan, zones: game.zones }, null, 2), 'application/json'));
  $('planLoad').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      const plan = d.plan || d;
      if (!plan.start || !Array.isArray(plan.actions)) throw new Error('pas de plan');
      editor.commit((p, zones) => { Object.assign(p, plan); if (Array.isArray(d.zones)) { zones.length = 0; zones.push(...d.zones); } });
    } catch (err) { modal('Plan invalide', '<p>Ce fichier n\'est pas un plan exporté par cette appli.</p>'); }
  });

  // ---------------- Optimisation (IA) ----------------
  function planFromGenome(g) {
    const p = opt.toPlan(g);
    return clone({ start: p.start, startLock: !!myPlan.startLock, actions: p.actions, park: p.park });
  }
  function renderAiBar() {
    const bar = $('aiBar');
    if (!aiPreview) { bar.hidden = true; return; }
    const mine = simulate(myPlan);
    const r = aiPreview.result;
    bar.hidden = false;
    bar.innerHTML = `<span>${ic('spark')}<b>Aperçu de l'IA</b> : ${r.expected.toFixed(1)} pts · ${r.endT.toFixed(1)} s` +
      (mine ? ` <span class="hint">(votre plan : ${mine.expected.toFixed(1)} pts · ${mine.endT.toFixed(1)} s)</span>` : '') + '</span>' +
      '<button class="btn primary" type="button" id="aiKeep">Garder ce plan</button><button class="btn" type="button" id="aiDrop">Revenir à mon plan</button>';
    $('aiKeep').onclick = keepAi;
    $('aiDrop').onclick = dropAi;
  }
  function keepAi() {
    if (!aiPreview) return;
    const p = aiPreview.plan;
    stopTraining();
    aiPreview = null;
    editor.commit((pl) => { Object.assign(pl, clone(p)); });
  }
  function dropAi() { stopTraining(); aiPreview = null; resim(); pushState(); }

  function makeOptimizer() {
    try {
      opt = new BZ.Optimizer(window.FIELD, robot, game, { seed: (Date.now() & 0xffff) + 1, base: myPlan, keepOrder: $('keepOrder').checked });
      return true;
    } catch (e) {
      opt = null;
      modal('Impossible de lancer l\'IA', `<p>${esc(e.message)}</p>`);
      return false;
    }
  }
  $('keepOrder').addEventListener('change', () => { stopTraining(); opt = null; $('genCount').textContent = '0'; $('evalCount').textContent = '0'; drawChart(); stopTraining(); });

  // ---------------- Entraînement ----------------
  function drawChart() {
    const c = $('chart'), cx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr; c.height = 140 * dpr;
    cx.clearRect(0, 0, c.width, c.height);
    if (!opt || !opt.history.length) return;
    const h = opt.history;
    const vals = h.map((x) => x.expected);
    const max = Math.max(10, ...vals) * 1.1;
    const pad = 24 * dpr;
    cx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--line'); cx.lineWidth = 1;
    cx.fillStyle = getComputedStyle(document.body).getPropertyValue('--ink-2');
    cx.font = `${10 * dpr}px system-ui`;
    for (let v = 0; v <= max; v += 20) {
      const y = c.height - pad / 2 - (v / max) * (c.height - pad);
      cx.beginPath(); cx.moveTo(pad, y); cx.lineTo(c.width, y); cx.stroke();
      cx.fillText(String(v), 2, y + 3 * dpr);
    }
    cx.strokeStyle = '#e0a100'; cx.lineWidth = 2 * dpr;
    cx.beginPath();
    vals.forEach((v, i) => {
      const x = pad + (i / Math.max(1, vals.length - 1)) * (c.width - pad - 4);
      const y = c.height - pad / 2 - (v / max) * (c.height - pad);
      if (i) cx.lineTo(x, y); else cx.moveTo(x, y);
    });
    cx.stroke();
  }

  function trainLoop() {
    if (!training) return;
    const t0 = performance.now();
    const maxGen = parseInt($('maxGen').value, 10) || 300;
    while (performance.now() - t0 < 30 && opt.generation < maxGen) opt.step();
    aiPreview = { result: opt.best.result, plan: planFromGenome(opt.best) };
    resim();
    $('genCount').textContent = String(opt.generation);
    $('evalCount').textContent = String(opt.evals);
    drawChart();
    pushState();
    if (opt.generation >= maxGen) { stopTraining(); onOptimizationDone(); return; }
    requestAnimationFrame(trainLoop);
  }
  function startTraining() {
    if (!opt && !makeOptimizer()) return;
    training = true;
    $('trainBtn').innerHTML = ic('pause') + 'Pause';
    requestAnimationFrame(trainLoop);
  }
  function stopTraining() {
    training = false;
    $('trainBtn').innerHTML = ic('play') + (opt && opt.generation ? 'Continuer' : 'Optimiser mon plan');
  }
  $('trainBtn').addEventListener('click', () => (training ? stopTraining() : startTraining()));
  $('resetTrain').addEventListener('click', () => {
    stopTraining(); opt = null; aiPreview = null; resim();
    $('genCount').textContent = '0'; $('evalCount').textContent = '0';
    drawChart(); pushState(); stopTraining();
  });

  // ---------------- Rejeu ----------------
  function setTime(t) {
    tNow = Math.max(0, Math.min(30, t));
    $('timeSlider').value = String(tNow);
    $('timeLabel').textContent = tNow.toFixed(1) + ' s';
    view2d.setTime(tNow);
    if (view3d.ready) view3d.setTime(tNow);
    renderSteps();
  }
  $('timeSlider').addEventListener('input', (e) => { playing = false; $('playBtn').innerHTML = ic('play'); setTime(parseFloat(e.target.value)); });
  let lastFrame = 0;
  function playLoop(ts) {
    if (!playing) return;
    const dt = lastFrame ? (ts - lastFrame) / 1000 : 0;
    lastFrame = ts;
    setTime(tNow + dt);
    if (tNow >= Math.min(30, best ? best.endT + 0.5 : 30)) { playing = false; $('playBtn').innerHTML = ic('play'); return; }
    requestAnimationFrame(playLoop);
  }
  $('playBtn').addEventListener('click', () => {
    if (!best) return;
    playing = !playing;
    $('playBtn').innerHTML = ic(playing ? 'pause' : 'play');
    if (playing) {
      if (tNow >= Math.min(30, best.endT)) setTime(0);
      lastFrame = 0; requestAnimationFrame(playLoop);
    }
  });

  // ---------------- Import 3D ----------------
  let busyTimer = null;
  let busyEstimate = null; // secondes estimées (pour l'affichage du chrono)
  function busy(on, text, cancellable) {
    $('busy').hidden = !on;
    if (text) $('busyText').textContent = text;
    $('busyCancel').hidden = !cancellable;
    clearInterval(busyTimer);
    $('busyTime').textContent = '';
    if (on) {
      const t0 = Date.now();
      busyTimer = setInterval(() => {
        const el = (Date.now() - t0) / 1000;
        $('busyTime').textContent = BZ.formatDuration(el) + (busyEstimate ? ' / ~' + BZ.formatDuration(busyEstimate) : '');
      }, 500);
    } else {
      busyEstimate = null;
      $('busyLong').hidden = true;
    }
  }
  $('busyCancel').addEventListener('click', () => BZ.cancelRobotImport());
  let modalResolve = null;
  function modal(title, html) {
    $('modalTitle').textContent = title; $('modalBody').innerHTML = html;
    $('modalCancel').hidden = true; $('modalClose').textContent = 'OK';
    $('modal').hidden = false;
  }
  // Fenêtre à deux boutons ; renvoie true si l'utilisateur valide.
  function confirmModal(title, html, okLabel, cancelLabel) {
    modal(title, html);
    $('modalClose').textContent = okLabel; $('modalCancel').textContent = cancelLabel; $('modalCancel').hidden = false;
    return new Promise((resolve) => { modalResolve = resolve; });
  }
  const closeModal = (v) => { $('modal').hidden = true; if (modalResolve) { const r = modalResolve; modalResolve = null; r(v); } };
  $('modalClose').addEventListener('click', () => closeModal(true));
  $('modalCancel').addEventListener('click', () => closeModal(false));
  BZ.onImportLong = () => { $('busyLong').hidden = false; };
  $('busyKeep').addEventListener('click', () => { $('busyLong').hidden = true; });

  const preview = new BZ.RobotPreview($('robotPreview'));

  // Applique le modèle : dimensions mesurées -> robot, aperçu, vue 3D, silhouette 2D.
  function applyModel(updateDims) {
    const dimInputs = document.querySelectorAll('#robotForm input.dim');
    if (!robotModel) {
      robotTop = null;
      dimInputs.forEach((i) => { i.readOnly = false; });
      $('dimsHint').textContent = 'Importez le modèle 3D pour mesurer automatiquement.';
      $('importStatus').textContent = 'Aucun modèle : le robot est affiché comme une boîte.';
      $('importDims').textContent = '';
      $('rotBar').hidden = true;
      $('unitRow').hidden = true;
      preview.show(null, robot);
      view3d.setRobotModel(null);
      pushState();
      return;
    }
    $('rotBar').hidden = false;
    $('unitRow').hidden = !robotModel.stl;
    if (robotModel.stl) $('stlUnit').value = robotModel.unit || 'mm';
    const d = BZ.robotModelDims(robotModel);
    if (updateDims) {
      robot.longueur_cm = Math.round(d.longueur * 10) / 10;
      robot.largeur_cm = Math.round(d.largeur * 10) / 10;
      robot.hauteur_cm = Math.round(d.hauteur * 10) / 10;
      fillForm($('robotForm'), robot);
      persist();
      showRobotWarnings();
    }
    dimInputs.forEach((i) => { i.readOnly = true; });
    $('dimsHint').textContent = 'Mesurées sur le modèle 3D (tournez-le avec les boutons de rotation si besoin).';
    const ok = d.longueur <= 45.72 && d.largeur <= 45.72 && d.hauteur <= 45.72;
    $('importDims').innerHTML = `${d.longueur.toFixed(1)} × ${d.largeur.toFixed(1)} × ${d.hauteur.toFixed(1)} cm (longueur × largeur × hauteur) · ` +
      (ok ? okTxt('tient dans le cube de 18 in') : badTxt('<b>dépasse le cube de 45,7 cm (R102) : vérifiez l\'orientation</b>'));
    $('importStatus').textContent = `Modèle : ${robotModel.name}` + (robotModel.stl ? ` (STL, ${robotModel.tris || ''} triangles)`
      : robotModel.kept ? ` (${robotModel.kept} pièces gardées, ${robotModel.dropped} petites pièces retirées)` : '');
    preview.show(BZ.buildRobotGroup(robotModel), robot);
    robotTop = BZ.robotTopImage(robotModel);
    view3d.init();
    view3d.setRobotModel(BZ.buildRobotGroup(robotModel));
    if (updateDims) invalidate(); else pushState();
  }

  $('robotFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const isStep = ['step', 'stp', 'iges', 'igs'].indexOf(ext) >= 0;
    let est = null;
    if (isStep) {
      est = BZ.estimateStepSeconds(file.size, BZ.isSafari());
      const mb = (file.size / 1e6).toFixed(0);
      if (file.size > 20e6) {
        const go = await confirmModal('Ce fichier STEP est lourd',
          `<p><b>${file.name}</b> fait <b>${mb} Mo</b> : sa lecture devrait prendre environ <b>${BZ.formatDuration(est.min)} à ${BZ.formatDuration(est.max)}</b>` +
          (BZ.isSafari() ? ' (Safari est plus lent que Chrome)' : '') + '.</p>' +
          '<p>Le plus rapide : importer le <b>STL</b> du robot (quelques secondes). Depuis Inventor : Fichier &gt; Exporter &gt; Format CAO &gt; <b>STL</b>, résolution basse, unités mm.</p>',
          'Lire quand même', 'Annuler');
        if (!go) return;
      }
    }
    busy(true, `Lecture de ${file.name}…`, true);
    if (est) busyEstimate = (est.min + est.max) / 2;
    try {
      const m = await BZ.readRobotFile(file, (txt) => { $('busyText').textContent = txt; });
      robotModel = m;
      BZ.saveRobotModel(m);
      applyModel(true);
    } catch (err) {
      if (err.inventor) modal('Fichier Inventor : exportez-le en STEP', BZ.INVENTOR_HELP);
      else if (err.blocked) modal('Lecture du STEP impossible dans ce navigateur',
        '<p>Votre navigateur bloque la lecture des fichiers STEP quand l\'appli est ouverte comme fichier local (c\'est le cas de <b>Safari</b>).</p>' +
        '<ol><li><b>Importez le STL</b> de votre robot : il se charge en quelques secondes, dans tous les navigateurs.</li>' +
        '<li>Ou ouvrez l\'appli dans <b>Chrome</b> ou <b>Edge</b> : clic droit sur <span class="mono">index.html</span> &gt; Ouvrir avec.</li></ol>');
      else if (err && (err.name === 'NotReadableError' || /could not be read|permission problems/i.test(err.message || '')))
        modal('Le navigateur n\'a pas pu lire ce fichier',
          '<p>Le fichier a changé ou n\'est plus accessible depuis que vous l\'avez choisi.</p>' +
          '<ol><li>Si l\'export depuis Inventor n\'était pas fini, attendez qu\'il se termine.</li>' +
          '<li>Si le fichier est dans <b>iCloud Drive</b>, OneDrive ou Google Drive, copiez-le d\'abord sur le <b>Bureau</b> (ou dans Téléchargements), sur votre ordinateur.</li>' +
          '<li>Si le fichier est dans un ZIP, dézippez-le d\'abord.</li>' +
          '<li>Puis cliquez à nouveau sur « Importer mon robot… » et choisissez la copie.</li></ol>');
      else if (!err.cancelled) modal('Import impossible', `<p>${err.message || err}</p>`);
    } finally {
      busy(false);
    }
  });
  document.querySelectorAll('#rotBar [data-rot]').forEach((b) => b.addEventListener('click', () => {
    if (!robotModel) return;
    BZ.rotateModel(robotModel, b.dataset.rot, 1);
    BZ.saveRobotModel(robotModel);
    applyModel(true);
  }));
  $('stlUnit').addEventListener('change', () => {
    if (!robotModel || !robotModel.stl) return;
    BZ.setModelUnit(robotModel, $('stlUnit').value);
    BZ.saveRobotModel(robotModel);
    applyModel(true);
  });
  $('rotReset').addEventListener('click', () => {
    if (!robotModel) return;
    robotModel.rot = BZ.guessRotation(robotModel);
    BZ.saveRobotModel(robotModel);
    applyModel(true);
  });
  $('robotClear').addEventListener('click', () => { robotModel = null; BZ.saveRobotModel(null); applyModel(false); });

  // ---------------- Robot JSON ----------------
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('saveRobot').addEventListener('click', () => download((robot.nom || 'robot').replace(/[^\w-]+/g, '_') + '.json', JSON.stringify(robot, null, 2), 'application/json'));
  $('loadRobot').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      robot = merge(BZ.defaultRobot(), JSON.parse(await f.text()));
      fillForm($('robotForm'), robot); persist(); showRobotWarnings(); invalidate();
    } catch (err) { modal('Fichier invalide', '<p>Ce n\'est pas un robot enregistré par cette appli.</p>'); }
  });
  $('resetRobot').addEventListener('click', () => { robot = BZ.defaultRobot(); fillForm($('robotForm'), robot); persist(); showRobotWarnings(); invalidate(); });

  // ---------------- Export ----------------
  function exportTexts() {
    if (!best) return null;
    const w = worldNow();
    const startText = BZ.describeStart(w, best.plan.start, robot);
    return {
      startText,
      java: BZ.exportJava(best, robot, { startText }),
      blk: BZ.exportBlockly(best, robot, { startText }),
      pedro: BZ.exportPedro(best, robot, { startText }),
    };
  }
  function refreshExport() {
    const t = exportTexts();
    if (!t) {
      $('startText').innerHTML = '<li class="hint">Dessinez d\'abord votre AUTO sur le terrain.</li>';
      $('codeView').value = '';
      return;
    }
    $('startText').innerHTML = t.startText.map((s) => `<li>${s}</li>`).join('');
    $('codeView').value = t[codeShown] || t.java;
    const odo = robot.deplacement === 'odometrie';
    $('codeModeHint').innerHTML = odo
      ? '<b>Mode odométrie</b> : utilisez <b>Pedro</b> (vraies courbes, le robot sait où il est). Le Java chronométré et le .blk suivent les mêmes points, mais sans correction de position.'
      : '<b>Mode chronométré</b> : <b>Java</b> ou <b>.blk</b> (temps en ms). Le fichier Pedro sert si votre robot a une odométrie (choisissez « Odométrie » page 1 pour des temps justes).';
    $('dlPedro').classList.toggle('primary', odo);
    $('dlJava').classList.toggle('primary', !odo);
    $('dlBlk').classList.toggle('primary', !odo);
  }
  const needPlan = () => { if (!best) { modal('Pas encore de plan', '<p>Dessinez votre AUTO sur le terrain (ou optimisez-le avec l\'IA).</p>'); return false; } return true; };
  $('dlJava').addEventListener('click', () => { if (needPlan()) download('AutoBiobuzzIA.java', exportTexts().java, 'text/x-java'); });
  $('dlBlk').addEventListener('click', () => { if (needPlan()) download('AutoBiobuzzIA.blk', exportTexts().blk, 'application/xml'); });
  $('showJava').addEventListener('click', () => { codeShown = 'java'; refreshExport(); });
  $('showBlk').addEventListener('click', () => { codeShown = 'blk'; refreshExport(); });
  $('showPedro').addEventListener('click', () => { codeShown = 'pedro'; refreshExport(); });
  $('dlPedro').addEventListener('click', () => { if (needPlan()) download('AutoBiobuzzIAPedro.java', exportTexts().pedro, 'text/x-java'); });
  $('copyCode').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('codeView').value); $('copyCode').innerHTML = ic('check') + 'Copié'; }
    catch (e) { $('codeView').select(); document.execCommand('copy'); }
    setTimeout(() => { $('copyCode').innerHTML = ic('copy') + 'Copier'; }, 1500);
  });

  // ---------------- Entraînement dans le cloud (GitHub Actions) ----------------
  $('dlCloudCfg').addEventListener('click', () => {
    const minutes = Math.max(5, Math.min(340, parseFloat($('sessMinutes').value) || 300));
    download('config.json', JSON.stringify({ version: 1, minutes, nom: $('sessName').value || robot.nom, robot, game, plan: myPlan, keepOrder: $('keepOrder').checked }, null, 2), 'application/json');
    $('sessLaunchStatus').textContent = `config.json téléchargé (${minutes} min) : déposez-le dans le dossier « entrainement » du dépôt sur GitHub.`;
  });

  // Charge un résultat (resultat.json ou data/cloud_result.js) : robot, match et meilleur plan.
  function loadCloudResult(sum) {
    if (!sum || !sum.plan) throw new Error('fichier sans plan');
    stopTraining();
    robot = merge(BZ.defaultRobot(), sum.robot);
    const g = merge(BZ.defaultGame(), sum.game);
    Object.assign(game, g, { zonePartenaire: null, departImpose: null, zones: (sum.game && sum.game.zones) || [] });
    if (sum.game && sum.game.zonePartenaire) game.zones.push(Object.assign({ id: 'zpart', kind: 'interdite', color: '#7a3cff' }, sum.game.zonePartenaire));
    fillForm($('robotForm'), robot);
    fillForm($('gameForm'), game);
    persist(); showRobotWarnings();
    ctx = null; opt = null; aiPreview = null;
    const p = sum.plan;
    myPlan = clone({ start: (sum.game && sum.game.departImpose) || p.start, startLock: !!(sum.game && sum.game.departImpose) || !!p.startLock, actions: p.actions, park: p.park || { on: false, t: 0.5 } });
    persistPlan();
    resim();
    pushState();
    setTime(0);
    $('cloudStatus').textContent = `Résultat chargé : ${best ? best.expected.toFixed(1) : '?'} pts espérés (entraînement de ${sum.minutes} min, ${sum.strategiesTestees || '?'} stratégies testées).`;
    if (robotModel) applyModel(false);
  }
  $('loadResult').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { loadCloudResult(JSON.parse(await f.text())); }
    catch (err) { modal('Résultat invalide', '<p>Choisissez le fichier <b>resultat.json</b> du dossier « entrainement ».</p>'); }
  });
  if (window.CLOUD_RESULT && window.CLOUD_RESULT.plan) {
    const c = window.CLOUD_RESULT;
    const d = new Date(c.date);
    $('cloudBanner').hidden = false;
    $('cloudBanner').innerHTML = `Résultat d'un entraînement dans le cloud trouvé : <b>${c.score.toFixed(1)} pts</b> espérés, ${c.minutes} min, le ${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` +
      (c.termine ? '' : ' (pas terminé)') + '. <button class="btn primary" id="useCloud" type="button">Charger ce résultat</button>';
    $('useCloud').addEventListener('click', () => loadCloudResult(c));
  }

  // ---------------- Sessions dans le cloud (pilotées depuis l'appli) ----------------
  const GH_KEY = 'biobuzz-gh-v1';
  let ghSettings = null;
  try { ghSettings = JSON.parse(localStorage.getItem(GH_KEY) || 'null'); } catch (e) { ghSettings = null; }
  let cloud = null;
  let sessTimer = null;
  let lastSessions = [];
  if (ghSettings) {
    $('ghRepo').value = ghSettings.owner + '/' + ghSettings.repo;
    $('ghBranch').value = ghSettings.branch;
    $('ghToken').value = ghSettings.token;
  }
  const fmtDate = (d) => { if (!d) return '–'; const x = new Date(d); return x.toLocaleDateString('fr-FR') + ' ' + x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };

  async function ghConnect(silent) {
    const [owner, repo] = ($('ghRepo').value || '').trim().split('/');
    const token = ($('ghToken').value || '').trim();
    if (!owner || !repo || !token) { if (!silent) $('ghState').textContent = 'Indiquez le dépôt et collez le jeton.'; return false; }
    ghSettings = { owner, repo, branch: ($('ghBranch').value || 'main').trim(), token };
    cloud = new BZ.Cloud(ghSettings);
    $('ghState').textContent = 'Connexion…';
    try {
      const info = await cloud.check();
      try { localStorage.setItem(GH_KEY, JSON.stringify(ghSettings)); } catch (e) { /* pas de stockage */ }
      $('ghState').innerHTML = okTxt(`Connecté à <b>${esc(info.fullName)}</b>`) +
        (info.private ? ' · dépôt privé : 2000 min de calcul gratuites par mois' : ' · dépôt public : calcul illimité');
      await refreshSessions();
      clearInterval(sessTimer);
      sessTimer = setInterval(() => refreshSessions(true), 60000);
      return true;
    } catch (err) {
      cloud = null;
      $('ghState').innerHTML = badTxt(esc(err.message));
      return false;
    }
  }
  $('ghConnect').addEventListener('click', () => ghConnect(false));
  $('ghForget').addEventListener('click', () => {
    try { localStorage.removeItem(GH_KEY); } catch (e) { /* rien */ }
    ghSettings = null; cloud = null; clearInterval(sessTimer);
    $('ghToken').value = '';
    $('ghState').textContent = 'Jeton oublié. Non connecté.';
    $('sessList').innerHTML = '<p class="hint">Connectez GitHub pour voir vos sessions.</p>';
  });

  function sessionTexts(res) {
    const r2 = merge(BZ.defaultRobot(), res.robot);
    const g2 = merge(BZ.defaultGame(), res.game);
    g2.zonePartenaire = (res.game && res.game.zonePartenaire) || null;
    g2.departImpose = (res.game && res.game.departImpose) || null;
    const o = new BZ.Optimizer(window.FIELD, r2, g2, { seed: 1, popSize: 2 });
    const r = o.sim.run(res.plan);
    const startText = res.departTexte || BZ.describeStart(o.world, r.plan.start, r2);
    return { java: BZ.exportJava(r, r2, { startText }), blk: BZ.exportBlockly(r, r2, { startText }) };
  }

  let sessKnown = null; // statut des sessions au dernier passage (pour annoncer celles qui se terminent)
  function renderSessions(list) {
    const ended = sessKnown ? list.filter((x) => x.status === 'completed' && sessKnown[x.id] && sessKnown[x.id] !== 'completed') : [];
    sessKnown = {};
    for (const x of list) sessKnown[x.id] = x.status;
    lastSessions = list;
    for (const x of ended) chatEvent(`La session dans le cloud « ${x.nom} » (id ${x.id}) vient de se terminer : ${JSON.stringify(sessBrief(x))}. Annonce-le et propose de charger son résultat (charger_session).`);
    const best = BZ.bestSession(list);
    const running = list.filter((s) => s.status !== 'completed').length;
    $('optDotLabel').textContent = running ? `Assistant (${running} en cours)` : 'Assistant';
    if (!list.length) { $('sessList').innerHTML = '<p class="hint">Aucune session pour l\'instant : bouton « Nouvelle session » ou demandez-le au chat.</p>'; $('bestCard').hidden = true; return; }
    const card = (s) => {
      const r = s.result;
      let badge;
      if (s.status === 'queued' || s.status === 'waiting' || s.status === 'requested' || s.status === 'pending') badge = '<span class="badge wait">En attente</span>';
      else if (s.status !== 'completed') badge = '<span class="badge run">En cours</span>';
      else if (s.conclusion === 'success') badge = '<span class="badge ok">Terminée</span>';
      else if (s.conclusion === 'cancelled') badge = '<span class="badge wait">Annulée</span>';
      else badge = '<span class="badge ko">Échouée</span>';
      let bar = '';
      if (s.status !== 'completed' && s.debut) {
        const prev = (r && r.minutesPrevues) || null;
        const el = (Date.now() - new Date(s.debut).getTime()) / 60000;
        bar = prev ? `<div class="bar"><i style="width:${Math.min(100, (el / prev) * 100).toFixed(0)}%"></i></div><div class="sess-meta">${Math.round(el)} / ${Math.round(prev)} min</div>`
          : `<div class="sess-meta">démarrée il y a ${Math.round(el)} min (premier point d'étape après 15 min)</div>`;
      }
      const meta = [
        r && r.robot ? 'Robot : ' + esc(r.robot.nom) + ' (' + esc(r.robot.chassis) + ')' : null,
        'Lancée le ' + fmtDate(s.debut),
        r ? `${r.minutes} min d'entraînement · ${(r.strategiesTestees || 0).toLocaleString('fr-FR')} stratégies testées` : null,
      ].filter(Boolean).join(' · ');
      const actions = [];
      if (r && r.plan) {
        actions.push(`<button class="btn primary" data-act="load" data-id="${s.id}" type="button">Charger</button>`);
        actions.push(`<button class="btn" data-act="java" data-id="${s.id}" type="button">.java</button>`);
        actions.push(`<button class="btn" data-act="blk" data-id="${s.id}" type="button">.blk</button>`);
      }
      if (s.status !== 'completed') actions.push(`<button class="btn ghost" data-act="cancel" data-id="${s.id}" type="button">Arrêter</button>`);
      if (s.url) actions.push(`<a class="btn ghost" href="${esc(s.url)}" target="_blank" rel="noopener">GitHub${ic('external')}</a>`);
      return `<div class="sess${best && best.id === s.id ? ' best' : ''}">
        <div class="sess-head"><span class="sess-name">${esc(s.nom)}</span>${badge}</div>
        <div class="sess-meta">${meta}</div>${bar}
        ${r ? `<div class="sess-head"><span>${r.termine ? 'Meilleur score' : 'Meilleur score (point d\'étape)'}</span><span class="sess-score">${r.score.toFixed(1)} pts</span></div>
        <div class="sess-meta">Bascules espérées ${r.bascules.toFixed(2)} · LEAVE ${r.leave ? 'oui' : 'non'} · PARK ${r.park ? 'oui' : 'non'} · plan de ${r.duree.toFixed(1)} s · ${r.fautes.length ? 'fautes : ' + esc(r.fautes.join(', ')) : 'aucune faute'}</div>` : ''}
        <div class="row">${actions.join('')}</div></div>`;
    };
    $('sessList').innerHTML = list.map(card).join('');
    if (best) {
      $('bestCard').hidden = false;
      $('bestSession').innerHTML = `<p><b>${best.result.score.toFixed(1)} pts</b> espérés · session « ${esc(best.nom)} » (${esc(best.result.robot ? best.result.robot.nom : '')}), ${fmtDate(best.debut)}</p>
        <div class="row"><button class="btn primary" data-act="load" data-id="${best.id}" type="button">Charger et rejouer</button>
        <button class="btn" data-act="java" data-id="${best.id}" type="button">Télécharger .java</button>
        <button class="btn" data-act="blk" data-id="${best.id}" type="button">Télécharger .blk</button></div>`;
    } else $('bestCard').hidden = true;
  }

  async function refreshSessions(silent) {
    if (!cloud) return;
    try {
      renderSessions(await cloud.sessions());
      $('sessUpdated').textContent = 'Mis à jour à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ' (actualisation automatique chaque minute).';
    } catch (err) {
      if (!silent) $('sessUpdated').innerHTML = badTxt(esc(err.message));
    }
  }
  $('sessRefresh').addEventListener('click', () => (cloud ? refreshSessions() : ghConnect(false)));

  document.getElementById('page-chat').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const s = lastSessions.find((x) => x.id === b.dataset.id);
    if (!s) return;
    const act = b.dataset.act;
    try {
      if (act === 'load') loadCloudResult(s.result);
      else if (act === 'java') download('AutoBiobuzzIA.java', sessionTexts(s.result).java, 'text/x-java');
      else if (act === 'blk') download('AutoBiobuzzIA.blk', sessionTexts(s.result).blk, 'application/xml');
      else if (act === 'cancel') {
        if (!(await confirmModal('Arrêter la session ?', `<p>La session « ${esc(s.nom)} » sera arrêtée. Le dernier point d'étape enregistré est gardé.</p>`, 'Arrêter', 'Continuer'))) return;
        await cloud.cancel(s.id);
        setTimeout(() => refreshSessions(), 3000);
      }
    } catch (err) { modal('Action impossible', `<p>${esc(err.message)}</p>`); }
  });

  // Lance une session dans le cloud (bouton de la page, ou carte proposée par le chat). Lève une erreur lisible.
  async function launchSession(nom, minutes) {
    if (!cloud && !(await ghConnect(false))) throw new Error('GitHub n\'est pas connecté : l\'équipe doit coller son jeton GitHub (github_pat_…) seul dans le chat.');
    minutes = Math.max(5, Math.min(340, minutes || 300));
    nom = (nom || '').trim() || `${robot.nom} · ${new Date().toLocaleDateString('fr-FR')}`;
    await cloud.launch(nom, minutes, { version: 1, nom, minutes, robot, game, plan: myPlan, keepOrder: $('keepOrder').checked });
    setTimeout(() => refreshSessions(), 6000);
    setTimeout(() => refreshSessions(), 20000);
    return { nom, minutes };
  }
  $('sessLaunch').addEventListener('click', async () => {
    $('sessLaunch').disabled = true;
    $('sessLaunchStatus').textContent = 'Lancement…';
    try {
      const { nom, minutes } = await launchSession($('sessName').value, parseFloat($('sessMinutes').value));
      $('sessLaunchStatus').innerHTML = okTxt(`Session « ${esc(nom)} » lancée pour ${minutes} min.`) + ` Elle apparaît dans la liste d'ici quelques secondes. Vous pouvez éteindre l'ordinateur.`;
    } catch (err) {
      $('sessLaunchStatus').innerHTML = badTxt(esc(err.message));
    } finally {
      $('sessLaunch').disabled = false;
    }
  });
  if (ghSettings && ghSettings.token) ghConnect(true);

  // ---------------- Assistant IA (page 2) : Gemini, tout se fait dans le chat ----------------
  const CHAT_KEY = 'biobuzz-gemini-v1';
  let chatCfg = { key: '', model: BZ.CHAT_MODELS[0].id };
  try { chatCfg = Object.assign(chatCfg, JSON.parse(localStorage.getItem(CHAT_KEY) || '{}')); } catch (e) { /* rien */ }
  // clé écrite dans le fichier local cle-gemini.js (ignoré par git), si l'équipe l'a créé
  const fileKey = typeof window.BIOBUZZ_CLE_GEMINI === 'string' && !/COLLEZ/.test(window.BIOBUZZ_CLE_GEMINI) ? window.BIOBUZZ_CLE_GEMINI.trim() : '';
  if (!chatCfg.key && fileKey) chatCfg.key = fileKey;
  // relais de l'équipe (js/config.js) : utilisé quand personne n'a mis sa propre clé
  const relay = typeof window.BIOBUZZ_RELAIS_GEMINI === 'string' ? window.BIOBUZZ_RELAIS_GEMINI.trim() : '';
  const chatAuth = () => (chatCfg.key ? { key: chatCfg.key } : relay ? { relay, code: chatCfg.code || '' } : null);
  let chatModels = BZ.CHAT_MODELS.slice();
  const modelName = () => (chatModels.find((m) => m.id === chatCfg.model) || {}).nom || chatCfg.model;
  const chatSetupLabel = () => { $('chatSetupSum').textContent = chatAuth() ? modelName() + (chatCfg.key ? '' : ' · clé de l\'équipe') : 'pas encore de clé Gemini'; };
  const saveChat = () => { try { localStorage.setItem(CHAT_KEY, JSON.stringify(chatCfg)); } catch (e) { /* rien */ } chatSetupLabel(); };
  // avec une clé : la vraie liste des modèles Gemini de ce compte (lève l'erreur si la clé est refusée)
  async function loadModels() {
    const list = await BZ.geminiModels(chatAuth());
    if (list.length) {
      chatModels = list;
      if (!list.some((m) => m.id === chatCfg.model)) chatCfg.model = (list.find((m) => /flash/i.test(m.id) && !/lite/i.test(m.id)) || list[0]).id;
      saveChat();
    }
    return list;
  }
  chatSetupLabel();
  if (chatAuth()) loadModels().catch(() => { /* l'erreur sera dite au premier message */ });

  const settingTarget = (chemin) => (chemin.startsWith('robot.') ? [robot, chemin.slice(6)] : [game, chemin.slice(6)]);
  const readSetting = (chemin) => { const [o, p] = settingTarget(chemin); return clone(getPath(o, p)); };
  const writeSetting = (chemin, v) => { const [o, p] = settingTarget(chemin); setPath(o, p, clone(v)); };
  function settingsNow() {
    const out = {};
    for (const k of Object.keys(BZ.CHAT_SETTINGS)) out[k] = readSetting(k);
    out['robot.longueur_cm'] = robot.longueur_cm; out['robot.largeur_cm'] = robot.largeur_cm; out['robot.hauteur_cm'] = robot.hauteur_cm;
    return out;
  }
  function applySettings(list) {
    for (const c of list) writeSetting(c.chemin, c.valeur);
    fillForm($('robotForm'), robot); fillForm($('gameForm'), game);
    markOdo(); persist(); showRobotWarnings(); invalidate();
  }

  const chatLog = $('chatLog');
  const chatScroll = () => { chatLog.scrollTop = chatLog.scrollHeight; };
  function chatMsg(cls, html) {
    const d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.innerHTML = html;
    chatLog.appendChild(d); chatScroll();
    return d;
  }
  const mdLite = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<span class="mono">$1</span>');
  function chatCard(html) {
    const d = document.createElement('div');
    d.className = 'propose';
    d.innerHTML = html;
    chatLog.appendChild(d); chatScroll();
    return d;
  }

  // Clés et jetons collés dans le chat : interceptés ici, gardés dans le navigateur, jamais envoyés à l'IA.
  const GEMINI_RE = /(AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{20,})/;
  const GH_RE = /(github_pat_[0-9A-Za-z_]{20,}|gh[pousr]_[0-9A-Za-z]{20,})/;
  const mask = (k) => k.slice(0, 6) + '••••' + k.slice(-4);
  async function useGeminiKey(k) {
    const old = chatCfg.key;
    chatCfg.key = k;
    const wait = chatMsg('ai', 'Je vérifie la clé auprès de Google…');
    try {
      const list = await loadModels();
      wait.innerHTML = okTxt('Clé Gemini enregistrée sur cet appareil.') + ` ${esc(list.length + (list.length > 1 ? ' modèles disponibles' : ' modèle disponible') + ', j\'utilise ' + modelName() + '.')} Je suis prêt : demandez-moi par exemple « optimise mon plan » ou « lance une session de 2 h ».`;
    } catch (err) {
      chatCfg.key = old; saveChat();
      wait.className = 'msg err';
      wait.textContent = BZ.chatErrorText(err) + ' La clé n\'a pas été enregistrée.';
    }
  }
  async function useGithubToken(t) {
    $('ghToken').value = t;
    const wait = chatMsg('ai', 'Je me connecte à GitHub…');
    if (await ghConnect(false)) {
      wait.innerHTML = okTxt(`GitHub connecté (${esc(ghSettings.owner + '/' + ghSettings.repo)}, branche ${esc(ghSettings.branch)}).`) + ' Le jeton reste dans ce navigateur. Vous pouvez me demander de lancer une session ou de suivre vos sessions.';
    } else {
      wait.className = 'msg err';
      wait.textContent = 'Connexion à GitHub impossible : ' + $('ghState').textContent;
    }
  }
  // Commandes simples gérées sans l'IA ; renvoie true si le message est traité.
  async function localCommand(text) {
    const gm = text.match(GEMINI_RE), hm = text.match(GH_RE);
    if (gm || hm) {
      const k = (gm || hm)[0];
      chatMsg('me', esc(text.replace(k, mask(k))));
      if (text.trim() !== k) { chatMsg('err', 'Par sécurité, rien n\'a été envoyé : collez la clé ou le jeton seul dans un message, sans autre texte.'); return true; }
      if (gm) await useGeminiKey(k); else await useGithubToken(k);
      return true;
    }
    // « utilise gemini-2.5-flash-lite » : changé ici, sans l'IA (marche même quota épuisé)
    const mod = text.match(/^(?:utilise|prends|passe (?:à|a|sur))\s+(?:le modèle\s+)?(gemini[\w.-]*)\s*\.?$/i);
    if (mod) {
      chatMsg('me', esc(text));
      const want = mod[1].toLowerCase();
      const m = chatModels.find((x) => x.id === want) || chatModels.find((x) => x.id.startsWith(want));
      if (m) { chatCfg.model = m.id; saveChat(); chatMsg('ai', `C'est noté, j'utilise maintenant ${m.nom || m.id}.`); }
      else chatMsg('err', 'Modèle inconnu. Disponibles : ' + chatModels.map((x) => x.id).join(', '));
      return true;
    }
    const code = text.match(/^code d['’]équipe\s*:?\s*(\S+)$/i);
    if (code) { chatMsg('me', 'Code d\'équipe : ••••'); chatCfg.code = code[1]; saveChat(); chatMsg('ai', 'Code d\'équipe enregistré sur cet appareil.'); return true; }
    if (/^(oublie|efface|supprime)\s+(ma|la)\s+clé/i.test(text)) { chatMsg('me', esc(text)); chatCfg.key = ''; saveChat(); chatMsg('ai', 'Clé Gemini oubliée sur cet appareil.' + (chatAuth() ? ' J\'utilise maintenant la clé de l\'équipe.' : ' Collez une nouvelle clé pour continuer.')); return true; }
    if (/^(oublie|efface|supprime)\s+(mon|le)\s+jeton/i.test(text)) { chatMsg('me', esc(text)); $('ghForget').click(); chatMsg('ai', 'Jeton GitHub oublié sur cet appareil.'); return true; }
    if (!chatAuth()) {
      chatMsg('me', esc(text));
      chatMsg('ai', 'Pour discuter, collez d\'abord votre clé API Gemini, seule dans un message. Vous la créez gratuitement sur aistudio.google.com/app/apikey (« Create API key ») ; elle reste dans ce navigateur.');
      return true;
    }
    return false;
  }

  // Événements de l'appli racontés par l'IA (fin d'optimisation, session terminée) : en file d'attente.
  const pendingEvents = [];
  function chatEvent(text) {
    if (!chatAuth()) return;
    pendingEvents.push('[Événement de l\'appli] ' + text);
    flushEvents();
  }
  function flushEvents() {
    if (assistant.busy || !pendingEvents.length) return;
    chatSend(pendingEvents.shift(), true);
  }
  const brief = (r) => (r ? { score_espere: Math.round(r.expected * 10) / 10, duree_s: Math.round(r.endT * 10) / 10, bascules_esperees: Math.round(r.eTips * 100) / 100, chances_2_bascules: Math.round(r.tipsAtLeast[2] * 100) + ' %', fautes: r.faults.map((f) => f.rule) } : null);
  let optAnnounce = false;
  function onOptimizationDone() {
    if (!optAnnounce) return;
    optAnnounce = false;
    chatEvent(`L'optimisation est terminée (${opt ? opt.generation : 0} générations). Plan de l'équipe : ${JSON.stringify(brief(simulate(myPlan)))}. Meilleur plan trouvé, en aperçu sur le terrain : ${JSON.stringify(brief(opt && opt.best ? opt.best.result : null))}. Annonce le résultat et demande si l'équipe garde ce plan.`);
  }
  const sessLabel = (s) => (s.status === 'queued' || s.status === 'waiting' || s.status === 'requested' || s.status === 'pending' ? 'en attente'
    : s.status !== 'completed' ? 'en cours' : s.conclusion === 'success' ? 'terminée' : s.conclusion === 'cancelled' ? 'annulée' : 'échouée');
  const sessBrief = (s) => {
    const r = s.result;
    const o = { id: String(s.id), nom: s.nom, statut: sessLabel(s), lancee_le: fmtDate(s.debut) };
    if (s.status !== 'completed' && s.debut) o.minutes_ecoulees = Math.round((Date.now() - new Date(s.debut).getTime()) / 60000);
    if (r) Object.assign(o, { minutes_prevues: r.minutesPrevues || null, meilleur_score: Math.round(r.score * 10) / 10, resultat_final: !!r.termine, bascules_esperees: r.bascules, leave: r.leave, park: r.park, duree_plan_s: r.duree, fautes: r.fautes, robot: r.robot ? r.robot.nom : null });
    return o;
  };
  async function needCloud() {
    if (cloud) return;
    if (!(ghSettings && ghSettings.token && (await ghConnect(true)))) throw new Error('GitHub n\'est pas connecté : l\'équipe doit coller son jeton GitHub (github_pat_…) seul dans le chat.');
  }

  const assistant = new BZ.Assistant({
    world: worldNow,
    robot: () => robot,
    plan: () => myPlan,
    simulate: (plan) => simulate(plan),
    settings: () => ({ reglages: settingsNow(), modifiables: Object.keys(BZ.CHAT_SETTINGS) }),
    context: () => ({
      reglages: settingsNow(),
      zones: (game.zones || []).map((z) => ({ id: z.id, type: z.kind, x0: Math.round(Math.min(z.x0, z.x1)), x1: Math.round(Math.max(z.x0, z.x1)), y0: Math.round(Math.min(z.y0, z.y1)), y1: Math.round(Math.max(z.y0, z.y1)) })),
      plan_actuel: BZ.planToTool(myPlan),
      resultat_du_plan: BZ.resultSummary(simulate(myPlan)),
      optimisation: {
        en_cours: training,
        generation: opt ? opt.generation : 0,
        meilleur_score: opt && opt.best ? Math.round(opt.best.result.expected * 10) / 10 : null,
        apercu_du_plan_ia_affiche: !!aiPreview,
      },
      sessions_cloud: cloud ? { github_connecte: true, sessions: lastSessions.slice(0, 8).map(sessBrief) } : { github_connecte: false },
      resultat_cloud_disponible: window.CLOUD_RESULT && window.CLOUD_RESULT.plan ? { score: window.CLOUD_RESULT.score, id_pour_charger: 'resultat_cloud' } : null,
    }),
    optimize({ generations, keepOrder }) {
      $('maxGen').value = String(generations);
      if ($('keepOrder').checked !== keepOrder) { $('keepOrder').checked = keepOrder; opt = null; }
      if (opt && opt.generation >= generations) opt = null; // déjà fini : on repart de zéro
      optAnnounce = true;
      if (!training) startTraining();
      const card = chatCard(`<h4>${ic('sliders')}Optimisation en cours</h4><div class="hint" data-prog>Génération 0 / ${generations}</div>` +
        '<div class="row"><button class="btn ghost" data-a="stop" type="button">Arrêter</button></div>');
      const prog = card.querySelector('[data-prog]');
      const tick = setInterval(() => {
        const g = opt ? opt.generation : 0, b = opt && opt.best ? opt.best.result : null;
        prog.textContent = `Génération ${g} / ${generations}` + (b ? ` · meilleur : ${b.expected.toFixed(1)} pts, ${b.endT.toFixed(1)} s` : '');
        if (!training) {
          clearInterval(tick);
          card.querySelector('h4').innerHTML = ic('sliders') + 'Optimisation terminée';
          card.querySelector('.row').innerHTML = b && aiPreview ? '<button class="btn primary" data-a="keep" type="button">Garder ce plan</button><button class="btn ghost" data-a="drop" type="button">Revenir à mon plan</button>' : '<span class="hint">Arrêtée.</span>';
        }
      }, 400);
      card.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        if (b.dataset.a === 'stop') { optAnnounce = false; stopTraining(); }
        else if (b.dataset.a === 'keep' && aiPreview) { keepAi(); card.querySelector('.row').innerHTML = okTxt('Plan gardé (Annuler pour revenir)'); card.classList.add('done'); }
        else if (b.dataset.a === 'drop') { dropAi(); card.querySelector('.row').innerHTML = '<span class="hint">Votre plan est gardé.</span>'; card.classList.add('done'); }
      });
      return { statut: "lancée sur cet ordinateur ; à la fin, l'appli t'enverra le résultat", generations, garder_ordre: keepOrder };
    },
    stopOptimization() {
      if (!training) return { statut: 'aucune optimisation en cours' };
      optAnnounce = false;
      stopTraining();
      return { statut: 'arrêtée', generation: opt ? opt.generation : 0, meilleur: brief(opt && opt.best ? opt.best.result : null) };
    },
    keepAiPlan(garder) {
      if (!aiPreview) throw new Error('aucun plan de l\'IA en aperçu sur le terrain');
      if (garder) keepAi(); else dropAi();
      return { statut: garder ? 'plan de l\'IA gardé (Annuler dans l\'appli pour revenir)' : 'retour au plan de l\'équipe' };
    },
    setModel(id) {
      if (!id) return { actuel: chatCfg.model, disponibles: chatModels.map((m) => m.id) };
      if (!chatModels.some((m) => m.id === id)) throw new Error('modèle inconnu ; disponibles : ' + chatModels.map((m) => m.id).join(', '));
      chatCfg.model = id; saveChat();
      return { statut: 'modèle changé à partir du prochain message', modele: id };
    },
    async launchSession(nom, minutes) {
      await needCloud();
      const r = await launchSession(nom, minutes);
      return { statut: 'lancée : elle apparaît dans la liste des sessions d\'ici quelques secondes ; l\'ordinateur peut être éteint', nom: r.nom, minutes: r.minutes };
    },
    async listSessions() {
      await needCloud();
      const list = await cloud.sessions();
      renderSessions(list);
      const best = BZ.bestSession(list);
      return { sessions: list.slice(0, 12).map(sessBrief), meilleure: best ? String(best.id) : null };
    },
    async loadSession(id) {
      if (id === 'resultat_cloud') {
        if (!(window.CLOUD_RESULT && window.CLOUD_RESULT.plan)) throw new Error('pas de résultat cloud intégré à l\'appli');
        loadCloudResult(window.CLOUD_RESULT);
        return { statut: 'résultat cloud chargé : robot, match et plan remplacés, visibles sur le terrain', score: window.CLOUD_RESULT.score };
      }
      await needCloud();
      if (!lastSessions.length) renderSessions(await cloud.sessions());
      const s = id === 'meilleure' ? BZ.bestSession(lastSessions) : lastSessions.find((x) => String(x.id) === id);
      if (!s) throw new Error('session introuvable (voir lister_sessions)');
      if (!s.result || !s.result.plan) throw new Error('cette session n\'a pas encore de résultat (premier point d\'étape après 15 min)');
      loadCloudResult(s.result);
      return { statut: 'chargée : robot, match et meilleur plan de la session sont dans l\'appli (terrain et page Code)', nom: s.nom, score: s.result.score };
    },
    async cancelSession(id) {
      await needCloud();
      const s = lastSessions.find((x) => String(x.id) === id);
      if (s && s.status === 'completed') throw new Error('cette session est déjà terminée');
      await cloud.cancel(id);
      setTimeout(() => refreshSessions(true), 3000);
      return { statut: 'arrêt demandé ; le dernier point d\'étape est gardé', nom: s ? s.nom : id };
    },
    proposePlan(plan, why, r) {
      const cur = simulate(myPlan);
      const card = chatCard(`<h4>${ic('list')}Plan proposé : ${r.expected.toFixed(1)} pts · ${r.endT.toFixed(1)} s</h4>` +
        `<div class="hint">Votre plan : ${cur ? cur.expected.toFixed(1) + ' pts · ' + cur.endT.toFixed(1) + ' s' : '–'} · 2 bascules : ${Math.round(r.tipsAtLeast[2] * 100)} % · fautes : ${r.faults.length ? r.faults.map((f) => f.rule).join(', ') : 'aucune'}</div>` +
        `<div>${mdLite(why)}</div><div class="row"><button class="btn" data-a="see" type="button">Voir sur le terrain</button><button class="btn primary" data-a="apply" type="button">Appliquer</button><button class="btn ghost" data-a="skip" type="button">Ignorer</button></div>`);
      card.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        if (b.dataset.a === 'see') { stopTraining(); aiPreview = { result: r, plan: clone(plan) }; resim(); pushState(); return; }
        if (b.dataset.a === 'apply') { stopTraining(); aiPreview = { result: r, plan: clone(plan) }; keepAi(); card.querySelector('.row').innerHTML = okTxt('Appliqué (Annuler pour revenir)'); }
        else card.querySelector('.row').innerHTML = '<span class="hint">Ignoré</span>';
        card.classList.add('done');
      });
    },
    proposeSettings(list, why) {
      const before = list.map((c) => ({ chemin: c.chemin, valeur: readSetting(c.chemin) }));
      const fmt = (v) => esc(Array.isArray(v) ? v.join(' / ') : String(v));
      const card = chatCard(`<h4>${ic('sliders')}Réglages proposés</h4><div>${mdLite(why)}</div><table>${list.map((c, i) => `<tr><td class="mono">${esc(c.chemin)}</td><td>${fmt(before[i].valeur)}</td><td>→</td><td><b>${fmt(c.valeur)}</b></td></tr>`).join('')}</table>` +
        '<div class="row"><button class="btn primary" data-a="apply" type="button">Appliquer</button><button class="btn ghost" data-a="skip" type="button">Ignorer</button></div>');
      card.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        const row = card.querySelector('.row');
        if (b.dataset.a === 'apply') { applySettings(list); row.innerHTML = okTxt('Appliqué') + ' <button class="btn" data-a="undo" type="button">Annuler</button>'; }
        else if (b.dataset.a === 'undo') { applySettings(before); row.innerHTML = '<span class="hint">Annulé</span>'; card.classList.add('done'); }
        else { row.innerHTML = '<span class="hint">Ignoré</span>'; card.classList.add('done'); }
      });
    },
  });

  const TOOL_TXT = {
    simuler_plan: ['wrench', 'essaie une variante'], proposer_plan: ['list', 'propose un plan'], lire_reglages: ['search', 'lit les réglages'],
    modifier_reglages: ['sliders', 'propose des réglages'], optimiser_plan: ['play', 'lance l\'optimisation'], arreter_optimisation: ['pause', 'arrête l\'optimisation'],
    garder_plan_ia: ['check', 'met à jour le plan'], lancer_session_cloud: ['cloud', 'lance une session dans le cloud'], lister_sessions: ['list', 'regarde les sessions'],
    charger_session: ['download', 'charge un résultat'], arreter_session: ['x', 'arrête une session'], changer_modele: ['sliders', 'change de modèle'],
  };
  // hidden = message de l'appli (événement) : pas de bulle « moi »
  async function chatSend(text, hidden) {
    text = (text || '').trim();
    if (!text) return;
    if (assistant.busy) { if (hidden) pendingEvents.unshift(text); return; }
    if (!hidden) {
      $('chatInput').value = '';
      $('chatSugg').hidden = true;
      if (await localCommand(text)) return;
      chatMsg('me', esc(text));
    }
    if (!chatAuth()) return;
    $('chatSend').textContent = 'Stop';
    let bubble = null, buf = '', toolLine = null;
    await assistant.send(text, chatAuth(), chatCfg.model, {
      onTurnStart() { bubble = null; buf = ''; },
      onText(d) {
        if (!bubble) bubble = chatMsg('ai typing', '');
        buf += d; bubble.textContent = buf; chatScroll();
      },
      // la ligne d'outil s'affiche avant la carte que l'outil peut ajouter, puis se complète
      onToolStart(name) {
        if (bubble) { bubble.classList.remove('typing'); bubble.innerHTML = mdLite(buf); bubble = null; buf = ''; }
        const [tn, tt] = TOOL_TXT[name] || ['wrench', name];
        toolLine = chatMsg('tool', ic(tn) + esc(tt + '…'));
      },
      onTool(name, input, res) {
        let extra = '';
        if (name === 'simuler_plan' && !res.is_error) { try { const r = JSON.parse(res.content); extra = ` → ${r.score_espere} pts, ${r.duree_s} s`; } catch (e) { /* rien */ } }
        const [tn, tt] = TOOL_TXT[name] || ['wrench', name];
        if (toolLine) toolLine.innerHTML = ic(tn) + esc(tt + extra + (res.is_error ? ' (erreur : ' + res.content.replace(/^Erreur : /, '') + ')' : ''));
      },
      // quota gratuit par minute : l'assistant attend et réessaie tout seul
      onWait(sec) {
        if (bubble) { bubble.classList.remove('typing'); bubble.innerHTML = mdLite(buf); bubble = null; buf = ''; }
        const w = chatMsg('tool', ic('clock') + esc(`quota gratuit de Google atteint pour cette minute : je réessaie dans ${sec} s…`));
        setTimeout(() => w.remove(), sec * 1000 + 500);
      },
      onDone() { if (bubble) { bubble.classList.remove('typing'); bubble.innerHTML = mdLite(buf); } },
      onError(msg) { if (bubble) { bubble.classList.remove('typing'); } chatMsg('err', esc(msg)); },
    });
    $('chatSend').textContent = 'Envoyer';
    flushEvents();
  }
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (assistant.busy) { if (assistant.abort) assistant.abort(); return; }
    chatSend($('chatInput').value);
  });
  $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chatForm').requestSubmit(); } });
  $('chatSugg').addEventListener('click', (e) => { const b = e.target.closest('.chip2'); if (b) chatSend(b.textContent); });
  function chatWelcome() {
    if (!chatAuth()) chatMsg('ai', 'Bonjour ! Je suis l\'assistant BIOBUZZ. Pour commencer, collez ici votre clé API Gemini, seule dans le message. Vous la créez gratuitement sur aistudio.google.com/app/apikey (« Create API key ») ; elle reste dans ce navigateur.');
    else chatMsg('ai', 'Bonjour ! Dites-moi par exemple « optimise mon plan », « lance une session de 2 h », « où en sont mes sessions ? » ou « pourquoi je ne fais pas 2 bascules ? ».');
    if (window.CLOUD_RESULT && window.CLOUD_RESULT.plan) chatMsg('ai', `Un résultat d'entraînement dans le cloud est disponible (${window.CLOUD_RESULT.score.toFixed(1)} pts espérés). Dites « charge le résultat du cloud » pour l'utiliser.`);
  }
  $('chatNew').addEventListener('click', () => { if (assistant.busy) return; assistant.reset(); chatLog.innerHTML = ''; $('chatSugg').hidden = false; chatWelcome(); });

  chatWelcome();

  // ---------------- Démarrage ----------------
  const ua = navigator.userAgent || '';
  if (/Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua)) $('safariNote').hidden = false;
  showRobotWarnings();
  ensurePlan();
  if (legacyStart) persist();
  resim();
  pushState();
  setTime(0);
  try { const p = parseInt(localStorage.getItem(PAGE_KEY) || '0', 10); if (p) requestAnimationFrame(() => goPage(p, true)); } catch (e) { /* rien */ }
  BZ.loadRobotModel().then((m) => { robotModel = m; applyModel(false); });
  $('randomMatch').addEventListener('change', () => {
    randomSeed = (Date.now() & 0xffff) + 1;
    $('animNote').textContent = $('randomMatch').checked
      ? 'Animation : match tiré au hasard avec la précision du robot (décochez/recochez pour un autre tirage).'
      : 'Animation : tous les tirs possibles entrent. Le score affiché est l\'espérance.';
    pushState();
  });

  // Accès pour les tests automatisés
  window.BZApp = {
    get best() { return best; },
    get opt() { return opt; },
    get plan() { return myPlan; },
    view2dFrame: () => view2d.frame(),
    get game() { return game; },
    get editor() { return editor; },
    get aiPreview() { return aiPreview; },
    keepAi,
    setTool,
    assistant: () => assistant,
    goPage,
    train: startTraining,
    stop: stopTraining,
    setTime,
    exportTexts,
  };
})();
