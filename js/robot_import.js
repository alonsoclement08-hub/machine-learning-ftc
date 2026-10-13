// Import du robot en 3D (STEP / IGES) dans le navigateur avec occt-import-js (OpenCascade en
// WebAssembly). La lecture se fait dans un Web Worker (l'interface ne gèle pas) ; les petites pièces
// (vis, écrous…) sont supprimées et tout est fusionné par couleur pour que l'affichage reste fluide.
// Les fichiers Inventor (.ipt/.iam) ne sont pas lisibles : on explique comment les exporter en STEP.
//
// Modèle : { name, meshes: [{pos: Float32Array (cm, repère du fichier), idx: Uint32Array, color}],
//            rot: [9 nombres] } — rot = matrice (lignes : AVANT, GAUCHE, HAUT) fichier -> robot.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Impossible de charger ' + src));
      document.head.appendChild(s);
    });
  }

  async function wasmBytes() {
    if (!root.OCCT_WASM_B64) await loadScript('vendor/occt-import-js.wasm.js');
    const bin = atob(root.OCCT_WASM_B64);
    const wasm = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) wasm[i] = bin.charCodeAt(i);
    return wasm;
  }

  BZ.INVENTOR_HELP = [
    'Les fichiers Inventor (.ipt pièce, .iam assemblage) sont dans un format fermé d\'Autodesk :',
    'aucun logiciel en dehors d\'Inventor ne sait les lire. Exportez votre robot en STEP, ça prend 30 secondes :',
    '<ol><li>Ouvrez le robot dans Inventor (de préférence l\'<b>assemblage .iam</b> complet).</li>' +
    '<li>Menu <b>Fichier &gt; Exporter &gt; Format CAO</b>.</li>' +
    '<li>Type de fichier : <b>Fichiers STEP (*.stp, *.ste, *.step)</b>.</li>' +
    '<li>Enregistrez, puis importez le .stp ici.</li></ol>',
    'Astuce : avec Onshape ou Fusion 360, faites clic droit sur la pièce/l\'assemblage &gt; Exporter &gt; STEP.',
  ].join(' ');

  // Réglages de triangulation : grossiers volontairement (c'est pour l'affichage et les dimensions).
  const PARAMS = { linearUnit: 'centimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.12, angularDeflection: 0.8 };
  const MIN_PART_CM = 1.2; // pièces plus petites que ça (diagonale) : supprimées

  // Simplification + fusion par couleur. Code partagé entre le worker et la page.
  function simplifyMeshes(meshes) {
    const groups = new Map();
    let kept = 0, dropped = 0;
    for (const m of meshes) {
      const p = m.attributes.position.array, ix = m.index.array;
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { if (p[i + a] < mn[a]) mn[a] = p[i + a]; if (p[i + a] > mx[a]) mx[a] = p[i + a]; }
      const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
      if (meshes.length > 30 && diag < MIN_PART_CM) { dropped++; continue; }
      kept++;
      const col = m.color || [0.72, 0.72, 0.76];
      const key = col.map((c) => Math.round(c * 16)).join(',');
      if (!groups.has(key)) groups.set(key, { color: col, pos: [], idx: [] });
      const g = groups.get(key);
      const base = g.pos.length / 3;
      for (let i = 0; i < p.length; i++) g.pos.push(p[i]);
      for (let i = 0; i < ix.length; i++) g.idx.push(ix[i] + base);
    }
    const out = [];
    for (const g of groups.values()) out.push({ pos: new Float32Array(g.pos), idx: new Uint32Array(g.idx), color: g.color });
    return { meshes: out, kept, dropped };
  }

  const WORKER_CODE = `
    ${simplifyMeshes.toString()}
    const MIN_PART_CM = ${MIN_PART_CM};
    self.onmessage = async (e) => {
      const { wasm, bytes, ext, params } = e.data;
      try {
        self.postMessage({ type: 'progress', text: 'Démarrage du moteur 3D…' });
        const occt = await occtimportjs({ wasmBinary: wasm });
        self.postMessage({ type: 'progress', text: 'Lecture et triangulation des pièces…' });
        const res = (ext === 'iges' || ext === 'igs') ? occt.ReadIgesFile(bytes, params) : occt.ReadStepFile(bytes, params);
        if (!res || !res.success || !res.meshes.length) throw new Error('Le fichier n\\'a pas pu être lu (STEP invalide ou vide).');
        self.postMessage({ type: 'progress', text: 'Simplification (' + res.meshes.length + ' pièces)…' });
        const s = simplifyMeshes(res.meshes);
        const transfer = [];
        for (const m of s.meshes) transfer.push(m.pos.buffer, m.idx.buffer);
        self.postMessage({ type: 'done', meshes: s.meshes, kept: s.kept, dropped: s.dropped }, transfer);
      } catch (err) {
        self.postMessage({ type: 'error', message: String(err && err.message || err) });
      }
    };`;

  let currentWorker = null; // { w, reject }
  BZ.cancelRobotImport = function () {
    if (currentWorker) {
      currentWorker.w.terminate();
      const rej = currentWorker.reject;
      currentWorker = null;
      const e = new Error('Import annulé');
      e.cancelled = true;
      rej(e);
    }
  };

  // Lecture dans un worker (créé depuis un Blob : marche aussi en file://).
  async function readInWorker(bytes, ext, onProgress) {
    if (!root.OCCT_JS_SRC) await loadScript('vendor/occt-import-js.wasm.js');
    if (!root.OCCT_JS_SRC) throw new Error('worker indisponible');
    const wasm = await wasmBytes();
    const blob = new Blob([root.OCCT_JS_SRC, '\n', WORKER_CODE], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    return new Promise((resolve, reject) => {
      currentWorker = { w, reject };
      w.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'progress') onProgress && onProgress(d.text);
        else if (d.type === 'done') { w.terminate(); currentWorker = null; URL.revokeObjectURL(url); resolve(d); }
        else if (d.type === 'error') { w.terminate(); currentWorker = null; URL.revokeObjectURL(url); reject(new Error(d.message)); }
      };
      w.onerror = (e) => { w.terminate(); currentWorker = null; URL.revokeObjectURL(url); reject(new Error(e.message || 'erreur du worker')); };
      w.postMessage({ wasm, bytes, ext, params: PARAMS }, [wasm.buffer, bytes.buffer]);
    });
  }

  // Lecture dans la page (secours si le navigateur refuse le worker).
  async function readInPage(bytes, ext, onProgress) {
    if (!root.occtimportjs) await loadScript('vendor/occt-import-js.js');
    onProgress && onProgress('Lecture et triangulation des pièces (la page peut se figer)…');
    await new Promise((r) => setTimeout(r, 50));
    const occt = await root.occtimportjs({ wasmBinary: await wasmBytes() });
    const res = (ext === 'iges' || ext === 'igs') ? occt.ReadIgesFile(bytes, PARAMS) : occt.ReadStepFile(bytes, PARAMS);
    if (!res || !res.success || !res.meshes.length) throw new Error('Le fichier n\'a pas pu être lu (STEP invalide ou vide).');
    return simplifyMeshes(res.meshes);
  }

  BZ.readRobotFile = async function (file, onProgress) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'ipt' || ext === 'iam') {
      const e = new Error('inventor');
      e.inventor = true;
      throw e;
    }
    const buf = await file.arrayBuffer();
    let res;
    try {
      res = await readInWorker(new Uint8Array(buf.slice(0)), ext, onProgress);
    } catch (err) {
      if (err && err.cancelled) throw err;
      if (err && /n'a pas pu être lu/.test(err.message)) throw err;
      res = await readInPage(new Uint8Array(buf), ext, onProgress);
    }
    const model = { name: file.name, meshes: res.meshes, kept: res.kept, dropped: res.dropped };
    model.rot = BZ.guessRotation(model);
    return model;
  };

  // ---------------- Orientation ----------------
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mul3 = (A, B) => {
    const C = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
    return C.map((v) => Math.round(v));
  };
  // rotation de +90° autour d'un axe du repère robot (x = avant, y = gauche, z = haut)
  const R90 = {
    x: [1, 0, 0, 0, 0, -1, 0, 1, 0],
    y: [0, 0, 1, 0, 1, 0, -1, 0, 0],
    z: [0, -1, 0, 1, 0, 0, 0, 0, 1],
  };
  BZ.rotateModel = function (model, axis, times) {
    let r = model.rot || I3.slice();
    const n = ((times || 1) % 4 + 4) % 4;
    for (let i = 0; i < n; i++) r = mul3(R90[axis], r);
    model.rot = r;
    return model;
  };

  function applyRot(r, x, y, z) {
    return [r[0] * x + r[1] * y + r[2] * z, r[3] * x + r[4] * y + r[5] * z, r[6] * x + r[7] * y + r[8] * z];
  }

  // Compatibilité avec les anciens modèles enregistrés ({up, fwd}).
  function axisVec(a) {
    const s = a[0] === '-' ? -1 : 1;
    const k = a.replace('-', '');
    return [k === 'x' ? s : 0, k === 'y' ? s : 0, k === 'z' ? s : 0];
  }
  BZ.rotFromAxes = function (up, fwd) {
    const U = axisVec(up), F = axisVec(fwd);
    const L = [U[1] * F[2] - U[2] * F[1], U[2] * F[0] - U[0] * F[2], U[0] * F[1] - U[1] * F[0]];
    return F.concat(L, U);
  };

  function rawBox(model) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const m of model.meshes) {
      const p = m.pos;
      for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { if (p[i + a] < mn[a]) mn[a] = p[i + a]; if (p[i + a] > mx[a]) mx[a] = p[i + a]; }
    }
    return { mn, mx, size: mx.map((v, a) => v - mn[a]) };
  }

  // Devine l'axe "haut" : Z (Onshape, Fusion, SolidWorks) ou Y (Inventor) ; on prend celui des deux
  // qui donne le robot le plus "à plat" (la hauteur d'un robot FTC est rarement sa plus grande cote).
  BZ.guessRotation = function (model) {
    const b = rawBox(model);
    if (b.size[1] < b.size[2] * 0.75) return BZ.rotFromAxes('y', 'x');
    return I3.slice();
  };

  // Dimensions (cm) dans le repère robot.
  BZ.robotModelDims = function (model) {
    if (!model.rot) model.rot = model.up ? BZ.rotFromAxes(model.up, model.fwd || 'x') : I3.slice();
    const r = model.rot;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const m of model.meshes) {
      const p = m.pos;
      for (let i = 0; i < p.length; i += 3) {
        const c = applyRot(r, p[i], p[i + 1], p[i + 2]);
        for (let a = 0; a < 3; a++) { if (c[a] < mn[a]) mn[a] = c[a]; if (c[a] > mx[a]) mx[a] = c[a]; }
      }
    }
    return { longueur: mx[0] - mn[0], largeur: mx[1] - mn[1], hauteur: mx[2] - mn[2], mn, mx };
  };

  // Positions transformées : repère robot, centré en X/Y, posé au sol, en POUCES.
  function robotPositions(model, d) {
    const r = model.rot;
    const cx = (d.mn[0] + d.mx[0]) / 2, cy = (d.mn[1] + d.mx[1]) / 2, cz = d.mn[2];
    return model.meshes.map((m) => {
      const p = m.pos, out = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) {
        const c = applyRot(r, p[i], p[i + 1], p[i + 2]);
        out[i] = (c[0] - cx) / 2.54;
        out[i + 1] = (c[1] - cy) / 2.54;
        out[i + 2] = (c[2] - cz) / 2.54;
      }
      return out;
    });
  }

  // Groupe three.js du robot (avant = +X, haut = +Z, pouces, centré).
  BZ.buildRobotGroup = function (model) {
    const THREE = root.THREE;
    if (!THREE || !model) return null;
    const d = BZ.robotModelDims(model);
    const P = robotPositions(model, d);
    const group = new THREE.Group();
    model.meshes.forEach((m, k) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P[k], 3));
      geo.setIndex(new THREE.BufferAttribute(m.idx, 1));
      geo.computeVertexNormals();
      group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: new THREE.Color(m.color[0], m.color[1], m.color[2]), side: THREE.DoubleSide })));
    });
    return group;
  };

  // Silhouette vue de dessus pour la vue 2D : image + taille en pouces (largeur = longueur robot).
  BZ.robotTopImage = function (model) {
    if (!model || typeof document === 'undefined') return null;
    const d = BZ.robotModelDims(model);
    const P = robotPositions(model, d);
    const Lin = d.longueur / 2.54, Win = d.largeur / 2.54, Hin = Math.max(1, d.hauteur / 2.54);
    const ppi = 12; // pixels par pouce
    const cw = Math.max(8, Math.ceil(Lin * ppi)), ch = Math.max(8, Math.ceil(Win * ppi));
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d');
    // triangles triés du bas vers le haut (le dessus est dessiné en dernier)
    const tris = [];
    model.meshes.forEach((m, k) => {
      const p = P[k], ix = m.idx;
      for (let i = 0; i < ix.length; i += 3) {
        const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
        const z = Math.max(p[a + 2], p[b + 2], p[c + 2]);
        // normale (pour l'ombrage)
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        tris.push([z, k, a, b, c, Math.abs(nz / nl)]);
      }
    });
    tris.sort((u, v) => u[0] - v[0]);
    const X = (x) => (x + Lin / 2) * ppi, Y = (y) => (Win / 2 - y) * ppi;
    for (const [z, k, a, b, c, nz] of tris) {
      const col = model.meshes[k].color;
      const light = 0.45 + 0.35 * (z / Hin) + 0.2 * nz;
      ctx.fillStyle = `rgb(${Math.round(col[0] * 255 * light)},${Math.round(col[1] * 255 * light)},${Math.round(col[2] * 255 * light)})`;
      const p = P[k];
      ctx.beginPath();
      ctx.moveTo(X(p[a]), Y(p[a + 1])); ctx.lineTo(X(p[b]), Y(p[b + 1])); ctx.lineTo(X(p[c]), Y(p[c + 1]));
      ctx.closePath(); ctx.fill();
    }
    return { canvas: cv, lengthIn: Lin, widthIn: Win };
  };

  // --- Mémorisation locale (IndexedDB) du dernier robot importé ---
  const DB = 'biobuzz-auto-ia', STORE = 'robot3d';
  function openDb() {
    return new Promise((resolve, reject) => {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  BZ.saveRobotModel = async function (model) {
    try {
      const db = await openDb();
      const data = model ? { name: model.name, meshes: model.meshes, rot: model.rot } : null;
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        if (data) tx.objectStore(STORE).put(data, 'last'); else tx.objectStore(STORE).delete('last');
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } catch (e) { /* stockage indisponible : le modèle reste en mémoire */ }
  };
  BZ.loadRobotModel = async function () {
    try {
      const db = await openDb();
      const m = await new Promise((res) => {
        const rq = db.transaction(STORE).objectStore(STORE).get('last');
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => res(null);
      });
      if (m && !m.rot) m.rot = m.up ? BZ.rotFromAxes(m.up, m.fwd || 'x') : I3.slice();
      return m;
    } catch (e) { return null; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BZ;
})(typeof window !== 'undefined' ? window : globalThis);
