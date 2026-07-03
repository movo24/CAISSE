# DOSSIER_EXECUTION_OMAR.md — Tout ce qui reste, prêt à exécuter (P363)

> Généré le 2026-07-03 (jalon v35+, 22 commits session P332→P363).
> Règle : chaque section = commandes copiables + critère VERT/ROUGE + quoi me copier/coller en retour.

---

## §1 — GATE 2 : migrations 1725→1728 sur Neon (≈10 min) — LE geste à plus fort impact

### Commande (la seule chose à taper)
```bash
cd ~/CAISSE
DATABASE_URL="postgresql://...neon.tech/...?sslmode=require" ./scripts/run-gate2.sh
```
L'URL : console Neon → ton projet → **Connection string** (pooler) — elle finit par `?sslmode=require`.

### Prérequis (le script vérifie tout, mais pour éviter un aller-retour)
| Check | Commande | Si KO |
|---|---|---|
| psql + pg_dump | `psql --version && pg_dump --version` | `brew install libpq && brew link --force libpq` |
| Repo à jour | `git -C ~/CAISSE log --oneline -1` | doit être ≥ `c2cb726` |
| Pas de déploiement Railway en même temps | dashboard Railway calme | attendre la fin |

### Résultat attendu (VERT)
```
════ GATE 2 : SUCCÈS ✅ — garde le dump pre-gate2-....dump quelques jours. ════
```
avec au-dessus 6 lignes ✅ (tables neuves vides, COUNT(sales) inchangé, tête = 1728).

### Erreurs possibles et quoi faire
| Message | Cause | Action |
|---|---|---|
| `❌ DATABASE_URL manquant` | URL pas passée | reprendre la commande avec l'URL |
| `could not translate host name` / timeout | mauvaise URL ou réseau | re-copier l'URL depuis Neon (pooler) |
| `password authentication failed` | mauvais credentials | régénérer le password Neon, re-copier l'URL |
| `❌ Tête inattendue (...)` | ce n'est PAS la bonne base | STOP — vérifier le projet Neon ; ne rien forcer |
| `✅ 1728 déjà jouée — rien à faire.` | migrations déjà passées (ex. boot Railway) | c'est un succès, rien à faire |
| Un ❌ dans les contrôles post-migration | anomalie réelle | NE PAS déployer ; me copier TOUTE la sortie ; rollback §3 du MIGRATION_RUNBOOK |

### À me copier/coller en retour
**Toute la sortie du script**, du `── A. BACKUP` jusqu'à la ligne `════`. C'est tout.

