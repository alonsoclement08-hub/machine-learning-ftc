# BIOBUZZ Auto IA 🐝

Un simulateur du jeu FTC 2026-2027 **BIOBUZZ** couplé à une IA (algorithme génétique). Elle cherche le
meilleur **AUTO de 30 secondes** pour **votre** robot, en respectant le règlement. Le résultat s'exporte
en **Java** (Android Studio / OnBot Java) et en **.blk** (FTC Blocks / Blockly).

Le programme exporté ne dépend que de **3 variables à calibrer** :

| Variable | Signification |
|---|---|
| `MS_PAR_METRE` | temps (ms) pour avancer de 1 mètre |
| `MS_POUR_180_DEG` | temps (ms) pour faire un demi-tour sur place |
| `PUISSANCE_TIR` | puissance du lanceur (0 à 1) |

## Lancer l'appli

1. Téléchargez ou clonez ce dossier.
2. **Double-cliquez sur `index.html`**. L'appli s'ouvre dans votre navigateur (Chrome ou Edge conseillés).

Rien à installer et pas besoin d'Internet : l'appli marche aussi hors ligne, au bord du terrain.

## Utilisation en 4 onglets

1. **Robot**
   - Importez votre robot en 3D (**STEP** `.step`/`.stp`, ou IGES). La lecture se fait en
     arrière-plan, avec un bouton Annuler. Les petites pièces (vis, écrous…) sont retirées pour que
     l'affichage reste fluide.
   - Un aperçu 3D montre le robot, sa flèche **avant** (rouge) et le cube de départ de 18 in (jaune).
     Si le robot est couché ou mal orienté, tournez-le avec les boutons **↻ à plat**,
     **↻ avant-arrière** et **↻ côté**.
   - La longueur, la largeur et la hauteur sont **mesurées sur le modèle** et mises à jour à chaque
     rotation. L'appli vérifie que le robot tient dans le cube de 18 in (R102).
   - Le robot apparaît avec son vrai modèle dans la vue 3D, et en silhouette vue de dessus dans la
     vue 2D.
   - Remplissez ensuite les caractéristiques : châssis mecanum ou tank, les 3 variables, le lanceur
     (distance de tir, précision, cadence), l'intake, et les noms des moteurs de votre configuration.
2. **Match**
   - Choisissez l'alliance, le nombre de balles qui font basculer la HIVE, et le nombre de NECTAR
     déjà dans la CELL au départ (3 selon le manuel TU04).
   - **Placer le robot** : bougez la souris sur le terrain, le robot se colle au mur le plus proche.
     **R/E** ou **Q** (ou les boutons ⟲ ⟳) le tournent, un clic le pose. Un départ interdit (G304)
     s'affiche en orange avec la raison.
   - Vous pouvez aussi dessiner une zone réservée à votre partenaire.
3. **Entraîner** : lancez l'IA. La courbe montre le meilleur score espéré, génération après
   génération. Le bouton ▶ rejoue le meilleur plan en 2D ou en 3D : les balles volent en arc
   jusque dans la CELL, et la HIVE bascule quand elle est pleine. Les balles de la CELL tombent
   alors au sol. Cochez **match aléatoire** pour voir un match où chaque tir réussit ou rate selon
   la précision du robot.
4. **Exporter** : téléchargez `AutoBiobuzzIA.java` ou `AutoBiobuzzIA.blk`. L'onglet affiche aussi où
   placer le robot au départ.

### Fichiers Inventor (.ipt / .iam)

Le format Inventor est fermé : rien d'autre qu'Inventor ne sait le lire. Exportez votre robot en STEP :
1. Ouvrez l'**assemblage .iam** complet.
2. Menu **Fichier > Exporter > Format CAO**.
3. Choisissez le type **STEP (*.stp)**.

Avec Onshape ou Fusion 360, faites clic droit puis Exporter > STEP.

## Installer le code sur le robot

- **Java** : copiez `AutoBiobuzzIA.java` dans `TeamCode/src/main/java/org/firstinspires/ftc/teamcode/`,
  puis compilez.
- **Blockly** : sur la page *Blocks* du Robot Controller, cliquez sur **Upload Op Mode** et choisissez
  `AutoBiobuzzIA.blk`.

Sur le Driver Station, sélectionnez l'OpMode « BIOBUZZ IA » **avec le timer de 30 s activé**. Le même
programme marche en rouge et en bleu, car le terrain est symétrique : placez le robot au même endroit,
vu depuis votre ALLIANCE AREA.

## Calibrer les 3 variables

