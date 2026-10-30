// Scène animée de la HIVE pour les vues 2D et 3D : angle de bascule, balles dans les CELLS,
// balles en vol (paraboles), balles ratées et balles qui tombent quand la HIVE bascule.
// Toutes les positions renvoyées sont en coordonnées ABSOLUES du terrain (pouces).
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};

  const TIP_DUR = 0.6; // durée de l'animation de bascule (s)
  const FALL_DUR = 0.45; // chute des balles au sol (s)
  const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const lerp = (a, b, u) => a + (b - a) * u;

  function rotX(p, piv, a) {
    const c = Math.cos(a), s = Math.sin(a);
    const dy = p.y - piv.y, dz = p.z - piv.z;
    return { x: p.x, y: piv.y + dy * c - dz * s, z: piv.z + dy * s + dz * c };
  }

  // Parabole du lanceur jusqu'au point B : monte au-dessus du bord de la CELL puis redescend dedans.
  BZ.shotArc = function (A, B, u) {
    const apex = Math.max(A.z, B.z) + 12;
    const h = Math.max(6, apex - (A.z + B.z) / 2);
    return { x: lerp(A.x, B.x, u), y: lerp(A.y, B.y, u), z: lerp(A.z, B.z, u) + 4 * h * u * (1 - u) };
  };

  function fallTo(A, B, u) {
    // chute : tombe d'abord verticalement puis avance un peu
    return { x: lerp(A.x, B.x, u), y: lerp(A.y, B.y, u), z: lerp(A.z, B.z, u * u) };
  }

  // st : { alliance, world, game, robot, outcomes, result }
  BZ.hiveScene = function (FIELD, st, t) {
    const H = FIELD.hive;
    const piv = H.pivot || { y: 0, z: 43.95 };
    const out = { angle: { red: 0, blue: 0 }, balls: [], fill: 0, upState: 0, tipping: 0 };
    const game = st.game || BZ.defaultGame();
    const nectar0 = game.nectarDepart !== undefined ? game.nectarDepart : 3;
    const ours = st.alliance || 'red';
    const blue = ours === 'blue';
    const abs = (p) => (blue ? { x: -p.x, y: -p.y, z: p.z } : p);
    const launchZ = st.robot ? Math.max(8, st.robot.hauteur_cm / 2.54) : 14;

    // HIVE adverse : immobile, avec ses NECTAR de départ
    const other = ours === 'red' ? 'blue' : 'red';
    const oc = H.cells[other];
    if (oc && oc.states) {
      for (let i = 0; i < Math.min(nectar0, oc.states[0].slots.length); i++) {
        out.balls.push(Object.assign({ kind: 'nectar-' + other }, oc.states[0].slots[i]));
      }
    }

    const cells = H.cells[ours];
    if (!cells || !cells.states) return out;
    const tipA = (H.tipAngle && H.tipAngle[ours]) || 0;
    const stateAngle = (s) => (s % 2 ? tipA : 0);
    const oc2 = st.outcomes || { shots: [], tips: [] };

    // Déroulé chronologique du contenu de la CELL du haut
    let contents = [];
    let cN = nectar0, cP = 0;
    for (let i = 0; i < nectar0; i++) contents.push('nectar-' + ours);
    let state = 0;
    const tips = []; // {t, from, balls}
    for (const s of oc2.shots) {
      if (!s.hit || s.tArr > t) continue;
      if (s.kind === 'nectar') { contents.push('nectar-' + ours); cN++; } else { contents.push('pollen'); cP++; }
      if (BZ.cellTips(game, cN, cP)) {
        tips.push({ t: s.tArr, from: state, balls: contents });
        contents = [];
        cN = 0; cP = 0;
        state ^= 1;
      }
    }

    // Angle de notre HIVE
    let angle = 0;
    let tipping = 0;
    for (const tp of tips) {
      const u = ease((t - tp.t) / TIP_DUR);
      angle = lerp(stateAngle(tp.from), stateAngle(tp.from + 1), u);
      if (u < 1) tipping = u;
    }
    out.angle[ours] = angle;
    out.upState = state;
    out.tipping = tipping;
    out.fill = contents.length;
    out.pollen = cP;
    out.need = BZ.tipNeed(game, cN);

    // Balles dans la CELL du haut actuelle
    const slots = cells.states[state].slots;
    contents.forEach((k, i) => {
      const p = slots[Math.min(i, slots.length - 1)];
      out.balls.push(Object.assign({ kind: k }, p));
    });

    // Balles des bascules : tournent avec la HIVE puis tombent au sol devant l'ancienne CELL
    tips.forEach((tp, ti) => {
      const oldSlots = cells.states[tp.from].slots;
      const side = Math.sign(cells.states[tp.from].open.y - piv.y) || 1;
      const a0 = stateAngle(tp.from), a1 = stateAngle(tp.from + 1);
      tp.balls.forEach((k, i) => {
        const s0 = oldSlots[Math.min(i, oldSlots.length - 1)];
        const dt = t - tp.t;
        const rotated = rotX(s0, piv, a1 - a0);
        const floor = { x: s0.x + ((i * 7 + ti * 3) % 5 - 2) * 1.2, y: side * (25 + (i % 3) * 3.2 + ti * 1.5), z: k === 'pollen' ? 1.4 : 1.8 };
        let p;
        if (dt < TIP_DUR) p = rotX(s0, piv, lerp(0, a1 - a0, ease(dt / TIP_DUR)));
        else if (dt < TIP_DUR + FALL_DUR) p = fallTo(rotated, floor, (dt - TIP_DUR) / FALL_DUR);
        else p = floor;
        out.balls.push(Object.assign({ kind: k }, p));
      });
    });

    // Balles en vol / ratées
    for (const s of oc2.shots) {
      if (s.t > t) continue;
      const from = abs({ x: s.x, y: s.y, z: launchZ });
      const st0 = cells.states[s.cellIdx];
      if (s.hit) {
        if (t >= s.tArr) continue; // déjà dans la CELL (ou tombée avec la bascule)
        const target = cells.states[s.cellIdx].slots[Math.min(s.slot, cells.states[s.cellIdx].slots.length - 1)];
        out.balls.push(Object.assign({ kind: s.kind === 'nectar' ? 'nectar-' + ours : 'pollen', flying: true }, BZ.shotArc(from, target, (t - s.t) / BZ.FLIGHT)));
      } else {
        // raté : la balle tape le bord de la CELL puis tombe au sol
        const rim = { x: st0.open.x + ((s.t * 17) % 6 - 3), y: st0.open.y, z: st0.open.z + 7 };
        const floor = { x: rim.x, y: st0.open.y + st0.normal[1] * 9 + ((s.t * 13) % 4 - 2), z: 1.4 };
        const mk = s.kind === 'nectar' ? 'nectar-' + ours : 'pollen';
        if (t < s.tArr) out.balls.push(Object.assign({ kind: mk, flying: true, miss: true }, BZ.shotArc(from, rim, (t - s.t) / BZ.FLIGHT)));
        else if (t < s.tArr + FALL_DUR) out.balls.push(Object.assign({ kind: mk, miss: true }, fallTo(rim, floor, (t - s.tArr) / FALL_DUR)));
        else out.balls.push(Object.assign({ kind: mk, miss: true }, floor));
      }
    }
    return out;
  };

  BZ.rotX = rotX;
})(typeof window !== 'undefined' ? window : globalThis);