### Plan de reprise IMMÉDIAT après SUCCÈS (moi, dès ton copier/coller)
1. GATE 2 → ✅ dans GATES_READINESS + EXECUTION_LOG + POS_BLOCKS (migrations 1725-1728 : « jouées sur cible »).
2. Je te donne les 2 commandes de vérification applicative : redéploiement backend B (RUNBOOK) puis `GET /api/health` → 200, et après une vente de test `GET /api/integration/outbox/stats` (pending ≥ 1 = l'outbox écrit en réel).
3. Déblocage en chaîne : activation relais outbox (TD-INT-RELAY — il ne manquera que `OUTBOX_PUBLISH_URL/SECRET`), fond de caisse + comptage en réel, variantes/fournisseurs en réel.

---

## §2 — E2E locaux POS-010→015 (Playwright — DÉJÀ installé : config + smoke existants)

### Ce qui existe déjà
`packages/pos-desktop/e2e/pos-smoke.spec.ts` : **login → scan produit → paiement espèces** (le parcours critique), avec `playwright.config.ts` et un `e2e/README.md` (seed local documenté).

### Séquence exacte (3 terminaux ou `&`)
```bash
# 0. une fois : navigateurs Playwright
cd ~/CAISSE/packages/pos-desktop && npx playwright install chromium

# 1. base locale + seed (une fois — cf e2e/README.md pour le seed complet)
cd ~/CAISSE && npm run docker:up

# 2. backend local
cd ~/CAISSE && npm run dev:backend        # attendre "listening on 3001"

# 3. les e2e (mode UI recommandé la première fois)
cd ~/CAISSE/packages/pos-desktop
npm run test:e2e            # headless — verdict CI-style
npm run test:e2e:ui         # interactif — pour VOIR le parcours
```

### Critères VERT/ROUGE par bloc
| Bloc | Scénario | VERT si | Couvert par |
|---|---|---|---|
| POS-011 écran caisse | login PIN puis saisie article | produit apparaît dans le panier | smoke existant |
| POS-012 panier | ajout/retrait/quantité | totaux recalculés à chaque action | smoke existant (ajout) + à étendre |
| POS-013 paiement | espèces ≥ total | vente validée + monnaie affichée | smoke existant |
| POS-014 ticket | après paiement | numéro de ticket affiché/historique | smoke existant (fin de parcours) |
| POS-015 retour | ReturnModal sur vente du jour | avoir généré, stock restauré | à écrire (scénario 2) |
| POS-010 dual-window | `npm run dev:pos` (Electron) | fenêtre caisse + écran client s'ouvrent | manuel (Electron hors Playwright web) |

### Scénarios à ajouter (je les écris dès que tu confirmes que le smoke passe chez toi)
S2 retour/avoir · S3 remise 21-30% avec PIN responsable · S4 clôture session avec comptage (écart serveur) · S5 bascule offline (cash seul) → reconnexion → sync.

### À me copier/coller
La sortie de `npm run test:e2e` (la ligne `x passed` ou l'erreur complète).

---

## §3 — Runbooks matériel (session physique, ~1 h tout compris)

### 3a. TPE Stripe WisePad 3 (POS-033/041/042)
Préalable : compte Stripe en **mode TEST** (`sk_test_...` dans le `.env` du clone qui lance le backend) — jamais live pour ces essais.
1. Brancher/allumer le WisePad → POS → paramètres TPE → découverte Bluetooth → appairage.
2. Vente test carte (carte de test Stripe 4242…) → VERT : paiement accepté, vente finalisée, PaymentIntent visible dans le dashboard Stripe test avec NOTRE clé d'idempotence.
3. Double-clic volontaire sur « payer » → VERT : UN SEUL PaymentIntent (l'idempotence prouvée 5/5 tient en réel).
4. Couper le WiFi de la caisse, TPE en mode dépendant → VERT : le différé se propose (plafond 150 €) ; reconnecter → capture exécutée, vente finalisée. Refus (carte test de refus 4000…0002) → VERT : vente abandonnée, message opérateur.
ROUGE si : double charge (STOP tout, me copier l'écran Stripe), ou vente finalisée sans capture.

### 3b. Imprimante BLE ESC/POS (POS-031/014/036)
1. POS → périphériques → scan BLE → appairer (services connus : 18f0/e781/49535343 — déjà dans le code).
2. « Impression test » → VERT : ticket TEST IMPRIMANTE sort, coupe papier OK.
3. Vente réelle → ticket fiscal complet (SIRET/TVA/NIF affichés). 4. Réimpression → VERT : « DUPLICATA n°1 — NE VAUT PAS ORIGINAL » en tête ET en pied.
5. Tiroir-caisse : « ouvrir tiroir » → VERT : impulsion ouvre le tiroir (trame 1B 70 00 19 FA prouvée).

### 3c. Caméra scanner (POS-030/032)
1. iPad/poste avec caméra → POS → scan → autoriser la caméra.
2. Scanner 5 EAN réels variés (13 chiffres, 8 chiffres, un QR) → VERT : produit trouvé à chaque fois, PAS de double bip sur le même article (anti-rebond 1,5 s prouvé 7/7 tient en réel).
3. Scanner le même article 2× vite en mode caisse → VERT : UNE seule ligne panier.

### 3d. Smartphone réel (POS-110)
1. `cd packages/mobile && npm run dev` → ouvrir l'URL sur le téléphone (même WiFi) ; login employé **manager**.
2. VERT : tuile « Supervision » visible (invisible pour un caissier), badge global correct, listes remplies, bouton Réessayer sur erreur réseau (mode avion 5 s).

### À me copier/coller (matériel)
Pour chaque poste : « 3a OK/KO », et si KO le message d'écran exact — je transforme chaque KO en bloc de correction.

---

## §4 — État FINAL des gates (rien d'autre n'existe)

| # | Gate | Dépend de | Simulable encore ? | Support prêt |
|---|---|---|---|---|
| G1 | Migrations 1725→1728 (Neon) | **TOI** (10 min) | non — c'est la vraie base | §1 + `run-gate2.sh` + PRE_GATE2_CHECKLIST |
| G2 | Révocation anciennes clés PRIM + Google | **TOI** (2×3 min) | non — consoles externes | SECRETS_REVOCATION_PLAN §1-§2 |
| G3 | TD-TWO-CLONES : identifier le clone Claude Code | **TOI** (1 commande) | non | `git rev-parse --show-toplevel` côté Claude Code |
| G4 | E2E locaux POS-010→015 | **TOI** (30 min, machine locale) | partiellement fait (smoke existant) | §2 |
| G5 | Matériel : TPE, BLE, caméra, smartphone | **TOI + matériel** (~1 h) | NON — tout le simulable est ÉPUISÉ (33 tests matériel simulé verts) | §3 |
| G6 | TW24 live + PIN prod 500 (S1) | **TOI** (secrets Railway) | non — réseau réel | TIMEWIN24_CONTRACT, MONITORING-PLAYBOOK |
| G7 | Paywin24 + Comptamax24 | **Externe** (specs+accès) | outbox + events déjà simulés/prouvés | OUTBOX_RELAY_KIT |
| G8 | Purge historique git (optionnelle) | **TOI**, APRÈS G2 | n/a | SECRETS_REVOCATION_PLAN §3 (gated) |

**Ordre recommandé : G2 (3 min) → G1 (10 min) → G3 (1 min) → G4 → G5.** G1+G4 réussis = le système est validable de bout en bout en conditions réelles.

---

## §5 — Côté logiciel : épuisé, sauf sur commande

Après P363, il ne reste AUCUN bloc logiciel sûr non couvert. Les prochains blocs logiciels naîtront de TES retours : chaque KO des §2-§3, le verdict de G1, ou les specs G7 — je les enchaîne sans GO dès réception.
