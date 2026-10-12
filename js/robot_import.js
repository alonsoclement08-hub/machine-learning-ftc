// Import du robot en 3D (STEP / IGES) directement dans le navigateur avec occt-import-js
// (OpenCascade compilé en WebAssembly). Les fichiers Inventor (.ipt/.iam) ne sont pas lisibles :
// on explique comment les exporter en STEP.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};

  let occtPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Impossible de charger ' + src));
      document.head.appendChild(s);
    });
  }

  BZ.loadOcct = function () {
    if (!occtPromise) {
      occtPromise = (async () => {
        if (!root.occtimportjs) await loadScript('vendor/occt-import-js.js');
        if (!root.OCCT_WASM_B64) await loadScript('vendor/occt-import-js.wasm.js');
        const bin = atob(root.OCCT_WASM_B64);
        const wasm = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) wasm[i] = bin.charCodeAt(i);
        return root.occtimportjs({ wasmBinary: wasm });
      })();
      occtPromise.catch(() => { occtPromise = null; });
    }
    return occtPromise;
  };

  BZ.INVENTOR_HELP = [
    'Les fichiers Inventor (.ipt pièce, .iam assemblage) sont dans un format fermé d\'Autodesk :',
    'aucun logiciel en dehors d\'Inventor ne sait les lire. Exportez votre robot en STEP, ça prend 30 secondes :',
    '<ol><li>Ouvrez le robot dans Inventor (de préférence l\'<b>assemblage .iam</b> complet).</li>' +
    '<li>Menu <b>Fichier &gt; Exporter &gt; Format CAO</b>.</li>' +
    '<li>Type de fichier : <b>Fichiers STEP (*.stp, *.ste, *.step)</b>.</li>' +
    '<li>Enregistrez, puis importez le .stp ici.</li></ol>',
    'Astuce : avec Onshape ou Fusion 360, faites clic droit sur la pièce/l\'assemblage &gt; Exporter &gt; STEP.',
  ].join(' ');

  // Lit le fichier et renvoie { meshes: [{pos: Float32Array (cm), idx: Uint32Array, color}], bbox }
  BZ.readRobotFile = async function (file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'ipt' || ext === 'iam') {
      const e = new Error('inventor');
      e.inventor = true;
      throw e;
    }
    const occt = await BZ.loadOcct();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const params = { linearUnit: 'centimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.004, angularDeflection: 0.6 };
    const res = (ext === 'iges' || ext === 'igs') ? occt.ReadIgesFile(bytes, params) : occt.ReadStepFile(bytes, params);
    if (!res || !res.success || !res.meshes.length) throw new Error('Le fichier n\'a pas pu être lu (STEP invalide ou vide).');
    const meshes = res.meshes.map((m) => ({
      pos: new Float32Array(m.attributes.position.array),
      idx: new Uint32Array(m.index.array),
      color: m.color || [0.75, 0.75, 0.78],
    }));
    return { name: file.name, meshes };
  };

  // Matrice de passage : axes du fichier -> repère robot (avant = +X, gauche = +Y, haut = +Z).
  function axisVec(a) {
    const s = a[0] === '-' ? -1 : 1;
    const k = a.replace('-', '');
    return [k === 'x' ? s : 0, k === 'y' ? s : 0, k === 'z' ? s : 0];
  }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  BZ.robotFrame = function (up, fwd) {
    const U = axisVec(up), Fw = axisVec(fwd);
    if (Math.abs(dot(U, Fw)) > 0.5) return null;
    const L = cross(U, Fw); // gauche = haut x avant
    return { F: Fw, L, U };
  };

  // Dimensions (cm) du modèle dans le repère robot.
  BZ.robotModelDims = function (model, up, fwd) {
    const fr = BZ.robotFrame(up, fwd);
    if (!fr) return null;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const m of model.meshes) {
      const p = m.pos;
      for (let i = 0; i < p.length; i += 3) {
        const v = [p[i], p[i + 1], p[i + 2]];
        const c = [dot(v, fr.F), dot(v, fr.L), dot(v, fr.U)];
        for (let a = 0; a < 3; a++) { if (c[a] < mn[a]) mn[a] = c[a]; if (c[a] > mx[a]) mx[a] = c[a]; }
      }
    }
    return { longueur: mx[0] - mn[0], largeur: mx[1] - mn[1], hauteur: mx[2] - mn[2], mn, mx, fr };
  };

  // Construit le groupe three.js : centré en X/Y, posé au sol, en pouces, avant = +X.
  BZ.buildRobotGroup = function (model, up, fwd) {
    const THREE = root.THREE;
    const d = BZ.robotModelDims(model, up, fwd);
    if (!d || !THREE) return null;
    const { fr, mn, mx } = d;
    const cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2, cz = mn[2];
    const group = new THREE.Group();
    for (const m of model.meshes) {
      const p = m.pos, out = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) {
        const v = [p[i], p[i + 1], p[i + 2]];
        out[i] = (dot(v, fr.F) - cx) / 2.54;
        out[i + 1] = (dot(v, fr.L) - cy) / 2.54;
        out[i + 2] = (dot(v, fr.U) - cz) / 2.54;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
      geo.setIndex(new THREE.BufferAttribute(m.idx, 1));
      geo.computeVertexNormals();
      group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: new THREE.Color(...m.color), side: THREE.DoubleSide })));
    }
    return group;
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
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        if (model) tx.objectStore(STORE).put(model, 'last'); else tx.objectStore(STORE).delete('last');
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } catch (e) { /* stockage indisponible : tant pis, le modèle reste en mémoire */ }
  };
  BZ.loadRobotModel = async function () {
    try {
      const db = await openDb();
      return await new Promise((res) => {
        const rq = db.transaction(STORE).objectStore(STORE).get('last');
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => res(null);
      });
    } catch (e) { return null; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
