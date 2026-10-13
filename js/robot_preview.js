// Aperçu 3D du robot dans l'onglet Robot : modèle + boîte englobante + flèche AVANT,
// pour régler l'orientation avec les boutons de rotation.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};

  function RobotPreview(container) {
    this.el = container;
    this.ready = false;
    this.group = null;
  }

  RobotPreview.prototype.init = function () {
    if (this.ready || !root.THREE) return;
    const THREE = root.THREE;
    this.ready = true;
    const scene = this.scene = new THREE.Scene();
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    scene.background = new THREE.Color(dark ? 0x23272e : 0xf3f1ea);
    const cam = this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 500);
    cam.up.set(0, 0, 1);
    cam.position.set(-30, -34, 26);
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(window.devicePixelRatio || 1);
    this.el.appendChild(r.domElement);
    this.controls = new THREE.OrbitControls(cam, r.domElement);
    this.controls.target.set(0, 0, 6);
    this.controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777766, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(-30, -50, 80);
    scene.add(sun);
    // sol : une tuile de 24 in
    const grid = new THREE.GridHelper(24, 8, 0x999999, 0xcccccc);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    // gabarit de départ 18 in (fil de fer)
    const cube = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(18, 18, 18)),
      new THREE.LineDashedMaterial({ color: 0xe0a100, dashSize: 0.8, gapSize: 0.6 }));
    cube.position.set(0, 0, 9);
    cube.computeLineDistances();
    this.cube = cube;
    scene.add(cube);
    // flèche AVANT (+X)
    this.arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0.3), 14, 0xd7263d, 3, 2);
    scene.add(this.arrow);
    this.box = null;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.el);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.el.offsetParent !== null) r.render(scene, cam);
    };
    loop();
  };

  RobotPreview.prototype.resize = function () {
    if (!this.ready) return;
    const w = this.el.clientWidth || 10, h = this.el.clientHeight || 10;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  // group : THREE.Group en pouces (avant = +X) ou null pour une boîte aux dimensions du robot.
  RobotPreview.prototype.show = function (group, robot) {
    this.init();
    if (!this.ready) return;
    const THREE = root.THREE;
    if (this.group) this.scene.remove(this.group);
    if (this.box) this.scene.remove(this.box);
    if (!group) {
      const L = robot.longueur_cm / 2.54, W = robot.largeur_cm / 2.54, H = robot.hauteur_cm / 2.54;
      group = new THREE.Mesh(new THREE.BoxGeometry(L, W, H), new THREE.MeshLambertMaterial({ color: 0xd7263d, transparent: true, opacity: 0.6 }));
      group.position.set(0, 0, H / 2);
    }
    this.group = group;
    this.scene.add(group);
    this.box = new THREE.BoxHelper(group, 0x1b6fd1);
    this.scene.add(this.box);
    const b = new THREE.Box3().setFromObject(group);
    const L = b.max.x - b.min.x;
    this.arrow.position.set(0, 0, b.max.z + 1);
    this.arrow.setLength(Math.max(8, L / 2 + 6), 3, 2);
  };

  BZ.RobotPreview = RobotPreview;
})(typeof window !== 'undefined' ? window : globalThis);
