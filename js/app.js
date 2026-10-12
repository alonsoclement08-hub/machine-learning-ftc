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
  let robotModel = null; // modèle 3D importé {name, meshes, up, fwd}
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

  function pushState(extra) {
    const st = Object.assign({
      alliance: game.alliance, robot, game, rd: BZ.robotDerived(robot), world: worldNow(), result: best,
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
    $('constraintStatus').textContent = mode === 'start' ? 'Cliquez près d\'un mur de votre côté du terrain (vue 2D).'
      : mode === 'partner' ? 'Glissez sur le terrain pour dessiner la zone du partenaire.' : constraintText();
    if (mode) document.querySelector('.segbtn[data-view="2d"]').click();
  }
  function constraintText() {
    const a = [];
    a.push(game.departImpose ? 'Départ imposé.' : 'Départ choisi par l\'IA.');
    if (game.zonePartenaire) a.push('Zone partenaire définie.');
    return a.join(' ');
  }
  $('placeStart').addEventListener('click', () => setMode(view2d.mode === 'start' ? null : 'start'));
  $('drawPartner').addEventListener('click', () => setMode(view2d.mode === 'partner' ? null : 'partner'));
  $('clearStart').addEventListener('click', () => { game.departImpose = null; persist(); setMode(null); invalidate(); });
  $('clearPartner').addEventListener('click', () => { game.zonePartenaire = null; persist(); setMode(null); invalidate(); });

  view2d.onPick = (ev) => {
    if (ev.type === 'partner') {
      game.zonePartenaire = ev.zone; persist(); setMode(null); invalidate();
      return;
    }
    // départ : on colle le robot au mur le plus proche avec l'orientation choisie
    const w = worldNow(), rd = w.rd, half = w.half;
    const h = G.rad(parseFloat($('startHeading').value));
    const ex = Math.abs(Math.cos(h)) > 0.5 ? rd.hl : rd.hw, ey = Math.abs(Math.cos(h)) > 0.5 ? rd.hw : rd.hl;
    let { x, y } = ev;
    const dl = x + half, db = y + half, dt = half - y;
    const m = Math.min(dl, db, dt);
    if (m === dl) x = -half + ex; else if (m === db) y = -half + ey; else y = half - ey;
    x = Math.max(-half + ex, Math.min(-ex, x));
    y = Math.max(-half + ey, Math.min(half - ey, y));
    const s = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, h };
    const errs = BZ.checkStart(w, s);
    if (errs.length) {
      $('constraintStatus').textContent = 'Départ refusé (G304) : ' + errs.join(' ; ');
      pushState({ startPreview: { pose: s, ok: false } });
      return;
    }
    game.departImpose = s; persist(); setMode(null); invalidate();
  };

  // ---------------- Import 3D ----------------
  function busy(on, text) { $('busy').hidden = !on; if (text) $('busyText').textContent = text; }
  function modal(title, html) { $('modalTitle').textContent = title; $('modalBody').innerHTML = html; $('modal').hidden = false; }
  $('modalClose').addEventListener('click', () => { $('modal').hidden = true; });

  function showImported() {
    if (!robotModel) {
      $('importAxes').hidden = true;
      $('importStatus').textContent = 'Aucun modèle : le robot est affiché comme une boîte.';
      view3d.setRobotModel(null);
      return;
    }
    $('importAxes').hidden = false;
    $('axisUp').value = robotModel.up; $('axisFwd').value = robotModel.fwd;
    const d = BZ.robotModelDims(robotModel, robotModel.up, robotModel.fwd);
    if (!d) { $('importDims').textContent = 'Axes « haut » et « avant » incompatibles.'; return; }
    const ok = d.longueur <= 45.72 && d.largeur <= 45.72 && d.hauteur <= 45.72;
    $('importDims').innerHTML = `Mesuré : ${d.longueur.toFixed(1)} × ${d.largeur.toFixed(1)} × ${d.hauteur.toFixed(1)} cm (L × l × h) ` +
      (ok ? '<span class="ok">✓ tient dans le cube de 18 in</span>' : '<b style="color:var(--red)">✗ dépasse le cube de 45,7 cm (R102)</b>');
    $('importStatus').textContent = `Modèle : ${robotModel.name} (${robotModel.meshes.length} pièces)`;
    view3d.init();
    view3d.setRobotModel(BZ.buildRobotGroup(robotModel, robotModel.up, robotModel.fwd));
  }

  $('robotFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    busy(true, `Lecture de ${file.name}… (jusqu'à 1-2 min pour un gros robot)`);
    await new Promise((r) => setTimeout(r, 50));
    try {
      const m = await BZ.readRobotFile(file);
      // proposition d'axes : Z en haut sauf si le modèle est plus haut en Y (export Inventor)
      m.up = 'z'; m.fwd = 'x';
      const dz = BZ.robotModelDims(m, 'z', 'x'), dy = BZ.robotModelDims(m, 'y', 'x');
      if (dy && dz && dz.hauteur > 1.3 * dy.hauteur && dy.hauteur > 0) { m.up = 'y'; m.fwd = 'x'; }
      robotModel = m;
      BZ.saveRobotModel(m);
      showImported();
      document.querySelector('.segbtn[data-view="3d"]').click();
    } catch (err) {
      if (err.inventor) modal('Fichier Inventor : exportez-le en STEP', BZ.INVENTOR_HELP);
      else modal('Import impossible', `<p>${err.message || err}</p>`);
    } finally {
      busy(false);
    }
  });
  for (const id of ['axisUp', 'axisFwd']) {
    $(id).addEventListener('change', () => {
      if (!robotModel) return;
      robotModel.up = $('axisUp').value; robotModel.fwd = $('axisFwd').value;
      BZ.saveRobotModel(robotModel);
      showImported();
    });
  }
  $('useDims').addEventListener('click', () => {
    if (!robotModel) return;
    const d = BZ.robotModelDims(robotModel, robotModel.up, robotModel.fwd);
    if (!d) return;
    robot.longueur_cm = Math.round(d.longueur * 10) / 10;
    robot.largeur_cm = Math.round(d.largeur * 10) / 10;
    robot.hauteur_cm = Math.round(d.hauteur * 10) / 10;
    fillForm($('robotForm'), robot);
    persist(); showRobotWarnings(); invalidate();
  });
  $('robotClear').addEventListener('click', () => { robotModel = null; BZ.saveRobotModel(null); showImported(); });

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
  showRobotWarnings();
  $('constraintStatus').textContent = constraintText();
  pushState();
  setTime(0);
  BZ.loadRobotModel().then((m) => { if (m) { robotModel = m; showImported(); } else showImported(); });

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
