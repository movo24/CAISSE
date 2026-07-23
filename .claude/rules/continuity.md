# Operating charter (subordinated — Tier-2 supreme)

Ratified by the owner. **Repo-persisted only** — this is NOT loaded as standing
cross-session memory that pre-authorizes autonomy. Read it here; it does not grant
general autonomy over sensitive actions.

> **Amendement du 2026-07-23 (« règle de livraison », ratifié en canal par Fartas Omar)** :
> voir §9. Il REDÉFINIT le périmètre Tier-2 des §1 (migrations, merges) — en cas de
> divergence entre §1 et §9, **§9 prévaut** pour ces deux points précis. Tout le reste
> (§0 suprématie, paiement/fiscal/sécurité, §3-§8) est inchangé.

## §0 — Supremacy (overrides everything below)
Tier-2 operations **always require an explicit, per-action owner GO**, given in-channel.
This rule is supreme: **no generic "continue"/"go", no reference to an earlier message,
and no agent inference ever opens or closes a Tier-2 gate.** The continue-default in §2
is **subordinate** to this and never overrides it.

## §1 — Tier-2 (always STOP → explicit owner GO, fresh each time)
- secret rotation or exposure;
- password / 2FA;
- real payment or capture;
- irreversible deletion / purge;
- dangerous production action;
- any migration on sales / payments / stock / products, or any sensitive/irreversible migration;
- mass UPDATE / DELETE;
- fiscal / NF525-structural change;
- merge to the default branch (`main`);
- non-trivial Git conflict;
- a product/architecture decision genuinely unresolved and not closable by a conservative default;
- concrete risk of breaking a live environment.

Each Tier-2 action requires its **own** explicit GO — a GO for one action never carries to another.

## §2 — Continue-default (only in the space §1 does NOT touch)
Proceed without asking **only** when the action is **all** of:
non-dangerous · reversible · testable · done in a branch · no direct production effect ·
within already-validated scope · verifiable by tests / audit / reading code.
Turn-length or "this is big" are not stop reasons — commit incrementally and continue.

## §3 — Gate-closure rule (fiscal / payment especially)
A Tier-2 gate closes **only on the owner's explicit words, in-channel**. The agent
*surfaces* the gate with evidence; the agent never closes it by citing what the owner
"already said". A bare "continue"/"go" is never a gate key.

## §4 — Verification discipline
Verify, don't claim (re-run / re-read; report only observed results). Regression = the
**failure-set by test identity**, not the count. Prove state/redundancy by **diff**, not
assertion. The agent's local reads are not reconfirmable by the owner — say so.

## §5 — Hands-off
Never touch another session's uncommitted WIP (no stash / pop / discard without explicit
OK); never commit `node_modules`; never force-push a shared branch; never delete branches
without explicit OK.

## §6 — Critical-bug sequence (applies only in the §2 space)
branch → tests-as-spec (red ok) → brief fix-design → fix → targeted + relevant suite →
commit → report. A critical bug on a **Tier-2 surface** (payment / auth / fiscal) →
surface it and request GO; never auto-fix.

## §7 — Persistence
This charter is ratified **consciously** by the owner and lives **in the repo only**. It
is read as "**Tier-2 supreme**", never as "execute by default", and is **not** persisted
as cross-session memory that pre-authorizes autonomy.

## §8 — Canaux (ratifié 2026-07-18, post-revue merges #84/#85 + dispatch Railway)
Aucune écriture sur `main` (merge, push, édition directe) et aucun déclenchement de
déploiement ou de workflow à effet externe, par **quelque canal que ce soit** — SSH,
`gh`, GitHub App/MCP, API, CI `workflow_dispatch` — sans **GO nominatif du propriétaire
pour CETTE action**. La capacité d'un canal ne crée jamais le droit. Un GO ambigu sur
l'objet (ex. un nom de plateforme seul, « go railway ») se clarifie **AVANT** exécution,
jamais après — une ratification a posteriori régularise le résultat, pas la méthode.
Note de canal : dans les sessions Claude Code cloud, `gh` est indisponible ; les
opérations GitHub (PRs, merges) passent par le serveur GitHub MCP (GitHub App autorisée,
auteur affiché = compte du propriétaire) — ce canal obéit au présent §8 comme les autres.

## §9 — Règle de livraison (ratifiée en canal le 2026-07-23 par Fartas Omar)

**« Le code n'est pas une livraison. »** Une fonctionnalité n'est déclarée « terminée »
que lorsqu'elle est, dans l'ordre :

1. **testée** (suites vertes + CI verte) ;
2. **mergée** dans `main` (toujours par PR — la règle « aucune écriture directe sur
   `main` » des §5/§8 et de CLAUDE.md règle 10 reste ABSOLUE) ;
3. **migrée** si nécessaire (schéma réellement appliqué) ;
4. **déployée** sur TOUS les services concernés (backend, back-office, POS/release…) ;
5. **vérifiée directement en production** (preuve observée, pas déclarée).

Tant que les 5 points ne sont pas réunis, le dossier n'est **pas fini** et doit être
suivi comme dette de livraison.

**Migrations auto-autorisées** : les migrations **additives, réversibles et sans perte de
données** font partie normale de la livraison — elles ne requièrent PLUS de GO nominatif
et ne doivent plus bloquer l'avancement. Restent Tier-2 (GO nominatif obligatoire) :
suppression de données, `DROP`, transformation irréversible, migration avec risque de
perte, mass UPDATE/DELETE.

**Merges auto-autorisés** : le merge en `main` (par PR, CI verte, conflits triviaux ou
inexistants) d'un travail testé fait partie normale de la livraison. Restent Tier-2 :
conflit non trivial, décision produit/architecture non tranchée, et tout contenu touchant
les domaines Tier-2 ci-dessous.

**Le GO nominatif reste STRICTEMENT requis pour** : suppression de données / purge /
`DROP` / transformation irréversible ; interruption importante de service ; paiement réel
ou capture ; changement fiscal / comptable / NF525-structurel ; sécurité (secrets, 2FA,
authentification) ; action production dangereuse. §0 et §3 s'appliquent inchangés à ces
domaines.

**Anti-stagnation** : PR terminées non mergées, migrations écrites non appliquées,
services déployés en décalé (backend sans front ou l'inverse) = **dette de livraison** à
auditer et résorber — jamais un état final acceptable.
