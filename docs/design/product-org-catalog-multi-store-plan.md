# Fiche produit unique (organisation) + affectation multi-magasins + archivage automatique — dossier d'exécution

> 2026-07-23 — analyse validée et **décisions owner intégrées** (message « Décisions
> validées pour finaliser le plan », Fartas Omar). **Aucun code applicatif, aucune
> migration exécutée, aucun merge, aucun déploiement sans GO nominatif — Fartas Omar.**

## 0. Décisions owner actées (2026-07-23)

| # | Décision |
|---|---|
| 1 | Produit test `WES-P-000000000001` : **intact**, actif sur The Wesley Test, stock 5 (test physique douchette) |
| 2 | **Stock magasin porté par `product_store_assignments`** ; mouvements → journal `stock_movements` existant ; prix → `store_product_prices` |
| 3 | **Référentiels (catégories, marques, fournisseurs) → org-level AVANT l'ouverture de l'interface multi-magasins** |
| 4 | `products.store_id` **conservé en compatibilité puis déprécié — AUCUN DROP dans ce chantier** (GO séparé après validation complète) |
| 5 | Archivage 6 mois **intégré au modèle `product_store_assignments`** : `is_active`, `assigned_at`, `last_sold_at`, `archived_at`, `archive_reason`, infos de réactivation |
| 6 | Archivage **même avec stock restant** — la notification signale le **stock théorique restant** pour déclencher un contrôle physique |
| 7 | Jamais vendu → horloge depuis la **première affectation/entrée en stock dans LE magasin**, jamais depuis la création de la fiche |
| 8 | **Vente offline synchronisée après archivage** : conservée comptablement + **alerte** — **aucune réactivation automatique** (la réactivation reste une décision du responsable) |
| 9 | **Un réassort récent REPORTE l'archivage** : le délai de 6 mois repart de **l'activité la plus récente** parmi { dernière vente · dernière entrée POSITIVE de stock · affectation initiale · réactivation } |

## 1. Constat — modèle actuel (vérifié dans le code @ `main` 4c3ddea)

| Élément | État actuel |
|---|---|
| `products` | **1 ligne par magasin** : `store_id NOT NULL`, unique `(ean, store_id)`, `stock_quantity`, `is_active`/`status` portés par la ligne |
| « Produit dans 2 magasins » | = 2 fiches distinctes (ids différents) — conception rejetée |
| Prix magasin | `store_product_prices` existe (fenêtres programmées) mais unique sur `product_id` seul — à étendre |
| Stock | Sur la ligne produit (vente, ajustements, inventaires, écarts) ; `stock_movements` porte déjà `store_id` ✔ |
| Référentiels | Catégories, marques, fournisseurs **par magasin** (`unique (store_id, name)`) |
| Multi-tenant | `TenantInterceptor` filtre par `storeId` du JWT (admin bypass) |
| POS | Pull complet `GET /products?storeId=<magasin>` (≤ 15 s + après chaque vente) ; cache hors-ligne |
| UI création | Assistant : « Magasin de publication » mono-magasin — à remplacer |
| Couplage | `products.service.ts` : 224 réfs `storeId` ; + sales, stock, CSV, bulk, stats |

**Données prod (2026-07-23)** : 3 produits (1 Boutique Paris, 2 The Wesley Test),
**0 doublon EAN inter-magasins** → aucune consolidation ; fenêtre idéale, chaque import
d'ici l'exécution la complexifie.

## 2. Modèle cible (arrêté)

### 2.1 `products` — fiche unique organisation
Nom, code-barres (GTIN ou WES-P, **unique org-wide** en phase finale), catégorie, marque,
fournisseur (org-level après P2), photo, TVA, type, prix de base. `store_id` conservé en
compatibilité (décision 4), plus jamais utilisé pour le filtrage à terme.

### 2.2 `product_store_assignments` — cœur du chantier (décisions 2 et 5)