Faites les mesures batterie chargée, sur des tuiles de terrain, avec les mêmes puissances que le
simulateur (par défaut 0,5 pour rouler et tourner) :

1. **`MS_PAR_METRE`** : faites avancer le robot 2000 ms et mesurez la distance `d` en mètres.
   `MS_PAR_METRE = 2000 / d`. Exemple : 1,30 m parcourus donne 1538.
2. **`MS_POUR_180_DEG`** : faites tourner le robot sur place 1000 ms et mesurez l'angle `a` en degrés.
   `MS_POUR_180_DEG = 1000 × 180 / a`.
3. **`PUISSANCE_TIR`** : à la distance de tir choisie par l'IA, augmentez la puissance jusqu'à ce que
   les balles entrent dans la CELL.

Pour régler le robot, il suffit de modifier ces 3 lignes. Pour que l'IA travaille avec les vraies
vitesses du robot, entrez aussi les valeurs mesurées dans l'appli et relancez l'entraînement : les
temps de trajet changent et l'IA peut trouver un meilleur plan.

## Ce que le simulateur connaît du jeu

Les données viennent du **CAD officiel du terrain** (`am-5850 BIOBUZZ`, converti depuis le STEP) et du
**Competition Manual TU04**.

- **Terrain** : 144 × 144 in. Pendant l'AUTO, le côté rouge = colonnes A-C et le côté bleu = D-F.
- **Balles** :
  - 4 POLLEN dans chaque FLOWER ;
  - 4 POLLEN dans chaque GARDEN ;
  - 4 POLLEN préchargés dans le robot ;
  - 3 NECTAR dans la CELL du haut.
- **Points AUTO** : LEAVE = 3, PARK (en partie dans la LOADING ZONE) = 5, HIVE TIP = 20.
- **Fautes évitées par l'IA** :

  | Règle | Interdiction |
  |---|---|
  | G304 | départ illégal |
  | G402 | aller du côté adverse |
  | G405 | sortir du terrain |
  | G407 | contrôler plus de 4 balles |
  | G409 | passer sous la HIVE |
  | G417 | toucher la HIVE |
  | G418 | sortir du POLLEN d'une FLOWER autrement que par le bas |
  | – | finir après 30 s |

- **HIVE** : modélisée à partir du CAD, avec un pivot à 43,95 in de haut et une bascule de 60°. La
  CELL est fermée sur le dessus et l'arrière, et son ouverture regarde vers l'extérieur, inclinée de
  30°. **On ne marque qu'en tirant du côté de l'ouverture** : en 2D, une flèche indique ce côté.
  Après une bascule, c'est l'autre CELL qui est en haut, avec son ouverture de l'autre côté.
- **Score espéré** : chaque tir réussit avec la probabilité « précision », à condition que la
  distance soit bonne, que le robot vise la bonne CELL et qu'il soit du côté de l'ouverture.
  L'espérance des bascules est calculée exactement.

**Paramètres à vérifier sur un vrai terrain** :
- le nombre de balles qui font basculer la HIVE (6 par défaut, NECTAR compris) ;
- la précision du lanceur ;
- les temps de ramassage.

## Limites

- Le code exporté est **chronométré** (pas d'encodeurs ni de capteurs). Il reste sensible à la
  batterie et aux glissements, d'où la pause après chaque mouvement et la marge de sécurité.
- L'animation montre le scénario où tous les tirs entrent. Le score affiché est l'**espérance**.

## Pour les développeurs

```bash
npm install                # occt-import-js et three (outils de dev)
npm test                   # tests : règles, fautes, optimiseur, compilation du Java exporté, XML Blockly
node tools/build_vendor.js # recopie les bibliothèques dans vendor/
node tools/convert_field.js "terrain.step"   # régénère data/field_*.js depuis le STEP du terrain
```

Organisation du code :

| Fichier | Rôle |
|---|---|
| `js/rules.js` | règles et barème |
| `js/planner.js` | planification des trajets (A*) |
| `js/sim.js` | simulateur |
| `js/optimizer.js` | algorithme génétique |
| `js/export_java.js`, `js/export_blockly.js` | exports |
| `js/render2d.js`, `js/render3d.js` | vues 2D et 3D |
| `js/robot_import.js` | import STEP |
| `js/app.js` | interface |

Bibliothèques incluses dans `vendor/` :
- [three.js](https://threejs.org) r147 (MIT) ;
- [occt-import-js](https://github.com/kovacsv/occt-import-js) (LGPL-2.1, basé sur OpenCascade).

Leurs licences sont dans `vendor/`.
