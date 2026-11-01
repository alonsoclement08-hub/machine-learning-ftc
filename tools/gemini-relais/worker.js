// Relais Gemini de l'appli BIOBUZZ Auto IA (Cloudflare Worker).
// La clé API Gemini reste ici, dans un secret du Worker (GEMINI_KEY) : elle n'est jamais envoyée au
// navigateur. Le relais ne transmet que les requêtes du chat BIOBUZZ, avec des limites :
//   - seulement les modèles autorisés (MODELES), seulement la génération de texte en flux ;
//   - la demande doit venir du chat BIOBUZZ (consigne BIOBUZZ + les 7 outils de l'appli) ;
//   - taille des demandes et longueur des réponses plafonnées ;
//   - nombre de demandes limité par appareil (adresse IP) ;
//   - origines autorisées (ORIGINES) et code d'équipe facultatif (CODE_EQUIPE).
// Réglages (Settings > Variables du Worker) :
//   GEMINI_KEY   (secret, obligatoire) : la clé de aistudio.google.com/app/apikey
//   CODE_EQUIPE  (secret, facultatif)  : si rempli, l'appli doit donner ce code (champ dans le chat)
//   MODELES      (texte, facultatif)   : modèles autorisés, séparés par des virgules (défaut ci-dessous)
//   ORIGINES     (texte, facultatif)   : sites autorisés, séparés par des virgules (défaut ci-dessous)
//   PAR_HEURE    (texte, facultatif)   : demandes par appareil et par heure (défaut 60)

const DEFAUT_MODELES = 'gemini-2.5-flash,gemini-2.5-flash-lite';
// « null » = appli ouverte en double-cliquant sur index.html (fichier local)
const DEFAUT_ORIGINES = 'https://alonsoclement08-hub.github.io,null';
const OUTILS = ['simuler_plan', 'proposer_plan', 'lire_reglages', 'modifier_reglages', 'optimiser_plan', 'afficher_carte', 'lancer_session_cloud'];
const MAX_OCTETS = 400000;
const MAX_TOKENS = 16000;
const API = 'https://generativelanguage.googleapis.com/v1beta';

const compteurs = new Map(); // ip -> { debut, n } (par instance du Worker : limite approximative)

const liste = (v, d) => String(v || d).split(',').map((x) => x.trim()).filter(Boolean);

function entetes(origin, autorise) {
  const h = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Biobuzz-Code', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (autorise) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function json(status, obj, h) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, h) });
}
const erreur = (status, statut, message, h) => json(status, { error: { code: status, status: statut, message } }, h);

function limite(ip, parHeure) {
  const now = Date.now();
  let c = compteurs.get(ip);
  if (!c || now - c.debut > 3600e3) { c = { debut: now, n: 0 }; compteurs.set(ip, c); }
  c.n++;
  if (compteurs.size > 5000) compteurs.clear();
  return c.n <= parHeure;
}

// La demande ressemble-t-elle bien à une demande du chat BIOBUZZ ?
function verifie(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.contents) || !body.contents.length) return 'demande invalide';
  if (body.contents.length > 80) return 'conversation trop longue : commencez une nouvelle discussion';
  const sys = body.systemInstruction && body.systemInstruction.parts && body.systemInstruction.parts.map((p) => p.text || '').join('');
  if (!sys || !/BIOBUZZ/.test(sys) || !/FIRST Tech Challenge/.test(sys)) return 'ce relais ne sert que pour le chat de l\'appli BIOBUZZ';
  const decl = (body.tools || []).flatMap((t) => t.functionDeclarations || []).map((d) => d.name).sort();
  if (decl.join(',') !== OUTILS.slice().sort().join(',')) return 'ce relais ne sert que pour le chat de l\'appli BIOBUZZ';
  return '';
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || 'null';
    const autorise = liste(env.ORIGINES, DEFAUT_ORIGINES).includes(origin);
    const h = entetes(origin, autorise);
    if (req.method === 'OPTIONS') return new Response(null, { status: autorise ? 204 : 403, headers: h });
    if (!autorise) return erreur(403, 'ORIGINE', 'site non autorisé par le relais', h);
    if (!env.GEMINI_KEY) return erreur(500, 'CONFIG', 'le relais n\'a pas de clé (secret GEMINI_KEY)', h);
    if (env.CODE_EQUIPE && req.headers.get('X-Biobuzz-Code') !== env.CODE_EQUIPE) return erreur(401, 'CODE_EQUIPE', 'code d\'équipe manquant ou faux', h);
    const modeles = liste(env.MODELES, DEFAUT_MODELES);

    // Liste des modèles autorisés (même format que l'API Gemini)
    if (req.method === 'GET' && url.pathname === '/models') {
      return json(200, { models: modeles.map((m) => ({ name: 'models/' + m, displayName: m, supportedGenerationMethods: ['generateContent'] })) }, h);
    }

    // Génération en flux : POST /stream?model=...
    if (req.method === 'POST' && url.pathname === '/stream') {
      const model = url.searchParams.get('model') || modeles[0];
      if (!modeles.includes(model)) return erreur(404, 'MODELE', 'modèle non autorisé par le relais : ' + modeles.join(', '), h);
      const ip = req.headers.get('CF-Connecting-IP') || 'inconnu';
      if (!limite(ip, Number(env.PAR_HEURE) || 60)) return erreur(429, 'LIMITE', 'trop de demandes depuis cet appareil : réessayez dans une heure', h);
      const texte = await req.text();
      if (texte.length > MAX_OCTETS) return erreur(413, 'TROP_GROS', 'demande trop grosse : commencez une nouvelle discussion', h);
      let body;
      try { body = JSON.parse(texte); } catch (e) { return erreur(400, 'JSON', 'demande illisible', h); }
      const pb = verifie(body);
      if (pb) return erreur(403, 'REFUSE', pb, h);
      body.generationConfig = Object.assign({}, body.generationConfig, { maxOutputTokens: Math.min(MAX_TOKENS, (body.generationConfig && body.generationConfig.maxOutputTokens) || MAX_TOKENS) });
      delete body.cachedContent;
      const r = await fetch(`${API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
        body: JSON.stringify(body),
      });
      const out = new Headers(h);
      out.set('Content-Type', r.headers.get('Content-Type') || 'text/event-stream');
      out.set('Cache-Control', 'no-store');
      return new Response(r.body, { status: r.status, headers: out });
    }
    return erreur(404, 'INCONNU', 'adresse inconnue', h);
  },
};
