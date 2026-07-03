# SECRETS_REVOCATION_PLAN.md — Dossier de révocation des 2 clés fuitées (P356)

> Préparé le 2026-07-02. **RIEN ici ne s'exécute tout seul** — révocation et purge
> d'historique restent des actions à GO humain (Omar). Contexte : S2 confirmé P332,
> désamorcé localement P354 (valeurs retirées du `.env`, 0 occurrence arbre de travail).
> L'HISTORIQUE GIT contient toujours les 2 valeurs (commit `f2ad1b5`).

## 0. État de la rotation (au 2026-07-02)

| Clé | Nouvelle clé générée ? | Posée où ? | Ancienne révoquée ? |
|---|---|---|---|
| `PRIM_API_KEY` | ✅ (par Omar) | Env Claude Code (PAS dans `packages/backend/.env` de ce clone — ligne commentée prête) | ❌ **À FAIRE** |
| `GOOGLE_MAPS_API_KEY` | ❌ volontairement différé (CB Google requise) | — (mode no-key testé, non bloquant) | ❌ **À FAIRE** |

**Ordre des opérations correct** : la rotation PRIM étant faite, la révocation de
l'ancienne PRIM est **sans risque de coupure** (le code utilise la nouvelle là où elle
est posée ; ailleurs, mode no-key prouvé). Pour Google Maps, PAS de nouvelle clé →
la révocation coupe la fonctionnalité météo/contexte… qui est DÉJÀ en mode no-key
volontaire → **révocable immédiatement, zéro impact**.

## 1. Révocation ancienne clé PRIM — procédure console

1. Se connecter au portail PRIM (compte détenteur de la clé).
2. Section **API Keys / Jetons** → identifier la clé commençant par `8WTo…` (créée avant 2026-07).
3. **Revoke/Delete**. Si le portail propose "regenerate", NE PAS regénérer celle-ci (la nouvelle existe déjà) — supprimer.
4. Vérification : un appel avec l'ancienne clé doit répondre 401/403.
5. Impact attendu : AUCUN (nouvelle clé déjà en service côté env Claude Code ; ce clone est en no-key).

## 2. Révocation ancienne clé Google Maps — procédure console

1. https://console.cloud.google.com → projet propriétaire de la clé.
2. **APIs & Services → Credentials** → identifier la clé `AIzaSyAdq…` .
3. **Delete** (pas "restrict" : la valeur est publique dans un historique git, la restriction ne suffit pas).
4. Impact attendu : AUCUN (fonction déjà désactivée volontairement, fallback no-key testé 4/4).
5. Plus tard, quand la CB sera posée : créer une NOUVELLE clé, **restreinte** (APIs précises + referrer/IP), et la poser sur la ligne commentée de `packages/backend/.env`.

## 3. Purge d'historique git — PLAN (GATED, ne pas exécuter sans GO dédié)

**Nécessité réelle : FAIBLE une fois les 2 révocations faites** (des valeurs mortes
dans l'historique ne sont plus un risque). Recommandation : révoquer d'abord, puis
décider si la purge vaut son coût (réécriture d'historique = tous les SHA changent).

Si GO purge :
```bash
# Outil : git-filter-repo (pas BFG — filter-repo est l'outil maintenu recommandé par git)
pip install git-filter-repo

# 1. Filet de sécurité : bundle complet AVANT (rollback = re-clone depuis ce bundle)
git bundle create pre-purge-$(date +%Y%m%d).bundle --all

# 2. Fichier des valeurs à expurger (NE PAS committer ce fichier).
#    ⚠️ Les valeurs complètes ne sont PAS écrites ici (P359 : elles avaient été
#    collées en clair dans ce doc tracké — erreur corrigée). Récupère-les depuis
#    l'historique : `git show f2ad1b5:docker/.env.production.example`
#    (clé PRIM = 8WTo…2PvF ; clé Google = AIzaSyAdq…jUjWk0)
git show f2ad1b5:docker/.env.production.example | grep -oE '(8WTo[A-Za-z0-9]+|AIzaSy[A-Za-z0-9_-]+)' > /tmp/secrets-to-purge.txt

# 3. Purge (réécrit TOUTES les branches et tags)
git filter-repo --replace-text /tmp/secrets-to-purge.txt --force
rm /tmp/secrets-to-purge.txt
```
- **Branches concernées** : toutes (filter-repo réécrit tout le graphe) — ici principalement
  `recovery/pos-audit-session` + les refs historiques du bundle.
- **Conséquences** : SHA réécrits → tout clone/`pos-recovery.bundle` antérieur devient
  divergent ; le remote (`movo24/CAISSE`) devra être force-pushé (action prod-adjacente → GO dédié) ;
  GitHub garde des caches (PR, forks) — demander le purge support GitHub si parano.
- **Rollback** : re-clone depuis `pre-purge-*.bundle` (l'historique original y survit — le
  garder HORS de tout remote public, puis le détruire une fois la purge validée).

## 4. Checklist de clôture S2

- [ ] Ancienne PRIM révoquée (401 vérifié)
- [ ] Ancienne Google Maps supprimée
- [ ] (Optionnel) Railway : variables PRIM/GMaps mises à jour ou retirées si présentes
- [ ] Décision purge historique : ☐ oui (GO dédié) ☐ non (valeurs mortes suffisent)
- [ ] S2 → ✅ dans POS_SECURITY.md avec date + qui a révoqué
