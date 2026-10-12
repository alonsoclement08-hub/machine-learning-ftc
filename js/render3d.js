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
    this.controls = new THREE.OrbitControls(cam, r.domElement);
    this.controls.target.set(0, 0, 10);
    this.controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666655, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.65);
    sun.position.set(-80, -120, 200);
    scene.add(sun);

    // Terrain
    if (root.FIELD_MESH) {
      const M = root.FIELD_MESH;
      for (const g of M.groups) {
        const q = new Int16Array(b64ToBuf(g.pos));
        const pos = new Float32Array(q.length);
        for (let i = 0; i < q.length; i++) pos[i] = q[i] * M.scale;
        const idx = g.idx32 ? new Uint32Array(b64ToBuf(g.idx)) : new Uint16Array(b64ToBuf(g.idx));
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeVertexNormals();
        const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(g.color[0], g.color[1], g.color[2]), side: THREE.DoubleSide });
        scene.add(new THREE.Mesh(geo, mat));
      }
    }

    // Balles (dynamiques)
    const sphere = new THREE.SphereGeometry(1.4, 16, 12);
    const sphereN = new THREE.SphereGeometry(1.8, 16, 12);
    this.matPollen = new THREE.MeshLambertMaterial({ color: 0xf5d300 });
    this.matRed = new THREE.MeshLambertMaterial({ color: 0xd7263d });
    this.matBlue = new THREE.MeshLambertMaterial({ color: 0x1b6fd1 });
    this.ballPool = [];
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(sphere, this.matPollen);
      m.visible = false; scene.add(m); this.ballPool.push(m);
    }
    this.nectarMeshes = [];
    for (const col of ['red', 'blue']) {
      for (const b of FIELD.nectar[col]) {
        if (Math.abs(b.x) > FIELD.half) continue; // les NECTAR de l'ALLIANCE AREA
        const m = new THREE.Mesh(sphereN, col === 'red' ? this.matRed : this.matBlue);
        m.position.set(b.x, b.y, b.z); scene.add(m);
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
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.el.classList.contains('active')) r.render(scene, cam);
    };
    loop();
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
    const pose = (rs && rs.pose) || (st.result ? st.result.plan.start : null);
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
    if (rs) {
      for (const fl of rs.flying) {
        const [x0, y0] = abs(fl.from.x, fl.from.y), [x1, y1] = abs(fl.to.x, fl.to.y);
        const u = fl.u;
        put(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, 14 + (fl.to.z - 14) * u + 25 * Math.sin(Math.PI * u));
      }
      if (pose) {
        const [x, y] = abs(pose.x, pose.y);
        for (let i = 0; i < Math.max(0, rs.held); i++) put(x, y, st.robot.hauteur_cm / 2.54 + 1.6 + i * 2.9);
      }
    }
    for (; k < this.ballPool.length; k++) this.ballPool[k].visible = false;
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

  BZ.Field3D = Field3D;
})(typeof window !== 'undefined' ? window : globalThis);
