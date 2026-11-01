# Relais Gemini de l'équipe (clé partagée et cachée)

Le relais est un petit programme gratuit hébergé chez Cloudflare. Il garde la clé API Gemini dans
un **secret** : l'appli ne la voit jamais, donc personne ne peut la copier pour s'en servir ailleurs.
Tous ceux qui utilisent l'appli ont le chat, sans coller de clé.

Le relais n'accepte que :
- les demandes du **chat BIOBUZZ** (la consigne BIOBUZZ et les outils de l'appli) ;
- les modèles autorisés (par défaut `gemini-2.5-flash` et `gemini-2.5-flash-lite`) ;
- l'appli en ligne (`https://alonsoclement08-hub.github.io`) et l'appli ouverte en double-cliquant sur
  `index.html` ;
- 60 demandes par heure et par appareil (réglable), avec des réponses de longueur limitée ;
- en option, seulement ceux qui ont le **code d'équipe**.

## Installer le relais (une seule fois, 10 minutes)

1. Créez un compte gratuit sur https://dash.cloudflare.com/sign-up.
2. Menu **Workers & Pages** > **Create** > **Create Worker** (modèle « Hello World »). Nommez-le
   `biobuzz-gemini`, puis **Deploy**.
3. **Edit code** : effacez tout, collez le contenu de `worker.js` (ce dossier), puis **Deploy**.
4. Dans le Worker : **Settings** > **Variables and Secrets** > **Add** :
   - Type **Secret**, nom `GEMINI_KEY`, valeur : votre clé de https://aistudio.google.com/app/apikey ;
   - (facultatif) Type **Secret**, nom `CODE_EQUIPE`, valeur : un mot de passe pour l'équipe.
   Puis **Deploy**.
5. Copiez l'adresse du Worker (du genre `https://biobuzz-gemini.votre-compte.workers.dev`) et mettez-la
   dans `js/config.js` :
   ```js
   window.BIOBUZZ_RELAIS_GEMINI = 'https://biobuzz-gemini.votre-compte.workers.dev';
   ```
   (L'adresse n'est pas secrète : sans la clé, elle ne sert qu'au chat BIOBUZZ.)

Réglages facultatifs (même écran, type **Text**) : `MODELES` (modèles autorisés, séparés par des
virgules), `ORIGINES` (sites autorisés), `PAR_HEURE` (demandes par appareil et par heure).

## Conseils pour la clé

- Prenez une clé **sans facturation** (offre gratuite d'AI Studio) : au pire, le quota gratuit est
  épuisé, mais rien n'est payé.
- Dans la console Google Cloud (APIs et services > Identifiants), vous pouvez restreindre la clé à la
  seule **Generative Language API**.
- Si la clé a été montrée quelque part (chat, message, capture), supprimez-la et créez-en une autre.

## Limites à connaître

Le relais empêche de **voler la clé** et de l'utiliser pour autre chose que le chat BIOBUZZ, mais
quelqu'un qui imite exactement l'appli pourrait encore lui poser des questions, dans les limites
ci-dessus. Le code d'équipe ferme cette porte : sans le code, le relais refuse tout.