```sql
CREATE TABLE product_store_assignments (
  id              uuid PK DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES products(id),
  store_id        uuid NOT NULL REFERENCES stores(id),
  is_active       boolean NOT NULL DEFAULT true,   -- visible/vendable dans CE magasin
  -- stock PAR magasin (décision 2 ; les mouvements restent dans stock_movements)
  stock_quantity          integer NOT NULL DEFAULT 0,
  stock_alert_threshold   integer,
  stock_critical_threshold integer,
  -- horloge d'inactivité (décisions 5, 7 et 9)
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  first_stocked_at timestamptz,                    -- 1re entrée stock (information/audit)
  last_stock_entry_at timestamptz,                 -- dernière entrée POSITIVE de stock (décision 9)
  last_sold_at    timestamptz,                     -- dernière vente CE produit / CE magasin
  -- archivage réversible (jamais de DELETE)
  archived_at     timestamptz,
  archive_reason  varchar(30),                     -- 'inactivity_6m' | 'manual' | 'unchecked'
  archived_stock_snapshot integer,                 -- stock théorique au moment de l'archivage (décision 6)
  reactivated_at  timestamptz,
  reactivated_by  uuid,                            -- employé responsable
  created_at/updated_at timestamptz,
  CONSTRAINT uq_product_store UNIQUE (product_id, store_id)
);
```

Invariants : `is_active=false` ⇔ `archived_at`+`archive_reason` renseignés ; décocher un
magasin dans l'UI = archivage `archive_reason='unchecked'` (réversible) ; **aucun DELETE,
jamais** ; réactivation = `is_active=true` + `reactivated_at/by` (l'horloge repart de là).

### 2.3 Prix et mouvements (décision 2)
- `store_product_prices` : contrainte unique étendue à `(product_id, store_id)` = prix
  magasin ; le prix de base reste sur la fiche.
- `stock_movements` : inchangé — reste LE journal de traçabilité ; les écritures ciblent
  le couple (produit, magasin) et mettent à jour `assignments.stock_quantity` +
  `first_stocked_at` à la première entrée.

### 2.4 Référentiels org-level (décision 3 — AVANT l'UI multi-magasins)
Catégories/marques/fournisseurs : `store_id` rendu nullable + lignes org (store_id NULL),
dédoublonnage par nom (3 produits en prod : mapping trivial), unique `(name)` org pour les
nouvelles lignes ; les lignes magasin existantes sont fusionnées vers l'org puis conservées
en lecture (pas de DROP, même politique que `products.store_id`).

## 3. Séquence des migrations (chacune additive, avec rollback — §5)

| Mig | Contenu | Rollback |
|---|---|---|
| **1774** | `product_store_assignments` (DDL §2.2 complet, archivage inclus — décision 5) + **backfill** : 1 ligne par produit existant (`product_id`, son `store_id`, `is_active` = état actuel, stock copié, `assigned_at` = `products.created_at`, `first_stocked_at` = 1re entrée stock_movements si existante, `last_sold_at` = MAX(vente) si existante) | `DROP TABLE product_store_assignments` (aucune autre table touchée) |
| **1775** | `store_product_prices` : unique `(product_id, store_id)` (remplace unique `product_id`) | restauration de l'ancien index |
| **1776** | Référentiels : `store_id` nullable + lignes org fusionnées + remap des `products.category_id/brand_id/supplier_id` vers les ids org (table de correspondance conservée) | remap inverse via la table de correspondance (aucune ligne supprimée) |
| **1777** (fin de chantier, GO dédié) | index unique `ean` org-wide (précondition re-vérifiée : 0 doublon) | retour à unique `(ean, store_id)` |
| Hors chantier (GO séparé, décision 4) | dépréciation finale / DROP éventuel de `products.store_id` | n/a — jamais dans ce chantier |

Ordre d'exécution du chantier : **1774 → 1775 → double-écriture backend → 1776
(référentiels) → UI multi-magasins → job d'archivage → 1777**. L'UI n'ouvre qu'après 1776
(décision 3).

## 4. Comportements

### 4.1 API / backend (double-écriture puis bascule — pattern stock-journal F2)
- Écritures stock (vente, ajustement, inventaire, réception) : `assignments` **ET** colonne
  legacy `products.stock_quantity` pendant la transition ; `last_sold_at` mis à jour à
  chaque vente du couple (produit, magasin).
- Lectures (`list`, `scan`, stats, alertes stock) : via assignment (`is_active`), fallback
  legacy si assignment absent (ceinture).
- Nouveaux endpoints : `GET/PUT /products/:id/stores` (lire/éditer les affectations —
  upsert + archivage `unchecked`, jamais de suppression) ; `POST .../:storeId/reactivate`
  (rôle manager/admin).
- `TenantInterceptor` inchangé : caissier = son magasin uniquement.

### 4.2 Synchronisation POS
- Le pull catalogue renvoie les produits **affectés** au magasin avec leur statut ;
  recherche/vente = actifs uniquement ; **aucune récupération globale automatique**.
- Les affectations archivées voyagent dans le cache avec leur statut → le scan d'un
  produit archivé affiche, même hors-ligne : « Produit archivé pour inactivité —
  réactivation par un responsable nécessaire. » (ajout au panier refusé).
- Une caisse hors-ligne pendant la bascule garde son cache ; à la reconnexion le pull
  filtré prend le relais (aucune caisse ne perd son catalogue).

### 4.3 UI (après 1776)
- Assistant + fiche : section « **Magasins dans lesquels ce produit est disponible** » —
  cases à cocher (tous les magasins), « Tout sélectionner » / « Tout désélectionner »,
  précochage du magasin contextuel (décochable), libre en Vue globale, modifiable après
  création sans recréer le produit.
- Fiche → section Magasins : badge par magasin (Actif / Archivé inactivité / Archivé
  manuel / Décoché) avec motif, dernière vente, date d'archivage, **stock théorique au
  moment de l'archivage**, bouton Réactiver (manager/admin).

### 4.4 Archivage automatique 6 mois (job quotidien)
- `@Cron` 04:00 Europe/Paris (infra `ScheduleModule` en place).
- **Horloge (décision 9 — formule unique)** : point de départ =
  `MAX(assigned_at, dernière vente, dernière entrée POSITIVE de stock, reactivated_at)`
  — ventes et entrées de stock recalculées par requête autoritaire (`sales` /
  `stock_movements` du couple produit-magasin) au moment du job, valeurs figées dans
  `last_sold_at` / `last_stock_entry_at` à l'archivage pour consultation. Un réassort
  récent **reporte** donc l'archivage (une entrée de stock prouve l'exploitation) ; la
  date de création de la fiche n'entre JAMAIS en compte (décision 7). Les sorties et
  corrections négatives de stock ne comptent pas (entrées **positives** uniquement).
