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
   Sous **Safari**, importez plutôt le robot en **STL** : Safari peut bloquer la lecture des STEP
   quand l'appli est ouverte comme fichier local.

Rien à installer et pas besoin d'Internet : l'appli marche aussi hors ligne, au bord du terrain.

## Sur iPhone ou iPad

1. Une seule fois : sur GitHub, **Settings > Pages**, « Build and deployment » : *Deploy from a branch*,
   branche `claude/zealous-euler-ceeast`, dossier `/ (root)`, **Save**. Après 1 à 2 minutes, l'appli est
   en ligne sur **https://alonsoclement08-hub.github.io/machine-learning-ftc/**.
2. Sur l'iPhone, ouvrez ce lien dans **Safari**, puis **Partager > Sur l'écran d'accueil** : l'appli
   s'ouvre alors en plein écran, sans les barres de Safari.
3. Tournez l'iPhone en **paysage** : terrain à gauche, pages à droite, outils compacts. Pour le
   robot, importez le **STL** (le STEP est lent sur téléphone).

Les réglages et le plan sont gardés dans l'iPhone (pas partagés avec l'ordinateur) : utilisez
« Exporter le plan » / « Importer un plan » pour passer de l'un à l'autre.

## Utilisation

L'écran est en deux parties : **le terrain en grand** à gauche, **une barre à 3 pages** à droite
(on passe d'une page à l'autre en glissant, comme les photos d'un post, ou avec les points en haut).

### Le terrain et l'île d'outils

- Bouton **2D / 3D** en bas à gauche, lecture ▶ en bas (cochez **aléatoire** pour un match où chaque
  tir réussit ou rate selon la précision du robot).
- En haut, l'**île** (pilule noire) contient les outils. Elle s'agrandit pour montrer les options de
  l'outil choisi, et affiche le score espéré, les bascules, la durée et les fautes.

| Outil | Ce qu'il fait |
|---|---|
| ✋ Choisir (V) | sélectionner, déplacer un point, une zone (et ses coins) ou le départ. Le **losange au milieu d'une flèche** se tire pour la **courber**. |
| ➜ Flèche (A) | ajoute un point de passage. |
| ◎ Tir (T) | ajoute un tir ; la pastille montre le **nombre de balles** (×1 à ×4 ou « tout ») et la précision depuis ce point (vert / orange / rouge, ✗ = impossible d'ici). |
| ⬚ Ramasser (P) | clic sur une FLOWER ou sur le GARDEN. |
| ▭ Zone (Z) | glisser pour dessiner une zone de couleur : **zone de tir** (l'IA choisit le point de tir dedans), **zone de passage**, **zone interdite** (partenaire). |
| 🅿 Park | clic dans la LOADING ZONE. |
| 🤖 Départ (D) | le robot se colle au mur ; **R / Q** pour le tourner. |
| 🧭 Orbite (3D) | comme en CAO : glisser = tourner, clic droit ou Maj = déplacer, molette = zoom, vues Dessus / Face / Côté / Iso. |

↶ ↷ annulent / rétablissent (Ctrl+Z / Ctrl+Y), 🗑 ou Suppr effacent la sélection.
**Double-clic** (ou double-tap) sur un objet du terrain : une fiche dit ce que c'est (étape, tir, zone,
PARK, départ, courbe), avec ses infos (chance de marquer, horaire…). On peut lui donner un **nom**, qui
s'affiche sur le terrain et dans « Mon plan », le régler, le déplacer plus tôt / plus tard ou le **supprimer**.

En bas à gauche, **📋 Mon plan** liste les étapes avec leur temps : on peut les monter / descendre,
les supprimer, ou les **verrouiller 🔒** pour que l'IA n'y touche pas. Le plan est gardé dans le
navigateur, et s'exporte / s'importe en `.json`. « Plan de l'équipe » remplit la stratégie
préchargées → FLOWER 1 → FLOWER 2 → GARDEN → PARK.

### Page 1 : Robot

- Importez votre robot en 3D : **STL** (le plus rapide, quelques secondes), **STEP**
  (`.step`/`.stp`) ou IGES. Un STL n'a pas d'unité : l'appli la devine (souvent des mm) et vous
  pouvez la corriger. Si le robot est couché ou mal orienté, tournez-le avec **↻ à plat**,
  **↻ avant-arrière** et **↻ côté**. Les dimensions sont mesurées sur le modèle (cube de 18 in, R102).
- Caractéristiques : châssis mecanum ou tank, les 3 variables, le lanceur (distance de tir,
  précision, cadence), l'intake, les noms des moteurs.
- **Déplacement** : *Chronométré* (sans capteur, temps en ms : export Java + .blk) ou *Odométrie*
  (roues odométriques réglées avec Pedro Pathing : vitesse max et accélération ; le robot ne
  s'arrête pas entre deux segments et tourne en roulant ; export **Pedro Pathing v3**).
- Intake : cases « GARDEN », « FLOWERS » et **« Ramasse un NECTAR »** (le NECTAR que le joueur
  humain pose dans la LOADING ZONE après chaque bascule).
- Match : alliance, **table de bascule** (POLLEN nécessaires selon les NECTAR dans la CELL :
  0 → 8, 1 → 7, 2 → 6, 3 → 3, 4 → 1, 5 → 0, d'après le manuel V1, à vérifier), NECTAR au départ (3),
  joueur humain et son délai, marge, PARK.

### Page 2 : Assistant (chat IA, optimisation, sessions dans le cloud)

**Tout se fait en parlant au chat (Gemini, API Google)** : la page ne contient que la discussion.
- « **optimise mon plan** » : l'optimisation tourne sur l'ordinateur (avancement affiché dans le chat) ;
  à la fin, l'assistant **annonce le résultat** (score avant → après, bascules, fautes) et demande si
  vous gardez le plan (« garde-le » / « reviens à mon plan »).
- « **lance une session de 2 h** » : la session part sur le serveur GitHub (ordinateur éteint possible) ;
  « **où en sont mes sessions ?** », « **charge la meilleure** », « **arrête la session essai** ». Quand
  une session se termine, l'assistant l'annonce.
- Questions et conseils : « pourquoi je ne fais pas 2 bascules ? », « rends mon trajet plus rapide »… Il
  essaie des variantes avec le simulateur et propose un plan ou des réglages (carte « Appliquer »).
- « utilise Gemini Pro » change de modèle ; « charge le résultat du cloud » charge le résultat intégré.

**Clé et jeton, collés dans le chat** : collez votre **clé API Gemini** (créée gratuitement sur
[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)) **seule dans un message** ;
plus tard, collez de même votre **jeton GitHub** (`github_pat_…`, voir plus bas) pour les sessions.
L'appli les reconnaît, les garde dans ce navigateur et ne les envoie **jamais** à l'IA (le message
affiché est masqué). « oublie ma clé » / « oublie mon jeton » les effacent. Avec un **relais Gemini**
d'équipe ([`tools/gemini-relais/LISEZMOI.md`](tools/gemini-relais/LISEZMOI.md), adresse dans
`js/config.js`), personne n'a besoin de clé ; s'il a un code : « code d'équipe : … ». Le chat a besoin
d'Internet ; tout le reste de l'appli marche hors ligne.

### Page 3 : Code

**Code du robot** : `AutoBiobuzzIA.java` / `AutoBiobuzzIA.blk` (chronométré) ou
`AutoBiobuzzIAPedro.java` (odométrie) du plan affiché, et où placer le robot au départ.
Le fichier Pedro suppose le **Quickstart Pedro Pathing v3** réglé pour votre robot
(`org.firstinspires.ftc.teamcode.pedro.Constants.create(hardwareMap)` qui renvoie votre Follower).

### Fichiers Inventor (.ipt / .iam)

Le format Inventor est fermé : rien d'autre qu'Inventor ne sait le lire. Exportez votre robot en STEP :
1. Ouvrez l'**assemblage .iam** complet.
2. Menu **Fichier > Exporter > Format CAO**.
3. Choisissez le type **STEP (*.stp)**.

Avec Onshape ou Fusion 360, faites clic droit puis Exporter > STEP.

## Sessions dans le cloud (ordinateur éteint)

Le chat de l'appli (« lance une session de 2 h ») lance des entraînements sur un serveur GitHub gratuit, pendant que
l'ordinateur est éteint. Il affiche aussi vos sessions (en cours, terminées) et le **meilleur
résultat**, à charger et rejouer, ou à télécharger directement en `.java` / `.blk`.

**Une seule fois : connecter GitHub.** Il faut créer un jeton, sur la page
https://github.com/settings/personal-access-tokens/new :

1. Repository access : **Only select repositories**, puis le dépôt `machine-learning-ftc`.
2. Permissions : **Actions = Read and write** et **Contents = Read and write**.
3. **Generate token**, puis collez le jeton **seul dans un message du chat** (page **Assistant**) : l'appli se connecte et le garde dans ce navigateur.

Le jeton reste uniquement dans ce navigateur.

**Ensuite, à chaque fois :**

1. Réglez le robot et le match (page 1) et dessinez votre plan : la session part de votre plan.
2. Dans le chat, dites par exemple « lance une session de 2 h appelée départ gauche » (340 min max).
3. Éteignez l'ordinateur si vous voulez. Au retour, rouvrez l'appli et demandez « où en sont mes
   sessions ? » ou « charge la meilleure ». Les sessions en cours enregistrent un point d'étape toutes les
   15 min.

Les résultats sont aussi rangés dans le dépôt, dans `sessions/<numéro>/` : `AutoBiobuzzIA.java`,
`.blk`, `rapport.md` et `resultat.json`.

À savoir :
- Plusieurs sessions peuvent tourner en même temps.
- Un dépôt privé a droit à 2000 minutes de calcul gratuites par mois. Un dépôt public n'a pas de
  limite.
- Sans jeton, on peut aussi déposer un `config.json` (bouton « ou télécharger config.json ») dans le
  dossier `entrainement/` du dépôt.
- En local : `node tools/train_cli.js config.json 60`.

## Exporter un fichier robot léger

- **STL** (le plus rapide, quelques secondes) : depuis Inventor, **Fichier > Exporter > Format CAO > STL**.
  Dans les Options, choisissez la résolution **Basse** ou **Moyenne** et l'unité **mm**.
- **STEP plus léger** : exportez en **AP214** plutôt qu'en AP242, qui ajoute des annotations (PMI).
  Un gros STEP peut quand même prendre plusieurs minutes : environ 6 s par Mo sous Chrome, plus sous
  Safari. L'appli affiche le temps estimé et ne s'arrête pas en cours de route.

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
  L'espérance des bascules est calculée exactement. Le robot vise la CELL qui fait face à son point
  de tir : tirer une balle de plus que nécessaire donne de la marge si une balle rate.
- **Stratégie de l'équipe** (point de départ de l'IA) : tirer les balles préchargées (1re bascule),
  FLOWER 1 → tir de l'autre côté, FLOWER 2 → tir (2e bascule), GARDEN → tir pour commencer la CELL
  suivante, puis PARK. L'IA ajuste ensuite les points de tir, le départ, l'ordre et le nombre de
  balles par tir.
- **Déplacements optimisés** : pour chaque trajet, le simulateur choisit la manœuvre la plus
  rapide (mecanum : cap pendant le trajet, en avant ou en crabe ; tank : en avant ou à reculons)
  et retire les points de passage inutiles (chaque segment coûte une pause).

**Paramètres à vérifier sur un vrai terrain** :
- le poids qui fait basculer la HIVE (8 POLLEN par défaut) et le poids d'un NECTAR (1,67 POLLEN) ;
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
