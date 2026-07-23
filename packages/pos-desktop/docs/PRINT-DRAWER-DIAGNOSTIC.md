# Chaîne impression + tiroir — diagnostic & protocole terrain (Star TSP143 / futurePRNT)

> Contexte : latence anormale après validation, ticket incomplet/mal imprimé, tiroir
> muet, sur la caisse Windows équipée d'une Star TSP143 pilotée par futurePRNT.
> La vente elle-même est correcte — rien dans ce chantier ne touche sa logique.

## 1. Ce que fait la caisse (chaîne réelle, code)

```
Valider → salesApi.create (réseau, clé d'idempotence)
        → confirmation UI IMMÉDIATE (jamais bloquée par l'imprimante)
        → QR ticket numérique (local, rapide)
        → impression : HTML 80 mm → fenêtre cachée → webContents.print silencieux
                       → DRIVER Windows (futurePRNT) → spooler → imprimante
        → tiroir : APRÈS le résultat d'impression, une impulsion unique par vente
                   (garde persistée par saleId — jamais de rejeu automatique)
```

## 2. Cause racine identifiée (code) — à confirmer par le protocole §4

La série **Star TSP100/TSP143 (I, II, III — futurePRNT)** est une imprimante
**raster pilotée par l'hôte** : tout le rendu (texte, logo, coupe) est produit par
le driver Windows. Son firmware **n'interprète pas l'ESC/POS brut**.

Or le tiroir était piloté par un job **RAW ESC/POS `ESC p`** envoyé à la même
file d'impression :

- le kick est **ignoré ou mal interprété** → tiroir muet (symptôme 3) ;
- des octets bruts arrivant pendant/entre les jobs raster peuvent
  **désynchroniser le firmware** → coupe prématurée, contenu tronqué ou absent
  (symptôme 2) — cohérent avec l'incident historique « raster RAW → tiroir en
  boucle » ;
- chaque kick lançait un PowerShell + compilation C# (`Add-Type`) : **2 à 6 s**
  sur un mini-PC → contribution directe à la latence perçue (symptôme 1).

> La **TSP100IV / TSP143IV** est différente : StarPRNT natif + émulation ESC/POS
> sélectionnable — le kick RAW y est légitime. D'où la détection de mode.

## 3. Ce que change ce correctif

1. **Détection du mode réel** : lecture du driver Windows (`Get-Printer`) →
   classification (`star-raster` / `star-prnt-iv` / `escpos` / `unknown`),
   affichée dans **Diagnostic → Pilote & mode réel**.
2. **Plus jamais d'ESC/POS brut vers une file raster** (mode auto). Trois voies :
   - `raw` : kick `ESC p` (imprimantes ESC/POS, TSP143IV) ;
   - `queue` : job **driver** minuscule vers une **file Windows dédiée au tiroir**
     (voir §5) — c'est le driver Star qui pilote le tiroir, zéro octet brut ;
   - `refuse` : échec **honnête et expliqué** si aucune voie sûre n'est configurée.
3. **Traces horodatées** de toute la chaîne (clic → réponse vente → QR →
   spooler → résultat impression → tiroir), persistées, visibles dans
   **Diagnostic → Dernière chaîne de vente**, avec durée de chaque étape.
   Journal tiroir : vente, caisse, employé, heure, voie, résultat.
4. **Reprise tiroir sous contrôle manager** (droit `canOpenDrawer`) après échec :
   une impulsion par clic, journalisée — jamais de boucle.
5. Règles inchangées et garanties par les gardes existantes : CB → pas de
   tiroir ; réimpression → pas de tiroir ; échec d'impression → vente conservée ;
   double-clic → une seule vente/un seul ticket/une seule impulsion.

## 4. Protocole terrain (sur la caisse, ~15 min)

> Prérequis : POS à jour (release incluant ce correctif), Diagnostic ouvert
> (`Imprimante & tiroir-caisse`).

| # | Test | Attendu | Où lire la preuve |
|---|------|---------|-------------------|
| 0 | Diagnostic → **Pilote & mode réel** | Driver exact affiché (noter le nom !) ; mode `star-raster` attendu pour TSP143 futurePRNT | carte Pilote & mode |
| 1 | **Impression test** (sans vente) | ticket complet, coupe après la dernière ligne | papier + carte Tests |
| 2 | **Ouvrir le tiroir** (sans vente, sans ticket) | UNE impulsion ; si refus → message expliquant la config §5 | carte Tests (voie + ms) |
| 3 | Vente **espèces 1 article** | confirmation immédiate ; ticket complet ; tiroir 1× | overlay + Dernière chaîne (durées) |
| 4 | Vente **espèces panier long** (10+ lignes) | idem, ticket long complet | idem |
| 5 | Vente **carte** | ticket imprimé, **tiroir fermé** | overlay (aucune ligne tiroir) |
| 6 | **Réimpression** (historique) | DUPLICATA imprimé, **tiroir fermé** | papier |
| 7 | **Imprimante éteinte** + vente espèces | vente validée, « Ticket NON imprimé » affiché, bouton manager « Rouvrir le tiroir » | overlay |
| 8 | **Redémarrer l'app** puis re-test 3 | identique ; pas de double impulsion pour l'ancienne vente | overlay + traces |

Relever pour chaque vente la table **Dernière chaîne de vente** (T+ / Δ étape) :
c'est la mesure avant/après demandée. Les mêmes données sortent en console
(`[PRINT-TRACE]`, `[PRINT-TIMING]`, `[RAW-TIMING]`, `[DRAWER-QUEUE-TIMING]`).

## 5. Configuration Windows de la « file tiroir » (une fois, 5 min)

Pour TSP100/TSP143 futurePRNT (mode `star-raster`) :

1. Panneau de configuration → Périphériques et imprimantes → **Ajouter une
   imprimante** → utiliser le **même port USB** que la TSP143 existante, avec le
   **même driver Star TSP100** → nommer la file `Star TSP143 (Tiroir)`.
2. Sur CETTE nouvelle file uniquement : **Préférences d'impression** (driver Star)
   → *Peripheral Unit* → **Cash Drawer**, déclenchement **Document Top**
   (« ouverture en début de document »).
   (Sur la file TICKET d'origine, laisser le tiroir **désactivé** — sinon il
   s'ouvrirait à chaque impression, y compris CB.)
3. Dans le POS → Diagnostic → **Ouverture du tiroir** → renseigner le nom exact
   de la file (`Star TSP143 (Tiroir)`), stratégie **Automatique**.
4. Tester : bouton **Ouvrir le tiroir** → une impulsion, sans papier (le job est
   un espace vide : rien d'imprimable).

Si l'imprimante s'avère être une **TSP143IV configurée en ESC/POS** : aucune file
dédiée nécessaire, la voie `raw` est choisie automatiquement.

## 6. Limites connues / risques

- La **latence driver** (rasterisation futurePRNT, spooler) est mesurée mais pas
  contournable côté app : si `spoolMs` reste élevé après correctif, la piste est
  la config futurePRNT (résolution, « print speed », logo Logos&Cropping trop
  lourd) — réglable dans l'utilitaire futurePRNT, hors app.
- Le job « file tiroir » dépend de la config Windows §5 : si la file est mal
  configurée, l'impulsion n'a pas lieu — le POS l'indique honnêtement (résultat
  du job) mais ne peut pas vérifier physiquement l'ouverture.
- Le logo reste injecté par futurePRNT (« Logos & Cropping ») : méthode conservée,
  aucun raster RAW réintroduit.