- « Six mois complets » stricts (mois calendaires Europe/Paris).
- Transition **atomique** : `UPDATE … SET is_active=false, archived_at=now(),
  archive_reason='inactivity_6m', archived_stock_snapshot=stock_quantity,
  last_sold_at=<calculé> WHERE id=… AND is_active=true` → l'archivage en double est
  structurellement impossible (double job, deux instances).
- Si la ligne a réellement transitionné : entrée d'audit chaînée
  (`product_store_archived_inactivity`) + notifications 3 canaux (responsable magasin,
  back-office, caisse) : « Le produit [nom/code] n'a enregistré aucune vente depuis six
  mois et a été retiré du catalogue actif. » — **complétée, si `archived_stock_snapshot >
  0`, par : « Stock théorique restant : N — contrôle physique recommandé. »** (décision 6).
- Fiche générale → « Produits archivés » quand TOUTES les affectations sont inactives ;
  ressort dès une réactivation.
- Le job ignore `archive_reason='manual'` et `'unchecked'`.

## 5. Rollback (par étape, sans perte)

| Étape | Procédure de retour |
|---|---|
| 1774/1775 | migrations down (DROP de la table d'affectation / index restauré) — les colonnes legacy n'ont jamais cessé d'être écrites pendant la double-écriture → retour à l'état antérieur SANS perte |
| Double-écriture | feature-flag de lecture (`assignment` → `legacy`) : bascule inverse instantanée sans migration |
| 1776 (référentiels) | remap inverse via table de correspondance (aucune ligne supprimée) |
| UI | redéploiement Vercel précédent (« Instant Rollback ») — le backend double-lecture sert les deux UIs |
| Job d'archivage | désactivable par flag ; réactivation en masse possible (`is_active=true` sur `archive_reason='inactivity_6m'`), l'audit garde la trace des deux transitions |
| 1777 | retour à l'index `(ean, store_id)` |

Garantie transverse : **aucune donnée historique (ventes, mouvements, prix, journaux,
fiches) n'est modifiée ni supprimée par aucune étape** — preuve par diff dans les tests.

## 6. Cas limites (arbitrés sauf mention)

1. Réactivé puis toujours pas vendu ni réassorti → horloge depuis `reactivated_at` (pas de re-archivage le lendemain).
2. Jamais vendu, jamais stocké → horloge depuis `assigned_at` (décisions 7/9).
3. Frontière : archive si l'activité la plus récente `< now − 6 mois` stricts.
4. **Vente offline synchronisée après archivage** (décision 8, ARBITRÉ) : vente TOUJOURS
   conservée comptablement, `last_sold_at` mis à jour, **alerte** « vendu alors
   qu'archivé » — **aucune réactivation automatique**, la réactivation reste une décision
   du responsable.
5. Produit dans un panier au moment de l'archivage → la vente en cours n'est jamais cassée.
6. **Réassort récent** (décision 9, ARBITRÉ — remplace l'arbitrage antérieur) : une entrée
   positive de stock **reporte** l'archivage ; le produit réassorti il y a 1 mois n'est
   PAS archivé même sans vente depuis 8 mois. Corollaire décision 6 : si malgré tout
   l'archivage survient avec du stock restant (aucune activité 6 mois), le stock théorique
   figure dans la notification (contrôle physique).
7. Retours/avoirs ≠ vente → ne réinitialisent pas l'horloge (proposé, adopté par défaut —
   contrordre possible au GO). NB : la remise en stock d'un retour est un mouvement
   d'entrée : décision owner de la compter ou non comme « entrée positive » (proposé :
   NON — seules les réceptions/réassorts comptent, un retour ne prouve pas l'exploitation).
8. Archivage manuel / décochage : motifs distincts, jamais touchés par le job.
9. Nouveau magasin coché → aucun archivage avant 6 mois d'affectation.
10. Fuseau Europe/Paris, mois calendaires, job idempotent.
11. WES-P et EAN fabricant strictement identiques face à toutes les règles.
12. Deux caisses d'un même magasin → même catalogue filtré (l'affectation est par magasin, pas par terminal).

