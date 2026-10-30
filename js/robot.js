// Description du robot de l'équipe + paramètres de jeu réglables.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};

  // Toutes les distances saisies par l'utilisateur sont en cm ; le simulateur travaille en pouces.
  BZ.defaultRobot = function () {
    return {
      nom: 'Mon robot',
      chassis: 'mecanum', // 'mecanum' ou 'tank'
      longueur_cm: 43, // avant-arrière (gabarit de départ max 45,7 cm)
      largeur_cm: 43,
      hauteur_cm: 40,

      // --- Les 3 variables de calibrage exportées ---
      msParMetre: 1500, // temps pour avancer d'1 m à puissanceRoues
      msPour180: 1200, // temps pour tourner de 180° à puissanceRotation
      puissanceTir: 0.85, // puissance du lanceur

      // --- Réglages fixes (exportés en constantes, normalement pas besoin d'y toucher) ---
      puissanceRoues: 0.5,
      puissanceRotation: 0.5,
      facteurCrabe: 0.8, // vitesse en crabe / vitesse en avant (mecanum)
      pauseMs: 150, // pause d'arrêt après chaque mouvement

      // --- Déplacement : 'chrono' (temps en ms, sans capteur) ou 'odometrie' (Pedro Pathing) ---
      deplacement: 'chrono',
      odo: {
        vMax_cm_s: 150, // vitesse max en ligne droite (mesurée avec les outils de réglage Pedro)
        accel_cm_s2: 250, // accélération / freinage
      },

      lanceur: {
        sens: 'avant', // 'avant' ou 'arriere' : côté du robot par lequel il tire
        distMin_cm: 60, // distance horizontale min jusqu'à la CELL
        distMax_cm: 260,
        distIdeale_cm: 150, // distance où le tir est le plus précis
        precision: 0.85, // probabilité qu'une balle entre dans la CELL quand on est à bonne distance
        monteeMs: 900, // temps de montée en vitesse du lanceur
        msParBalle: 400, // cadence de tir
      },
      intake: {
        sens: 'avant', // côté du ramassage
        msParBalle: 450,
        approche_cm: 10, // distance parcourue intake allumé pour aller chercher les balles
        puissance: 1.0,
        sol: true, // peut ramasser les balles posées au sol (GARDEN)
        fleur: true, // peut sortir le POLLEN par le bas d'une FLOWER
        nectar: false, // peut ramasser un NECTAR (posé par le joueur humain dans la LOADING ZONE)
      },
      moteurs: {
        avantGauche: 'frontLeft',
        avantDroit: 'frontRight',
        arriereGauche: 'backLeft',
        arriereDroit: 'backRight',
        gauche: 'leftDrive', // tank
        droit: 'rightDrive', // tank
        lanceur: 'launcher',
        intake: 'intake',
        alimentation: '', // moteur qui pousse les balles dans le lanceur ('' = on utilise l'intake)
      },
      inverserGauche: true, // moteurs du côté gauche en REVERSE (cas le plus courant)
    };
  };

  BZ.defaultGame = function () {
    return {
      alliance: 'red',
      dureeAuto: 30,
      margeSecurite: 1.0, // secondes gardées en réserve à la fin de l'AUTO
      seuilBascule: 8, // (ancien réglage, remplacé par tableBascule) poids qui fait basculer
      poidsNectar: 1.67, // (ancien réglage) un NECTAR pèse autant que ~1,67 POLLEN
      // POLLEN qui font basculer une CELL selon le nombre de NECTAR dedans (0, 1, 2, 3, 4, 5+)
      tableBascule: [8, 7, 6, 3, 1, 0],
      nectarHumain: true, // le joueur humain pose 1 NECTAR dans la LOADING ZONE à chaque bascule (G426.A)
      delaiHumain_s: 2, // temps pour que le NECTAR arrive sur le tapis après la bascule
      nectarReserve: 5, // NECTAR du joueur humain
      v: 4,
      nectarDepart: 3, // NECTAR déjà dans la CELL du haut au départ (manuel TU04 : 3)
      prechargees: 4,
      zonePartenaire: null, // (ancien) {x0,y0,x1,y1} en pouces (repère rouge) que l'IA doit éviter
      zones: [], // zones dessinées : {id, kind: 'tir'|'interdite'|'passage', color, x0,y0,x1,y1} (repère rouge)
      departImpose: null, // {x, y, h} en pouces / radians (repère rouge)
      viserPark: true,
    };
  };

  // Valeurs dérivées utilisées par le simulateur (pouces, secondes).
  BZ.robotDerived = function (r) {
    const IN = 1 / 2.54;
    const hl = (r.longueur_cm * IN) / 2, hw = (r.largeur_cm * IN) / 2;
    const d = {
      hl, hw,
      radius: Math.hypot(hl, hw),
      vAvant: 39.3701 / (r.msParMetre / 1000), // pouces / s
      vCrabe: (39.3701 / (r.msParMetre / 1000)) * r.facteurCrabe,
      wRot: Math.PI / (r.msPour180 / 1000), // rad / s
      pause: r.pauseMs / 1000,
      tirMin: r.lanceur.distMin_cm * IN,
      tirMax: r.lanceur.distMax_cm * IN,
      tirIdeal: Math.min(r.lanceur.distMax_cm, Math.max(r.lanceur.distMin_cm, r.lanceur.distIdeale_cm || (r.lanceur.distMin_cm + r.lanceur.distMax_cm) / 2)) * IN,
      tirSens: r.lanceur.sens === 'arriere' ? Math.PI : 0,
      intakeSens: r.intake.sens === 'arriere' ? Math.PI : 0,
      approche: r.intake.approche_cm * IN,
      odo: r.deplacement === 'odometrie',
      vOdo: ((r.odo && r.odo.vMax_cm_s) || 150) * IN,
      aOdo: ((r.odo && r.odo.accel_cm_s2) || 250) * IN,
    };
    // odométrie : le robot roule à la vitesse réglée pour Pedro (et non plus selon MS_PAR_METRE)
    if (d.odo) { d.vAvant = d.vOdo; d.vCrabe = d.vOdo * r.facteurCrabe; }
    return d;
  };

  // Vérifie les dimensions par rapport au règlement (R102 : départ dans un cube de 18 in).
  BZ.robotWarnings = function (r) {
    const w = [];
    if (r.longueur_cm > 45.72 || r.largeur_cm > 45.72) w.push('Le robot dépasse 45,7 cm (18 in) au départ : interdit (R102).');
    if (r.hauteur_cm > 45.72) w.push('Le robot dépasse 45,7 cm (18 in) de haut au départ : interdit (R102).');
    if (r.msParMetre < 300) w.push('MS_PAR_METRE semble très petit (robot à plus de 3 m/s ?).');
    if (r.puissanceTir <= 0 || r.puissanceTir > 1) w.push('PUISSANCE_TIR doit être entre 0 et 1.');
    return w;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BZ;
})(typeof window !== 'undefined' ? window : globalThis);
