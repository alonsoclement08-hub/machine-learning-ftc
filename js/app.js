// Interface : formulaire robot, contraintes du match, entraînement, rejeu, export.
(function () {
  'use strict';
  const BZ = window.BZ;
  const G = BZ.G;
  const $ = (id) => document.getElementById(id);

  // ---------------- État ----------------
  const LS_KEY = 'biobuzz-auto-ia-v1';
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

  let opt = null; // Optimizer courant
  let best = null; // meilleur résultat
  let training = false;
  let playing = false;
  let tNow = 0;
  let robotModel = null; // modèle 3D importé {name, meshes, rot}
  let robotTop = null; // silhouette vue de dessus (vue 2D)
  let startHeadingDeg = 0; // orientation pendant le placement du départ
  let codeShown = 'java';

  const persist = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ robot, game })); } catch (e) { /* pas de stockage */ }
  };

  const view2d = new BZ.Field2D($('field2d'));
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

  $('robotForm').addEventListener('input', () => {
    readForm($('robotForm'), robot);
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
    $('robotWarnings').innerHTML = w.map((x) => `<p>⚠ ${x}</p>`).join('');
  }

  // Liste des règles
  $('rulesList').innerHTML = Object.entries(BZ.RULES)
    .filter(([k]) => /^G/.test(k))
    .map(([k, r]) => `<li><b>${k}</b> – ${r.titre}. <span class="hint">${r.texte}</span></li>`).join('');

  // ---------------- Onglets ----------------
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'export') refreshExport();
  }));
  document.querySelectorAll('.segbtn').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.segbtn').forEach((x) => x.classList.toggle('active', x === b));
    const is3d = b.dataset.view === '3d';
    $('field2d').classList.toggle('active', !is3d);
    $('field3d').classList.toggle('active', is3d);
    if (is3d) { view3d.init(); view3d.resize(); pushState(); }
  }));

  // ---------------- Monde & optimiseur ----------------
  function makeOptimizer() {
    try {
      opt = new BZ.Optimizer(window.FIELD, robot, game, { seed: (Date.now() & 0xffff) + 1 });
      return true;
    } catch (e) {
      opt = null;
      modal('Impossible de lancer l\'IA', `<p>${e.message}</p>`);
      return false;
    }
  }

  function invalidate() {
    // les paramètres ont changé : le meilleur plan doit être recalculé
    currentWorld = null;
    stopTraining();
    opt = null;
    if (best) {
      // on rejoue l'ancien plan avec les nouveaux paramètres pour garder un affichage cohérent
      try {
        const o = new BZ.Optimizer(window.FIELD, robot, game, { seed: 1, popSize: 2 });
        const plan = Object.assign({}, best.plan);
        if (game.departImpose) plan.start = game.departImpose;
        best = o.sim.run(plan);
        opt = null;
        currentWorld = o.world;
      } catch (e) { best = null; }
    }
    $('genCount').textContent = '0';
    $('evalCount').textContent = '0';
    pushState();
  }

  let currentWorld = null;
  function worldNow() {
    if (opt) return opt.world;
    if (!currentWorld || currentWorld.rd.hl !== BZ.robotDerived(robot).hl) {
      currentWorld = BZ.buildWorld(window.FIELD, game, BZ.robotDerived(robot));
    }
    return currentWorld;
  }

  // Déroulé des tirs pour l'animation (nominal, ou tiré au hasard si « match aléatoire »).
  let randomSeed = 1;
  function outcomesFor(result, world) {
    if (!result) return null;
    const rng = $('randomMatch').checked ? G.rng(randomSeed) : null;
    return BZ.shotOutcomes(result, world, robot, game, rng);
  }

  // Pose affichée quand il n'y a pas encore de plan : départ imposé, sinon un départ légal.
  function idlePose(world) {
    if (game.departImpose) return game.departImpose;
    const starts = BZ.legalStarts(world, 6);
    return starts.find((s) => Math.abs(s.h) < 1e-6) || starts[0] || null;
  }

  function pushState(extra) {
    const world = worldNow();
    const st = Object.assign({
      alliance: game.alliance, robot, game, rd: BZ.robotDerived(robot), world, result: best,
      outcomes: outcomesFor(best, world), idlePose: best ? null : idlePose(world), robotTop,
    }, extra || {});
    view2d.setState(st);
    if (view3d.ready) view3d.setState(st);
    updateKpis();
    renderSteps();
  }

  function updateKpis() {
    const r = best;
    $('kpiScore').textContent = r ? r.expected.toFixed(1) + ' pts' : '–';
    $('kpiTips').textContent = r ? `${r.eTips.toFixed(2)} (max ${r.nominalTips})` : '–';
    $('kpiTime').textContent = r ? r.endT.toFixed(1) + ' s' : '–';
    const nf = r ? r.faults.length : null;
    $('kpiFaults').textContent = r ? (nf ? nf : 'aucune') : '–';
    $('kpiFaults').className = 'kpi-value ' + (r ? (nf ? 'bad' : 'good') : '');
    $('bestScore').textContent = r ? r.expected.toFixed(1) : '–';
  }

  function renderSteps() {
    const ol = $('planSteps');
    if (!best) { ol.innerHTML = '<li class="hint">Lancez l\'entraînement pour obtenir un plan.</li>'; $('faultList').innerHTML = ''; return; }
    const items = [];
    let lastLabel = null;
    for (const p of best.prims) {
      if (!p.label || p.label === lastLabel) continue;
      lastLabel = p.label;
      const now = tNow >= p.t0 && tNow < p.t1 ? ' class="now"' : '';
      items.push(`<li${now}><span class="t">${p.t0.toFixed(1)} s</span>${p.label}</li>`);
    }
    items.push(`<li><span class="t">${best.endT.toFixed(1)} s</span>Fin · LEAVE ${best.leave ? '✓' : '✗'} · PARK ${best.park ? '✓' : '✗'}</li>`);
    ol.innerHTML = items.join('');
    $('faultList').innerHTML = best.faults.length
      ? best.faults.map((f) => `<p>⚠ <b>${f.rule}</b> ${(BZ.RULES[f.rule] || {}).titre || ''} ${f.info ? '(' + f.info + ')' : ''} à ${f.t.toFixed(1)} s</p>`).join('')
      : '<p class="ok">✓ Aucune faute : le plan respecte les règles vérifiées.</p>';
  }

  // ---------------- Entraînement ----------------
  function drawChart() {
    const c = $('chart'), ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr; c.height = 140 * dpr;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!opt || !opt.history.length) return;
    const h = opt.history;
    const vals = h.map((x) => x.expected);
    const max = Math.max(10, ...vals) * 1.1;
    const pad = 24 * dpr;
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--line'); ctx.lineWidth = 1;
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--ink-2');
    ctx.font = `${10 * dpr}px system-ui`;
    for (let v = 0; v <= max; v += 20) {
      const y = c.height - pad / 2 - (v / max) * (c.height - pad);
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(c.width, y); ctx.stroke();
      ctx.fillText(String(v), 2, y + 3 * dpr);
    }
    ctx.strokeStyle = '#e0a100'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = pad + (i / Math.max(1, vals.length - 1)) * (c.width - pad - 4);
      const y = c.height - pad / 2 - (v / max) * (c.height - pad);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  function trainLoop() {
    if (!training) return;
    const t0 = performance.now();
    const maxGen = parseInt($('maxGen').value, 10) || 300;
    while (performance.now() - t0 < 30 && opt.generation < maxGen) opt.step();
    best = opt.bestResult();
    $('genCount').textContent = String(opt.generation);
    $('evalCount').textContent = String(opt.evals);
    drawChart();
    if (!playing) tNow = Math.min(tNow, 30);
    pushState();
    if (opt.generation >= maxGen) { stopTraining(); return; }
    requestAnimationFrame(trainLoop);
  }
  function startTraining() {
    if (!opt && !makeOptimizer()) return;
    training = true;
    $('trainBtn').textContent = '⏸ Pause';
    requestAnimationFrame(trainLoop);
  }
  function stopTraining() {
    training = false;
    $('trainBtn').textContent = opt && opt.generation ? '▶ Continuer' : '▶ Lancer l\'entraînement';
  }
  $('trainBtn').addEventListener('click', () => (training ? stopTraining() : startTraining()));
  $('resetTrain').addEventListener('click', () => {
    stopTraining(); opt = null; best = null;
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
  $('timeSlider').addEventListener('input', (e) => { playing = false; $('playBtn').textContent = '▶'; setTime(parseFloat(e.target.value)); });
  let lastFrame = 0;
  function playLoop(ts) {
    if (!playing) return;
    const dt = lastFrame ? (ts - lastFrame) / 1000 : 0;
    lastFrame = ts;
    setTime(tNow + dt);
    if (tNow >= Math.min(30, best ? best.endT + 0.5 : 30)) { playing = false; $('playBtn').textContent = '▶'; return; }
    requestAnimationFrame(playLoop);
  }
  $('playBtn').addEventListener('click', () => {
    if (!best) return;
    playing = !playing;
    $('playBtn').textContent = playing ? '⏸' : '▶';
    if (playing) {
      if (tNow >= Math.min(30, best.endT)) setTime(0);
      lastFrame = 0; requestAnimationFrame(playLoop);
    }
  });

  // ---------------- Contraintes sur le terrain ----------------
  function setMode(mode) {
    view2d.mode = mode;
    $('placeStart').classList.toggle('armed', mode === 'start');
    $('drawPartner').classList.toggle('armed', mode === 'partner');
    $('constraintStatus').textContent = mode === 'start' ? 'Bougez la souris sur le terrain : R/E ou Q pour tourner, clic pour poser.'
      : mode === 'partner' ? 'Glissez sur le terrain pour dessiner la zone du partenaire.' : constraintText();
    if (mode) document.querySelector('.segbtn[data-view="2d"]').click();
    if (mode !== 'start') pushState();
  }
  function constraintText() {
    const a = [];
    a.push(game.departImpose ? 'Départ imposé par vous.' : 'Départ choisi par l\'IA.');
    if (game.zonePartenaire) a.push('Zone partenaire définie.');
    return a.join(' ');
  }
  $('placeStart').addEventListener('click', () => {
    if (game.departImpose) startHeadingDeg = Math.round(G.deg(game.departImpose.h));
    setMode(view2d.mode === 'start' ? null : 'start');
  });
  $('drawPartner').addEventListener('click', () => setMode(view2d.mode === 'partner' ? null : 'partner'));
  $('clearStart').addEventListener('click', () => { game.departImpose = null; persist(); setMode(null); invalidate(); });
  $('clearPartner').addEventListener('click', () => { game.zonePartenaire = null; persist(); setMode(null); invalidate(); });

  // Colle le robot au mur le plus proche de notre côté, avec l'orientation choisie.
  let lastHover = null;
  function snapStart(x, y) {
    const w = worldNow(), rd = w.rd, half = w.half;
    const h = G.rad(startHeadingDeg);
    const ex = Math.abs(Math.cos(h)) > 0.5 ? rd.hl : rd.hw, ey = Math.abs(Math.cos(h)) > 0.5 ? rd.hw : rd.hl;
    const dl = x + half, db = y + half, dt = half - y;
    const m = Math.min(dl, db, dt);
    if (m === dl) x = -half + ex; else if (m === db) y = -half + ey; else y = half - ey;
    x = Math.max(-half + ex, Math.min(-ex, x));
    y = Math.max(-half + ey, Math.min(half - ey, y));
    const s = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, h: G.wrap(h) };
    return { pose: s, errs: BZ.checkStart(w, s) };
  }
  function previewStart(x, y) {
    lastHover = { x, y };
    const r = snapStart(x, y);
    $('constraintStatus').textContent = r.errs.length ? '✗ Départ interdit (G304) : ' + r.errs.join(' ; ') : '✓ Départ légal : cliquez pour le poser.';
    pushState({ startPreview: { pose: r.pose, ok: !r.errs.length } });
    return r;
  }
  function rotateStart(d) {
    startHeadingDeg = ((startHeadingDeg + d) % 360 + 540) % 360 - 180;
    if (view2d.mode === 'start' && lastHover) previewStart(lastHover.x, lastHover.y);
    else if (game.departImpose) {
      // départ déjà posé : on le tourne sur place (en le recollant au mur)
      const r = snapStart(game.departImpose.x, game.departImpose.y);
      if (!r.errs.length) { game.departImpose = r.pose; persist(); invalidate(); }
      else $('constraintStatus').textContent = '✗ Impossible de tourner ici (G304) : ' + r.errs.join(' ; ');
    }
  }
  $('rotLeft').addEventListener('click', () => rotateStart(90));
  $('rotRight').addEventListener('click', () => rotateStart(-90));
  document.addEventListener('keydown', (e) => {
    if (view2d.mode !== 'start' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'r' || e.key === 'R' || e.key === 'e' || e.key === 'E') { rotateStart(-90); e.preventDefault(); }
    else if (e.key === 'q' || e.key === 'Q') { rotateStart(90); e.preventDefault(); }
    else if (e.key === 'Escape') setMode(null);
  });

  view2d.onHover = (ev) => { if (view2d.mode === 'start') previewStart(ev.x, ev.y); };
  view2d.onPick = (ev) => {
    if (ev.type === 'partner') {
      game.zonePartenaire = ev.zone; persist(); setMode(null); invalidate();
      return;
    }
    const r = previewStart(ev.x, ev.y);
    if (r.errs.length) return;
    game.departImpose = r.pose; persist(); setMode(null); invalidate();
  };

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
    $('dimsHint').textContent = 'Mesurées sur le modèle 3D (tournez-le avec les boutons ↻ si besoin).';
    const ok = d.longueur <= 45.72 && d.largeur <= 45.72 && d.hauteur <= 45.72;
    $('importDims').innerHTML = `${d.longueur.toFixed(1)} × ${d.largeur.toFixed(1)} × ${d.hauteur.toFixed(1)} cm (longueur × largeur × hauteur) · ` +
      (ok ? '<span class="ok">✓ tient dans le cube de 18 in</span>' : '<b style="color:var(--red)">✗ dépasse le cube de 45,7 cm (R102) : vérifiez l\'orientation</b>');
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
    };
  }
  function refreshExport() {
    const t = exportTexts();
    if (!t) {
      $('startText').innerHTML = '<li class="hint">Entraînez d\'abord l\'IA (onglet 3).</li>';
      $('codeView').value = '';
      return;
    }
    $('startText').innerHTML = t.startText.map((s) => `<li>${s}</li>`).join('');
    $('codeView').value = codeShown === 'java' ? t.java : t.blk;
  }
  const needPlan = () => { if (!best) { modal('Pas encore de plan', '<p>Lancez l\'entraînement (onglet 3) pour que l\'IA trouve un AUTO.</p>'); return false; } return true; };
  $('dlJava').addEventListener('click', () => { if (needPlan()) download('AutoBiobuzzIA.java', exportTexts().java, 'text/x-java'); });
  $('dlBlk').addEventListener('click', () => { if (needPlan()) download('AutoBiobuzzIA.blk', exportTexts().blk, 'application/xml'); });
  $('showJava').addEventListener('click', () => { codeShown = 'java'; refreshExport(); });
  $('showBlk').addEventListener('click', () => { codeShown = 'blk'; refreshExport(); });
  $('copyCode').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('codeView').value); $('copyCode').textContent = 'Copié ✓'; }
    catch (e) { $('codeView').select(); document.execCommand('copy'); }
    setTimeout(() => { $('copyCode').textContent = 'Copier'; }, 1500);
  });

  // ---------------- Démarrage ----------------
  const ua = navigator.userAgent || '';
  if (/Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua)) $('safariNote').hidden = false;
  showRobotWarnings();
  $('constraintStatus').textContent = constraintText();
  pushState();
  setTime(0);
  BZ.loadRobotModel().then((m) => { robotModel = m; applyModel(false); });
  $('randomMatch').addEventListener('change', () => {
    randomSeed = (Date.now() & 0xffff) + 1;
    $('animNote').textContent = $('randomMatch').checked
      ? 'Animation : match tiré au hasard avec la précision du robot (décochez/recochez pour un autre tirage).'
      : 'Animation : scénario où tous les tirs possibles entrent. Le score affiché est l\'espérance.';
    pushState();
  });

  // Accès pour les tests automatisés
  window.BZApp = {
    get best() { return best; },
    get opt() { return opt; },
    train: startTraining,
    stop: stopTraining,
    setTime,
    exportTexts,
  };
})();
