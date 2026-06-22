# M302 — Effacement client : collision RGPD × NF525 (note de politique, lecture seule)

> Note de **politique** pour décision owner (RGPD × inaltérabilité fiscale). **Aucun code touché.**
> M302 n'est pas une tâche de build : il faut trancher la *politique* avant tout code, sinon
> le code heurte la chaîne fiscale. Réf dette : `TECHNICAL_DEBT.md` D13.

## Constat clé (vérifié) — la collision est PLUS ÉTROITE qu'attendu
- **Les enregistrements fiscaux ne contiennent PAS de PII client.** `sale.entity` référence le client par **`customer_id` seulement** (`@Index(['customerId'])`, colonne `customer_id`) ; aucun snapshot de nom/téléphone/email client (les snapshots existants sont *employé* : `employee_name_snapshot`...). Recherche `customerName/customer_name` dans les entités = **0**.
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

## Ce qu'il faut de l'owner
Trancher (1)–(4) — surtout la **liste des champs effaçables vs conservés** et la règle « pas de PII client dans un document fiscal immuable ». Une fois la politique fixée, l'implémentation est petite, additive et testable, et **ne touche pas la chaîne fiscale** (confirmé : pas de PII dans les ventes).