## 7. Plan de tests (aucun code avant GO — liste contractuelle)

**Affectations (directive n°1)**
T1 affecté Marseille+Cergy → visible dans les deux (API POS par magasin) ·
T2 non coché Châtelet → absent de cette caisse, aucune récupération globale ·
T3 décocher Marseille → retiré de la caisse marseillaise, ventes/prix/stocks/journaux
intacts (diff) · T4 modifier la fiche générale → répercuté partout (même product_id) ·
T5 prix et stocks divergents par magasin (assignments + store_product_prices) ·
T6 code-barres unique org-wide (409, WES-P et GTIN).

**Archivage (directive n°2)**
A1 vendu il y a 7 mois à Marseille / 1 mois à Cergy → archivé Marseille seulement ·
A2 jamais vendu, affecté il y a 7 mois, aucune entrée stock → archivé (départ affectation,
jamais création fiche) · A3 jamais vendu, 5 mois → pas archivé · A4 frontière ±1 jour sur
l'activité la plus récente · A5 job ×2 / 2 instances → UN archivage, UN audit, UNE
notification · A6 archivé partout → fiche dans Produits archivés ; une réactivation la
fait ressortir · A7 réactivation sans vente ni réassort → pas de re-archivage avant 6
nouveaux mois · A8 scan d'un archivé (y compris hors-ligne) → message exact, panier
refusé · A9 vente offline post-archivage → conservée comptablement + horloge + ALERTE,
**aucune réactivation automatique** (décision 8) · A10 diff avant/après → historique
STRICTEMENT intact · A11 notifications 3 canaux, message exact, **stock théorique restant
mentionné si > 0** · A12 motifs manuel / décoché / inactivité distincts, job aveugle aux
deux premiers · **A13 (décision 9)** dernière vente il y a 8 mois MAIS entrée positive de
stock il y a 1 mois → PAS archivé ; la même entrée il y a 7 mois sans autre activité →
archivé · **A14** sortie/correction négative de stock récente → ne reporte PAS l'archivage.

**Migrations** M1 backfill 1774 : les 3 produits prod (dont le produit test, décision 1)
conservent exactement affectation/état/stock · M2 down-migrations 1774/1775/1776 sans
perte · M3 précondition 1777 (0 doublon EAN) re-vérifiée à l'exécution.

## 8. Produit test (décision 1)
`WES-P-000000000001` (« TEST CODE WESLEY — vrac 2026-07-23 », id `dbb9ba9f-…`) : **actif,
stock 5, The Wesley Test — ne pas toucher** ; réservé au test physique douchette. Sa
publication mono-magasin valide le Code 128, pas le futur multi-magasins (noté).
