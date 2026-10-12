// Règles BIOBUZZ (Competition Manual TU04) appliquées pendant l'AUTO, barème et monde du simulateur.
// Tout est calculé dans le repère de l'alliance ROUGE (x < 0 = notre côté). Le terrain est symétrique
// par rotation de 180°, donc un plan rouge est valable tel quel pour l'alliance bleue.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};
  const G = BZ.G;

  BZ.POINTS = {
    LEAVE: 3, // 10.5.4
    PARK: 5, // ROBOT au moins en partie dans la LOADING ZONE à la fin de l'AUTO
    TIP: 20, // HIVE TIP (10.5.1)
    MINOR: 5, // MINOR FOUL : 5 points donnés à l'adversaire
    MAJOR: 20, // MAJOR FOUL : 20 points donnés à l'adversaire
  };

  // Liste des fautes vérifiées par le simulateur.
  BZ.RULES = {
    G304: { titre: 'Position de départ illégale', points: 0, bloquant: true,
      texte: 'Le robot doit toucher le mur, être de son côté, hors LOADING ZONE, hors FLOWER, dans 18 in.' },
    G402: { titre: 'Passage du côté adverse en AUTO', points: 20,
      texte: 'Pendant l\'AUTO, rouge = colonnes A-C, bleu = D-F. Aller chez l\'adversaire = MAJOR FOUL.' },
    G407: { titre: 'Plus de 4 éléments contrôlés', points: 20,
      texte: 'Un robot ne peut pas contrôler plus de 4 SCORING ELEMENTS en même temps.' },
    G417: { titre: 'Contact avec la structure de la HIVE', points: 20,
      texte: 'Interdit de toucher/pousser la HIVE : seul le tir dans la CELL du haut peut la faire basculer.' },
    G418: { titre: 'Interaction illégale avec une FLOWER', points: 20,
      texte: 'On ne sort le POLLEN que par le bas d\'une FLOWER et on n\'y entre rien par le côté.' },
    G409: { titre: 'Sous la HIVE (attraper des balles)', points: 0,
      texte: 'Interdit d\'attraper les balles qui tombent d\'une HIVE qui bascule : on ne passe pas dessous.' },
    G405: { titre: 'Sortie du terrain', points: 20,
      texte: 'Le robot (et donc les balles qu\'il contrôle) doit rester dans le terrain.' },
    G416: { titre: 'Dépassement de la taille maximale', points: 20,
      texte: 'Extension max : 18 x 24 x 29 in (R105).' },
    TEMPS: { titre: 'Action non terminée avant la fin des 30 s', points: 0,
      texte: 'Ce qui n\'est pas fini à 30 s ne rapporte rien (et bouger pendant la transition = G403).' },
    FLOWER_CHOC: { titre: 'Choc avec une FLOWER (risque de faire tomber des balles)', points: 0,
      texte: 'Pas une faute en soi, mais l\'IA l\'évite.' },
    PARTENAIRE: { titre: 'Entrée dans la zone réservée au partenaire', points: 0,
      texte: 'Zone que vous avez dessinée pour votre robot partenaire.' },
  };

  // Construit le "monde" utilisé par le simulateur à partir du terrain et du robot.
  BZ.buildWorld = function (FIELD, game, rd) {
    const half = FIELD.half;
    const red = (o) => o.alliance === 'red';
    const flowers = FIELD.flowers.filter(red).map((f, i) => {
      const r = 3.4; // rayon de l'anneau + backstop
      // rectangle du mur jusqu'à l'avant de la FLOWER
      let poly;
      if (f.nx !== 0) {
        const xw = f.nx > 0 ? -half : half;
        const xf = f.x + f.nx * r;
        poly = G.rectPoly(Math.min(xw, xf), f.y - r, Math.max(xw, xf), f.y + r);
      } else {
        const yw = f.ny > 0 ? -half : half;
        const yf = f.y + f.ny * r;
        poly = G.rectPoly(f.x - r, Math.min(yw, yf), f.x + r, Math.max(yw, yf));
      }
      return { id: 'fleur' + i, nom: i === 0 ? 'FLOWER A' : 'FLOWER B', x: f.x, y: f.y, nx: f.nx, ny: f.ny, r, poly,
        pollen: f.pollen || 4, frontX: f.x + f.nx * r, frontY: f.y + f.ny * r };
    });
    // Empreinte du châssis en A de notre HIVE + l'espace sous les CELLS (on ne passe pas dessous).
    const hx = Math.max(...FIELD.hive.redFrame.map((p) => Math.abs(p[0]))) + 0.4;
    const hy = Math.max(...FIELD.hive.redFrame.map((p) => Math.abs(p[1]))) + 0.4;
    const hivePoly = G.rectPoly(-hx, -hy, 0.5, hy);

    const gz = FIELD.garden.red;
    const gardenBalls = (FIELD.gardenBalls && FIELD.gardenBalls.red) || [];
    const garden = {
      id: 'jardin', nom: 'GARDEN', zone: gz, balls: gardenBalls.map((b) => ({ x: b.x, y: b.y })),
      // le jardin rouge est le long du mur y = -half
      wallNy: gz.y0 < 0 ? 1 : -1,
    };

    const obstacles = [{ kind: 'hive', rule: 'G417', poly: hivePoly }];
    for (const f of flowers) obstacles.push({ kind: 'flower', rule: 'FLOWER_CHOC', poly: f.poly, id: f.id });
    if (game.zonePartenaire) {
      const z = game.zonePartenaire;
      obstacles.push({ kind: 'partner', rule: 'PARTENAIRE', poly: G.rectPoly(z.x0, z.y0, z.x1, z.y1) });
    }
    const cells = FIELD.hive.cells.red;
    return {
      half,
      flowers,
      garden,
      hivePoly,
      obstacles,
      loading: FIELD.loadingZone.red,
      cellTargets: [cells.up, cells.down], // [0] = CELL du haut au départ, [1] = après une bascule
      startNectar: cells.startNectar || 3,
      rd,
    };
  };

  // Vérifie une pose du robot (rectangle) et renvoie la liste des règles enfreintes.
  // `allow` : identifiants d'obstacles qu'on a le droit de toucher (ex. la FLOWER dont on vide le POLLEN).
  BZ.checkPose = function (world, x, y, h, allow, hlOverride) {
    const rd = world.rd;
    const hl = hlOverride || rd.hl;
    const poly = G.rectCorners(x, y, h, hl, rd.hw);
    const out = [];
    const half = world.half, tol = 0.35;
    for (const p of poly) {
      if (Math.abs(p[0]) > half + tol || Math.abs(p[1]) > half + tol) { out.push('G405'); break; }
    }
    for (const p of poly) {
      if (p[0] > 0.5) { out.push('G402'); break; }
    }
    for (const o of world.obstacles) {
      if (allow && allow.indexOf(o.id) >= 0) continue;
      if (G.polyOverlap(poly, o.poly, 0.05) > 0) out.push(o.rule);
    }
    return out;
  };

  // Le robot touche-t-il un mur ? (pour LEAVE et G304)
  BZ.touchesWall = function (world, x, y, h, eps) {
    eps = eps === undefined ? 0.4 : eps;
    const poly = G.rectCorners(x, y, h, world.rd.hl, world.rd.hw);
    return poly.some((p) => Math.abs(p[0]) > world.half - eps || Math.abs(p[1]) > world.half - eps);
  };

  BZ.inLoadingZone = function (world, x, y, h) {
    const z = world.loading;
    const poly = G.rectCorners(x, y, h, world.rd.hl, world.rd.hw);
    return G.polyOverlap(poly, G.rectPoly(z.x0, z.y0, z.x1, z.y1), 0.5) > 0;
  };

  // Validation d'une position de départ (G304).
  BZ.checkStart = function (world, s) {
    const errs = [];
    const viol = BZ.checkPose(world, s.x, s.y, s.h);
    if (viol.length) errs.push('chevauche : ' + viol.join(', '));
    if (!BZ.touchesWall(world, s.x, s.y, s.h)) errs.push('doit toucher le mur du terrain');
    if (BZ.inLoadingZone(world, s.x, s.y, s.h)) errs.push('ne doit pas être dans la LOADING ZONE');
    return errs;
  };

  // Positions de départ légales : robot plaqué contre un mur de notre côté, cap multiple de 90°.
  BZ.legalStarts = function (world, step) {
    step = step || 3;
    const rd = world.rd, half = world.half, starts = [];
    const caps = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (const h of caps) {
      const ex = Math.abs(Math.cos(h)) > 0.5 ? rd.hl : rd.hw; // demi-étendue en x
      const ey = Math.abs(Math.cos(h)) > 0.5 ? rd.hw : rd.hl;
      const walls = [
        { fixed: 'x', v: -half + ex }, // mur de l'alliance (gauche)
        { fixed: 'y', v: -half + ey }, // mur du public
        { fixed: 'y', v: half - ey }, // mur du fond
      ];
      for (const w of walls) {
        if (w.fixed === 'x') {
          for (let y = -half + ey; y <= half - ey + 1e-6; y += step) starts.push({ x: w.v, y, h });
        } else {
          for (let x = -half + ex; x <= -ex + 1e-6; x += step) starts.push({ x, y: w.v, h });
        }
      }
    }
    return starts.filter((s) => BZ.checkStart(world, s).length === 0).map((s) => ({
      x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100, h: s.h,
    }));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BZ;
})(typeof window !== 'undefined' ? window : globalThis);
