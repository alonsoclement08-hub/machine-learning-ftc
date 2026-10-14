// Sessions d'entraînement dans le cloud (GitHub Actions), pilotées depuis l'appli via l'API GitHub.
// Il faut un jeton GitHub (« fine-grained personal access token ») avec, sur le dépôt :
// Contents = Read and write, Actions = Read and write. Il est gardé uniquement sur cet ordinateur.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};

  const WORKFLOW = 'entrainement.yml';

  function Cloud(settings, fetchImpl) {
    this.s = settings; // { token, owner, repo, branch }
    this.fetch = fetchImpl || ((...a) => root.fetch(...a));
    this.cache = {}; // résultats des sessions terminées (ne changent plus)
  }

  Cloud.prototype.api = async function (path, opts) {
    opts = opts || {};
    const url = path.startsWith('http') ? path : `https://api.github.com/repos/${this.s.owner}/${this.s.repo}${path}`;
    const res = await this.fetch(url, {
      method: opts.method || 'GET',
      headers: Object.assign({
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + this.s.token,
        'X-GitHub-Api-Version': '2022-11-28',
      }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch (e) { /* pas de corps */ }
      const err = new Error(BZ.cloudErrorText(res.status, msg));
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return {};
    return res.json();
  };

  BZ.cloudErrorText = function (status, msg) {
    if (status === 401) return 'Jeton GitHub refusé (expiré ou mal copié). Recréez-en un et recollez-le.';
    if (status === 403) return 'Le jeton n\'a pas les droits nécessaires : il faut Contents (Read and write) et Actions (Read and write) sur le dépôt. ' + (msg || '');
    if (status === 404) return 'Dépôt, branche ou workflow introuvable : vérifiez le nom du dépôt et que le jeton a accès à ce dépôt.';
    if (status === 422) return 'GitHub a refusé la demande : ' + (msg || 'paramètres invalides') + '.';
    return `Erreur GitHub ${status} ${msg || ''}`.trim();
  };

  function b64ToUtf8(b64) {
    const bin = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // Vérifie le jeton et les droits.
  Cloud.prototype.check = async function () {
    const repo = await this.api('');
    await this.api(`/actions/workflows/${WORKFLOW}`);
    return { private: repo.private, push: repo.permissions ? repo.permissions.push : undefined, fullName: repo.full_name };
  };

  // Lance une session : le workflow reçoit la config du robot en paramètre.
  Cloud.prototype.launch = async function (nom, minutes, config) {
    const body = {
      ref: this.s.branch,
      inputs: { nom: String(nom).slice(0, 80), minutes: String(Math.round(minutes)), config: JSON.stringify(config) },
    };
    if (body.inputs.config.length > 60000) throw new Error('Config trop grande pour GitHub.');
    await this.api(`/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body });
  };

  Cloud.prototype.cancel = function (runId) {
    return this.api(`/actions/runs/${runId}/cancel`, { method: 'POST' });
  };

  // Liste les sessions : exécutions du workflow + résultats rangés dans sessions/<id>/.
  Cloud.prototype.sessions = async function () {
    const runsResp = await this.api(`/actions/workflows/${WORKFLOW}/runs?branch=${encodeURIComponent(this.s.branch)}&per_page=40`);
    const runs = (runsResp && runsResp.workflow_runs) || [];
    const dir = await this.api(`/contents/sessions?ref=${encodeURIComponent(this.s.branch)}`, { allow404: true });
    const withFolder = new Set((dir || []).filter((d) => d.type === 'dir').map((d) => d.name));
    const out = [];
    for (const r of runs) {
      const id = String(r.id);
      const s = {
        id, nom: r.name || r.display_title || 'Entraînement', status: r.status, conclusion: r.conclusion,
        debut: r.run_started_at || r.created_at, maj: r.updated_at, url: r.html_url, event: r.event, result: null,
      };
      if (withFolder.has(id)) s.result = await this.result(id, r.status === 'completed');
      out.push(s);
    }
    // dossiers sans exécution listée (anciennes sessions)
    for (const id of withFolder) {
      if (!out.find((s) => s.id === id)) {
        const result = await this.result(id, true);
        out.push({ id, nom: (result && result.nom) || 'Session ' + id, status: 'completed', conclusion: 'success', debut: result && result.debut, result });
      }
    }
    return out;
  };

  Cloud.prototype.result = async function (id, final) {
    if (this.cache[id]) return this.cache[id];
    const f = await this.api(`/contents/sessions/${id}/resultat.json?ref=${encodeURIComponent(this.s.branch)}`, { allow404: true });
    if (!f || !f.content) return null;
    let r = null;
    try { r = JSON.parse(b64ToUtf8(f.content)); } catch (e) { return null; }
    if (final && r && r.termine) this.cache[id] = r;
    return r;
  };

  // Meilleure session terminée ou en cours (celle qui a le meilleur score).
  BZ.bestSession = function (sessions) {
    let best = null;
    for (const s of sessions) {
      if (!s.result || !s.result.plan) continue;
      if (s.result.fautes && s.result.fautes.length) continue;
      if (!best || s.result.score > best.result.score) best = s;
    }
    return best;
  };

  BZ.Cloud = Cloud;
  if (typeof module !== 'undefined' && module.exports) module.exports = BZ;
})(typeof window !== 'undefined' ? window : globalThis);
