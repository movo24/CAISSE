# M302 — Effacement client : collision RGPD × NF525 (note de politique, lecture seule)

> Note de **politique** pour décision owner (RGPD × inaltérabilité fiscale). **Aucun code touché.**
> M302 n'est pas une tâche de build : il faut trancher la *politique* avant tout code, sinon
> le code heurte la chaîne fiscale. Réf dette : `TECHNICAL_DEBT.md` D13.

## Constat clé (vérifié LITTÉRALEMENT sur toute la surface fiscale) — la collision est PLUS ÉTROITE qu'attendu
Hypothèse porteuse confirmée champ par champ (2026-06-22) :
- `sale` : seul `customer_id` (pas de nom/email/téléphone client). Snapshots = **employé** (`employee_name_snapshot/role/maxDiscount`).
- `sale_payment` : `method, amount, currency, stripe_payment_intent_id, stripe_reader_id, terminal_id, captured…` → **aucun nom de payeur/porteur** ; les champs Stripe sont des **identifiants**, pas de la PII. Le champ générique `reference` n'est **rempli nulle part** (recherche = 0) → aucun risque.
- `sale_line_item` : `product_id, product_name, qty, prix, promo_id, tax_rate` → aucune PII client.
- `credit_note` / `credit_note_line` : `store_id, original_sale_id, original_ticket_number, refund_method, totals, hash` → **aucun nom/email/téléphone client**.
- Recherche `payer|cardholder|holder|metadata|jsonb|customerName` dans les entités fiscales = **0**.
⇒ **Le seul lien client dans tout enregistrement fiscal = `customer_id` (pseudonyme).** Seule identité embarquée = `employee_name_snapshot` (caissier) = donnée **employé**, conservée pour l'identification de l'opérateur (base légale distincte), **hors** droit à l'effacement client.
- ⇒ **Anonymiser un client (scrub nom/téléphone/email) ne modifie AUCUN enregistrement fiscal.** Le `customer_id` reste comme **clé pseudonyme** dans les ventes → l'inaltérabilité NF525 est préservée, et le droit à l'effacement RGPD est satisfait (la PII disparaît, l'ID devient un pseudonyme).
- **Le schéma est à moitié là** : `customer.entity` a déjà `deleted_at` et `anonymized_at` (l.58, 61) **mais aucune logique** ne les utilise (recherche `anonymiz/deletedAt` dans `modules/customers/` = 0). Donc : colonnes présentes, comportement absent.

## Les décisions de politique à trancher (avant code)
1. **Champs à scrubber vs conserver** : nom, téléphone, email, `password_hash` → effacer. `qr_code` → effacer ou neutraliser (c'est un identifiant ; le garder casserait le lien, mais c'est de la PII faible). `loyalty_points`, `visit_count` → conserver (agrégats non-PII) ou remettre à zéro ?
2. **Pseudonymisation vs suppression de ligne** : recommandé = **anonymiser en place** (scrub PII + `anonymized_at`), **garder la ligne** + `customer_id` (référencé par les ventes immuables). Une suppression dure de la ligne casserait la FK logique des ventes → à proscrire.
3. **Rétention légale** : les ventes (preuve fiscale) se conservent (durée légale) ; l'anonymisation du client n'y touche pas. Documenter que `customer_id` survit comme pseudonyme pendant la rétention fiscale.
4. **Documents dérivés** : reçus/avoirs — vérifier qu'aucun **n'imprime/stocke** le nom client de façon immuable (le builder de reçu lu en D9 affiche caissier/magasin/articles, pas le client ; à confirmer pour les avoirs). Règle : ne **pas** embarquer de PII client dans un document fiscal immuable ; afficher à la volée depuis le client (donc masqué après anonymisation).
5. **Portée & déclencheur** : endpoint admin **audité** (qui/quand) ; (P2) export de portabilité RGPD.

## Esquisse d'implémentation (après décision de politique, GO séparé)
- `customersService.anonymize(id)` : scrub des champs décidés en (1) ; set `anonymized_at` ; **pas** de suppression de ligne ; audit `customer_anonymized`.
- (option) soft-delete `deleted_at` pour retirer des listes actives sans casser les FK.
- Endpoint admin `@Roles('admin')` + audit. Migration : colonnes déjà présentes → probablement **aucune migration** (à confirmer) ⇒ changement additif, réversible côté code.
- Tests : anonymize scrubbe la PII + garde `customer_id` ; une vente existante reste lisible/inchangée (hash inchangé) après anonymisation du client (preuve NF525 × RGPD compatibles).

## Valeur de rétention PROPOSÉE (hypothèse — À CONFIRMER COMPTABLE)
Pour ne pas bloquer le chantier, hypothèse conforme à pinner avec l'expert-comptable :
- **Documents légalement porteurs de l'identité client (factures nominatives) : conservation 10 ans** — base : Code de commerce art. L123-22 (livres & pièces comptables). Le fiscal pur (LPF art. L102B) impose 6 ans ; on retient **10 ans** (le plafond contraignant) par prudence.
- Pendant cette durée, ces documents **échappent à l'effacement** (la rétention légale prime sur le droit à l'effacement RGPD) ; après expiration → purge/anonymisation.
- **Portée réelle aujourd'hui = nulle** : aucun enregistrement fiscal n'embarque de PII client (vérifié ci-dessus) et les reçus n'impriment pas le nom client (D9) ⇒ le carve-out ne **mord** que si/quand des **factures nominatives** (ex. B2B) sont générées. Donc : anonymisation client implémentable **sans attendre** la confirmation comptable ; le carve-out factures est à câbler **seulement** le jour où on génère des factures nominatives.

**⚠️ À confirmer comptable** : durée exacte (10 ans retenu) + liste des documents sous obligation de conservation nominative.

## Ce qu'il faut de l'owner
Trancher (1)–(4) — surtout la **liste des champs effaçables vs conservés** et la règle « pas de PII client dans un document fiscal immuable ». Une fois la politique fixée, l'implémentation est petite, additive et testable, et **ne touche pas la chaîne fiscale** (confirmé : pas de PII dans les ventes).
