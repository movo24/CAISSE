# Fiche produit ERP — vérification live (surfaces à parcourir)

> Complète la discipline de vérification live (cf. `access-activity-audit-live-verification-runbook.md`).
> **Note « parcours clic-à-clic » : NON FAIT à ce jour** pour la fiche produit ERP.

## Ce qui EST vérifié (lot P-A/P-B, branche `feat/product-sheet-erp-pa`)

- Typecheck backend + frontend : exit 0.
- Lint (fichiers touchés + `eslint src` frontend) : 0 erreur.
- Tests : backend **1084** / frontend **84** (dont logique image principale unique, helpers `parseTags`/`formatTags`/`categoryFullPath`, validation DTO M-A).
- Migrations `1768`/`1769` : `up/down/up` sur **PostgreSQL réel isolé** ; contraintes DB **prouvées par rejet effectif** (2ᵉ image `main`, catégorie dupliquée).

## Ce qui RESTE à vérifier en LIVE (clic-à-clic, stack réelle backend+DB+auth)

La fiche produit ERP (`ProductEditPage`) s'ajoute à la **liste des surfaces à vérifier en live** :

1. **Général** : créer/éditer, cycle de vie commercial, fabricant, libellé ticket, désignation longue, étiquettes ; **CategoryPicker** — recherche par chemin, création inline (racine + sous-catégorie), rattachement au nœud.
2. **Stock** : planification réservé/min/max/sécurité + disponible calculé ; emplacement allée/étagère/niveau.
3. **Logistique** : poids brut vs net.
4. **Images** : sélecteur de type par image ; unicité « principale » observée à l'écran ; réordonnancement.
5. **Transversal** : valeurs nulles (champs omis), journal des modifications (M-E) alimenté, duplication reprenant les champs M-A.
6. **Catalogue (P-D/M-G)** : enregistrer une vue depuis `ProductsPage`, recharger la page/changer de poste → la vue **persiste côté serveur** ; supprimer une vue ; comportement en cas de coupure réseau (repli local).
7. **Statistiques (P-D)** : onglet Statistiques d'un produit ayant des ventes réelles → cartes (ventes/CA/panier/marge/rang) et histogramme 12 semaines cohérents ; produit sans vente → tout à 0 (jamais simulé).

**Attendu du parcours** : aucune régression console/réseau, payloads conformes aux DTO, journal `product_change_log` alimenté pour les champs M-A.

> À exécuter via le runbook live standard (boot stack, données de test, navigateur) avant tout merge `main`.
