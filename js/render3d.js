// Vue 3D : terrain officiel (maillage issu du STEP) + robot (boîte ou modèle 3D importé).
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};

  function b64ToBuf(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  function Field3D(container) {
    this.el = container;
    this.ready = false;
    this.state = null;
    this.t = 0;
    this.robotModel = null; // {group, dims}
  }

  Field3D.prototype.init = function () {
    if (this.ready || !root.THREE) return;
    const THREE = root.THREE;
    this.ready = true;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(window.matchMedia('(prefers-color-scheme: dark)').matches ? 0x1b1e23 : 0xe9e6de);
    const cam = this.camera = new THREE.PerspectiveCamera(45, 1, 1, 2000);
    cam.up.set(0, 0, 1);
    cam.position.set(-150, -170, 150);
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(window.devicePixelRatio || 1);
    this.el.appendChild(r.domElement);
    // Outils de dessin : nos écouteurs passent AVANT ceux de l'orbite (enregistrés plus tôt).
    const dom = r.domElement;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => this.pointer('down', e));
    dom.addEventListener('pointermove', (e) => this.pointer('move', e));
    dom.addEventListener('pointerup', (e) => this.pointer('up', e));
    dom.addEventListener('pointercancel', (e) => this.pointer('up', e));
    // Orbite « comme en CAO » : clic gauche = tourner, clic droit / molette appuyée / Maj = déplacer, molette = zoom
    this.controls = new THREE.OrbitControls(cam, dom);
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.target.set(0, 0, 10);
    this.controls.update();
    this.overlayGroup = new THREE.Group();
    scene.add(this.overlayGroup);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666655, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.65);
    sun.position.set(-80, -120, 200);
    scene.add(sun);

    // Terrain
    this.hiveGroups = {};
    if (root.FIELD_MESH) {
      const M = root.FIELD_MESH;
      const meshOf = (g, dz) => {
        const q = new Int16Array(b64ToBuf(g.pos));
        const pos = new Float32Array(q.length);
        for (let i = 0; i < q.length; i++) pos[i] = q[i] * M.scale - (i % 3 === 2 ? dz : 0);
        const idx = g.idx32 ? new Uint32Array(b64ToBuf(g.idx)) : new Uint16Array(b64ToBuf(g.idx));
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeVertexNormals();
        const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(g.color[0], g.color[1], g.color[2]), side: THREE.DoubleSide });
        return new THREE.Mesh(geo, mat);
      };
      for (const g of M.groups) scene.add(meshOf(g, 0));
      // HIVES articulées : un groupe par alliance, centré sur l'axe de pivot (parallèle à X)
      if (M.hives) {
        const piv = M.pivot || { y: 0, z: 43.95 };
        for (const col of ['red', 'blue']) {
          const pivot = new THREE.Group();
          pivot.position.set(0, piv.y, piv.z);
          const inner = new THREE.Group();
          inner.position.set(0, -piv.y, 0);
          for (const g of M.hives[col]) inner.add(meshOf(g, piv.z));
          pivot.add(inner);
          scene.add(pivot);
          this.hiveGroups[col] = pivot;
        }
      }
    }

    // Balles (dynamiques)
    const sphere = new THREE.SphereGeometry(1.4, 16, 12);
    const sphereN = new THREE.SphereGeometry(1.8, 16, 12);
    this.matPollen = new THREE.MeshLambertMaterial({ color: 0xf5d300 });
    this.matRed = new THREE.MeshLambertMaterial({ color: 0xd7263d });
    this.matBlue = new THREE.MeshLambertMaterial({ color: 0x1b6fd1 });
    this.ballPool = [];
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(sphere, this.matPollen);
      m.visible = false; scene.add(m); this.ballPool.push(m);
    }
    // NECTAR : ceux des ALLIANCE AREAS (décor) + un lot pour les CELLS (positionnés à chaque image)
    for (const col of ['red', 'blue']) {
      for (const b of FIELD.nectar[col]) {
        if (Math.abs(b.x) <= FIELD.half) continue;
        const m = new THREE.Mesh(sphereN, col === 'red' ? this.matRed : this.matBlue);
        m.position.set(b.x, b.y, b.z); scene.add(m);
      }
    }
    this.nectarPool = { red: [], blue: [] };
    for (const col of ['red', 'blue']) {
      for (let i = 0; i < 12; i++) {
        const m = new THREE.Mesh(sphereN, col === 'red' ? this.matRed : this.matBlue);
        m.visible = false; scene.add(m); this.nectarPool[col].push(m);
      }
    }

    // Robot par défaut : boîte
    this.robotGroup = new THREE.Group();
    scene.add(this.robotGroup);
    this.boxMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xd7263d }));
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(2, 5, 12), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    this.arrow.rotation.z = -Math.PI / 2;
    this.robotGroup.add(this.boxMesh, this.arrow);

    // Trajet
    this.pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x111111, dashSize: 4, gapSize: 3 }));
    scene.add(this.pathLine);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.el);
    this.resize();
    const loop = (ts) => {
      requestAnimationFrame(loop);
      if (!this.el.classList.contains('active')) return;
      if (this.anim) {
        const a = this.anim, u = Math.min(1, (ts - a.t0) / 450), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        cam.position.lerpVectors(a.p0, a.p1, e);
        this.controls.target.lerpVectors(a.q0, a.q1, e);
        if (u >= 1) this.anim = null;
      }
      this.controls.update();
      r.render(scene, cam);
    };
    loop();
  };

  // Vues rapides (dessus, face = côté public, côté rouge, iso) et recentrage.
  Field3D.prototype.setView = function (v) {
    if (!this.ready) this.init();
    const THREE = root.THREE;
    const P = { top: [0, -1, 300], front: [0, -235, 70], side: [-235, 0, 70], iso: [-150, -170, 150] }[v] || [-150, -170, 150];
    this.anim = { t0: performance.now(), p0: this.camera.position.clone(), p1: new THREE.Vector3(...P), q0: this.controls.target.clone(), q1: new THREE.Vector3(0, 0, v === 'top' ? 0 : 10) };
  };

  // Clic -> point du sol (z = 0), en coordonnées terrain du simulateur (repère rouge).
  Field3D.prototype.groundAt = function (e) {
    const THREE = root.THREE;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    if (Math.abs(d.z) < 1e-6) return null;
    const t = -o.z / d.z;
    if (t <= 0) return null;
    let x = o.x + d.x * t, y = o.y + d.y * t;
    if (this.state && this.state.alliance === 'blue') { x = -x; y = -y; }
    // taille d'un pixel à cette distance (pour le rayon de prise)
    const dist = t;
    const px = (2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, rect.height);
    return { x, y, r: 14 * px };
  };

  Field3D.prototype.pointer = function (kind, e) {
    if (!this.onPointer || !this.controls) return;
    if (kind === 'down' && e.button !== 0) return; // clic droit / molette : orbite
    if (kind === 'move' && this.controlsBusy) return;
    const g = this.groundAt(e);
    if (!g) return;
    if (kind === 'down') {
      if (e.shiftKey) return; // Maj + glisser = déplacer la vue
      const used = this.onPointer('down', g.x, g.y, g.r, e);
      if (used) { this.controls.enabled = false; this.editing = true; try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* rien */ } }
      else this.controlsBusy = true;
      return;
    }
    if (kind === 'up') {
      if (this.editing) this.onPointer('up', g.x, g.y, g.r, e);
      this.editing = false; this.controlsBusy = false; this.controls.enabled = true;
      return;
    }
    const used = this.onPointer('move', g.x, g.y, g.r, e);
    this.renderer.domElement.style.cursor = used ? 'pointer' : (this.onPointerCursor && this.onPointerCursor() === 'crosshair' ? 'crosshair' : 'grab');
  };

  Field3D.prototype.resize = function () {
    if (!this.ready) return;
    const w = this.el.clientWidth || 10, h = this.el.clientHeight || 10;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  // Remplace la boîte par le modèle importé (THREE.Group centré, avant = +X, haut = +Z, en pouces).
  Field3D.prototype.setRobotModel = function (group) {
    if (!this.ready) this.init();
    if (this.robotModel) this.robotGroup.remove(this.robotModel);
    this.robotModel = group;
    if (group) this.robotGroup.add(group);
    this.update();
  };

  Field3D.prototype.setState = function (s) { this.state = s; this.update(); };
  Field3D.prototype.setTime = function (t) { this.t = t; this.update(); };

  Field3D.prototype.update = function () {
    if (!this.ready || !this.state) return;
    const THREE = root.THREE;
    const st = this.state;
    const blue = st.alliance === 'blue';
    const abs = (x, y) => (blue ? [-x, -y] : [x, y]);
    const rd = st.rd;
    // Robot
    this.boxMesh.visible = !this.robotModel;
    this.boxMesh.scale.set(rd.hl * 2, rd.hw * 2, st.robot.hauteur_cm / 2.54);
    this.boxMesh.position.set(0, 0, st.robot.hauteur_cm / 2.54 / 2);
    this.boxMesh.material.color.set(blue ? 0x1b6fd1 : 0xd7263d);
    this.arrow.position.set(rd.hl + 2, 0, st.robot.hauteur_cm / 2.54 + 1);
    const rs = st.world ? BZ.replayState(st.result, st.world, st.game, this.t) : null;
    const pose = (rs && rs.pose) || (st.result ? st.result.plan.start : st.idlePose);
    this.robotGroup.visible = !!pose;
    if (pose) {
      const [x, y] = abs(pose.x, pose.y);
      this.robotGroup.position.set(x, y, 0);
      this.robotGroup.rotation.set(0, 0, pose.h + (blue ? Math.PI : 0));
    }
    // Balles : FLOWERS, GARDENS, balles en vol
    let k = 0;
    const put = (x, y, z) => { if (k < this.ballPool.length) { const m = this.ballPool[k++]; m.visible = true; m.position.set(x, y, z); } };
    for (const f of FIELD.flowers) {
      let n = f.pollen;
      if (rs && f.alliance === st.alliance) {
        const [rx, ry] = abs(f.x, f.y);
        const wf = st.world.flowers.find((w) => Math.abs(w.x - rx) < 1 && Math.abs(w.y - ry) < 1);
        if (wf) n = rs.avail[wf.id];
      }
      for (let i = 0; i < n; i++) put(f.x, f.y, 1.4 + i * 2.9);
    }
    for (const col of ['red', 'blue']) {
      let balls = FIELD.gardenBalls[col];
      if (rs && col === st.alliance) {
        const taken = st.world.garden.balls.length - rs.avail.jardin;
        balls = balls.slice().sort((a, b) => Math.abs(b.x) - Math.abs(a.x)).slice(taken);
      }
      for (const b of balls) put(b.x, b.y, 1.4);
    }
    if (rs && pose) {
      const [x, y] = abs(pose.x, pose.y);
      for (let i = 0; i < Math.max(0, rs.held); i++) put(x, y, st.robot.hauteur_cm / 2.54 + 1.6 + i * 2.9);
    }
    // HIVE : bascule + balles dans les CELLS / en vol / au sol
    const hs = BZ.hiveScene(FIELD, st, this.t);
    for (const col of ['red', 'blue']) if (this.hiveGroups[col]) this.hiveGroups[col].rotation.x = hs.angle[col];
    const nk = { red: 0, blue: 0 };
    for (const b of hs.balls) {
      if (b.kind === 'pollen') put(b.x, b.y, b.z);
      else {
        const col = b.kind === 'nectar-red' ? 'red' : 'blue';
        const m = this.nectarPool[col][nk[col]++];
        if (m) { m.visible = true; m.position.set(b.x, b.y, b.z); }
      }
    }
    if (rs && rs.nectarZone > 0) {
      const z = st.world.loading, col = st.alliance === 'blue' ? 'blue' : 'red';
      for (let i = 0; i < rs.nectarZone; i++) {
        const m = this.nectarPool[col][nk[col]++];
        if (!m) break;
        const [x, y] = abs((z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2 + (i - (rs.nectarZone - 1) / 2) * 4);
        m.visible = true; m.position.set(x, y, 1.8);
      }
    }
    for (const col of ['red', 'blue']) for (let i = nk[col]; i < this.nectarPool[col].length; i++) this.nectarPool[col][i].visible = false;
    for (; k < this.ballPool.length; k++) this.ballPool[k].visible = false;
    this.drawOverlay(st.overlay);
    // Trajet
    if (st.result) {
      const pts = [];
      const p0 = abs(st.result.plan.start.x, st.result.plan.start.y);
      pts.push(new THREE.Vector3(p0[0], p0[1], 0.6));
      for (const p of st.result.prims) if (p.k === 'move') { const q = abs(p.to.x, p.to.y); pts.push(new THREE.Vector3(q[0], q[1], 0.6)); }
      this.pathLine.geometry.dispose();
      this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      this.pathLine.computeLineDistances();
    }
  };

  function label(THREE, text, bg, scale) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = '700 40px system-ui';
    const w = Math.ceil(ctx.measureText(text).width) + 28;
    c.width = w; c.height = 56;
    ctx.font = '700 40px system-ui';
    ctx.fillStyle = bg; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, w, 56, 28); else ctx.rect(0, 0, w, 56);
    ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, 30);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    const k = scale || 0.075;
    sp.scale.set(w * k, 56 * k, 1);
    sp.renderOrder = 10;
    return sp;
  }

  // Plan dessiné en 3D : zones au sol, flèches, tirs (ligne jusqu'à la CELL + pastille), ramassages, PARK.
  Field3D.prototype.drawOverlay = function (ov) {
    const THREE = root.THREE;
    const g = this.overlayGroup;
    while (g.children.length) {
      const c = g.children.pop();
      c.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    }
    if (!ov) return;
    const blue = this.state && this.state.alliance === 'blue';
    const A = (x, y, z) => new THREE.Vector3(blue ? -x : x, blue ? -y : y, z || 0);
    const sel = ov.sel || {};
    for (const z of ov.zones.concat(ov.draftZone ? [Object.assign({ color: ov.draftColor || '#7a3cff', kind: ov.draftKind }, ov.draftZone)] : [])) {
      const q = BZ.zoneRect(z);
      const geo = new THREE.PlaneGeometry(q.x1 - q.x0, q.y1 - q.y0);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: z.kind === 'interdite' ? 0.32 : 0.22, depthWrite: false, side: THREE.DoubleSide }));
      m.position.copy(A((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2, 0.35));
      g.add(m);
      const pts = [A(q.x0, q.y0, 0.4), A(q.x1, q.y0, 0.4), A(q.x1, q.y1, 0.4), A(q.x0, q.y1, 0.4), A(q.x0, q.y0, 0.4)];
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: sel.type === 'zone' && sel.id === z.id ? 0xe0a100 : z.color })));
      if (z.kind === 'interdite') {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(q.x1 - q.x0, q.y1 - q.y0, 6), new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.12, depthWrite: false }));
        wall.position.copy(A((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2, 3));
        g.add(wall);
      }
    }
    const main = blue ? 0x0d3f7a : 0x7a1020;
    let num = 0;
    for (const n of ov.nodes) {
      if (n.from) {
        const pts = [];
        for (let k = 0; k <= 24; k++) { const p = BZ.bezier(n.from, n.ctrl, [n.x, n.y], k / 24); pts.push(A(p[0], p[1], 1.2)); }
        const on = (sel.type === 'node' || sel.type === 'ctrl') && sel.i === n.i;
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: on ? 0xe0a100 : main })));
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4.5, 12), new THREE.MeshLambertMaterial({ color: on ? 0xe0a100 : main }));
        const e1 = pts[21], e0 = pts[19];
        cone.position.copy(e1);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), e1.clone().sub(e0).normalize());
        g.add(cone);
        const mid = BZ.bezier(n.from, n.ctrl, [n.x, n.y], 0.5);
        const hdl = new THREE.Mesh(new THREE.OctahedronGeometry(1.4), new THREE.MeshLambertMaterial({ color: n.ctrl ? 0xe0a100 : 0xffffff }));
        hdl.position.copy(A(mid[0], mid[1], 1.6));
        g.add(hdl);
      }
      if (n.kind === 'start') continue;
      num++;
      const on = sel.type === 'node' && sel.i === n.i;
      const at = A(n.x, n.y, 0);
      if (n.kind === 'tir') {
        const sh = n.shot;
        const pc = !sh || sh.p <= 0 ? '#d7263d' : sh.p >= 0.9 * 0.999 ? '#1f8a4c' : sh.p >= 0.7 ? '#e08a00' : '#d7263d';
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.8, 24), new THREE.MeshLambertMaterial({ color: on ? 0xe0a100 : 0xffffff }));
        disc.rotation.x = Math.PI / 2; disc.position.copy(at).setZ(0.6); g.add(disc);
        const dot = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1, 20), new THREE.MeshLambertMaterial({ color: new THREE.Color(pc) }));
        dot.rotation.x = Math.PI / 2; dot.position.copy(at).setZ(0.9); g.add(dot);
        if (sh && sh.cell) {
          const top = A(sh.cell.x, sh.cell.y, sh.cell.z || 59);
          const mid = A((n.x + sh.cell.x) / 2, (n.y + sh.cell.y) / 2, (sh.cell.z || 59) + 14);
          const curve = new THREE.QuadraticBezierCurve3(A(n.x, n.y, 14), mid, top);
          const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)), new THREE.LineDashedMaterial({ color: new THREE.Color(pc), dashSize: 2, gapSize: 2 }));
          l.computeLineDistances(); g.add(l);
        }
        const sp = label(THREE, (n.n ? '×' + n.n : '×tout') + (sh && sh.p > 0 ? ' · ' + Math.round(sh.p * 100) + '%' : ' · 0%'), pc);
        sp.position.copy(at).setZ(24); g.add(sp);
      } else if (n.kind === 'ramasse') {
        const b = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 1.2), new THREE.MeshLambertMaterial({ color: on ? 0xe0a100 : 0xf5d300 }));
        b.position.copy(at).setZ(0.8); g.add(b);
      } else if (n.kind === 'park') {
        const sp = label(THREE, 'P', '#1b6fd1', 0.08); sp.position.copy(at).setZ(10); g.add(sp);
      } else {
        const b = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12), new THREE.MeshLambertMaterial({ color: on ? 0xe0a100 : 0xffffff }));
        b.position.copy(at).setZ(1.8); g.add(b);
      }
      if (n.kind !== 'park') { const sp = label(THREE, String(num), '#111', 0.06); sp.position.copy(at).setZ(n.kind === 'tir' ? 31 : 9); g.add(sp); }
    }
    const sp = ov.startPreview;
    if (sp && this.state) {
      const rd = this.state.rd;
      const box = new THREE.Mesh(new THREE.BoxGeometry(rd.hl * 2, rd.hw * 2, 2), new THREE.MeshBasicMaterial({ color: sp.errs.length ? 0xff6a00 : 0xe0a100, transparent: true, opacity: 0.5 }));
      box.position.copy(A(sp.pose.x, sp.pose.y, 1));
      box.rotation.z = sp.pose.h + (blue ? Math.PI : 0);
      g.add(box);
    }
  };

  BZ.Field3D = Field3D;
})(typeof window !== 'undefined' ? window : globalThis);
