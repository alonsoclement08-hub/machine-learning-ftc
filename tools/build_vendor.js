// Outil de développement : copie les bibliothèques dans vendor/ pour que l'appli marche
// hors ligne en ouvrant simplement index.html (file://, sans serveur).
//   npm install && node tools/build_vendor.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const V = path.join(ROOT, 'vendor');
fs.mkdirSync(V, { recursive: true });

fs.copyFileSync(path.join(NM, 'three/build/three.min.js'), path.join(V, 'three.min.js'));
fs.copyFileSync(path.join(NM, 'three/examples/js/controls/OrbitControls.js'), path.join(V, 'OrbitControls.js'));
fs.copyFileSync(path.join(NM, 'three/LICENSE'), path.join(V, 'LICENSE.three.txt'));

// occt-import-js : lecteur STEP (OpenCascade en WebAssembly). Le .wasm est embarqué en base64
// car un navigateur refuse de le télécharger depuis file://.
const occtDir = path.join(NM, 'occt-import-js/dist');
fs.copyFileSync(path.join(occtDir, 'occt-import-js.js'), path.join(V, 'occt-import-js.js'));
const wasm = fs.readFileSync(path.join(occtDir, 'occt-import-js.wasm'));
// On y joint aussi le source JS sous forme de texte, pour lancer la lecture dans un Web Worker
// créé depuis un Blob (seule façon d'avoir un worker en file://).
const occtSrc = fs.readFileSync(path.join(occtDir, 'occt-import-js.js'), 'utf8');
fs.writeFileSync(path.join(V, 'occt-import-js.wasm.js'),
  '// occt-import-js : wasm en base64 + source JS (chargés seulement quand on importe un robot).\n' +
  'window.OCCT_WASM_B64 = "' + wasm.toString('base64') + '";\n' +
  'window.OCCT_JS_SRC = ' + JSON.stringify(occtSrc) + ';\n');
fs.copyFileSync(path.join(occtDir, 'license.occt-import-js.txt'), path.join(V, 'LICENSE.occt-import-js.txt'));
fs.copyFileSync(path.join(occtDir, 'license.occt.txt'), path.join(V, 'LICENSE.occt.txt'));
for (const f of fs.readdirSync(V)) console.log(f, (fs.statSync(path.join(V, f)).size / 1e6).toFixed(2) + ' Mo');
