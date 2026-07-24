# Logo officiel The Wesley sur le ticket de caisse — diagnostic & correctif

> Correctif 2026-07-24 — branche `fix/ticket-logo-prod`.
> Symptôme terrain : le logo sort parfois (diagnostic / « une fois »), puis les
> vrais tickets de fin de vente ressortent SANS logo.

## Les deux chemins d'impression (comparaison demandée)

| Élément | Chemin | Peut porter le logo ? |
|---|---|---|
| **Corps du ticket** (texte + logo), diagnostic **ET** vente réelle | `peripheralBridge.printTicket` → `printThermalUSB` → IPC `pos-print:printHtml` → `main/posPrinting.ts` : HTML chargé dans une fenêtre **`data:text/html`** puis `webContents.print()` → **driver Windows / futurePRNT** (rasterisation) | **Oui**, mais UNIQUEMENT si le logo est une **data-URL** dans le HTML |
| **Tiroir-caisse + coupe papier** | IPC `pos-print:openDrawer` / `:cut` / `:rawEscpos` → `main/posRawPrint.ts` (winspool RAW) + `main/escpos.ts` | **N/A** — `escpos.ts` ne contient QUE `drawerKick`/`cut`, **aucune** commande raster logo |

**Conclusion : le RAW-vs-pilote n'est PAS la cause.** Le corps du ticket (diagnostic
comme vente) passe toujours par le **driver Windows**. Le RAW ne sert qu'au tiroir/coupe.
Le ticket de diagnostic ne porte d'ailleurs **jamais** de logo (il ne passe aucun
`logoDataUrl` — c'est un simple test d'imprimante). Seule la vente réelle doit porter
le logo, via `resolveReceiptLogo(...)`.

## Cause exacte

La fenêtre d'impression `data:text/html` est **isolée** : seule une image
`data:image/(png|jpeg);base64,...` s'y affiche. Une URL relative, `app://…` ou
`https://…` n'y résout pas (origine `data:`, ou pas encore chargée au moment du
`print()`). Le rendu du logo dans `peripheralBridge.buildReceiptDOM` applique donc,
à raison, un filtre : `if (/^data:image\/(png|jpe?g);base64,/.test(logoDataUrl))`.

Deux failles rendaient ce `logoDataUrl` **absent ou non conforme** en production :

1. **Repli embarqué par `fetch()` runtime.** `brandLogo.ts` récupérait le logo par
   `fetch()` d'un asset haché (`assets/wesleys-logo-official-*.png`, 52 Ko, émis en
   fichier séparé car > limite d'inline Vite), préchargé en async. En build packagé
   (protocole `app://`), si ce préchargement n'aboutissait pas, `getBrandLogoDataUrl()`
   renvoyait `null` → ticket sans logo, **silencieusement**. Fragile par conception :
   une chaîne d'impression ne doit pas dépendre d'un fetch async « censé » avoir fini.
2. **Repli court-circuité par une config non conforme.** Les callers faisaient
   `storeInfo.receiptLogoUrl || getBrandLogoDataUrl()`. Si `receiptLogoUrl` était une
   valeur **non imprimable** (URL `https://`, data-URL SVG, chaîne quelconque), elle
   était *truthy* → utilisée → **rejetée** par le regex du rendu → pas de logo, ET le
   repli embarqué était sauté.

## Correctif (racine, pas cosmétique)

- **Logo embarqué en CONSTANTE data-URL** (`assets/wesleyReceiptLogo.ts`) : dérivé du
  logo **officiel** (`wesleys-logo-official.png`, jamais recréé) — niveaux de gris,
  320 px, ~18 Ko. C'est une chaîne du code → présente dans le **bundle JS** et donc dans
  le **build Windows**, disponible **synchronement**, sans Vite `?inline` (non honoré en
  5.4), sans fetch, sans `app://`. `getBrandLogoDataUrl()` la renvoie directement.
- **Repli validé** : `resolveReceiptLogo(configuredLogo)` n'utilise `receiptLogoUrl` que
  si c'est une data-URL imprimable, sinon retombe sur l'embarqué. Un logo magasin mal
  configuré ne produit **plus jamais** « pas de logo ». Les 3 callers (vente encaissée,
  duplicata historique, POSPage) passent par ce repli.
- Rendu **inchangé** : `.logo { display:block; margin:0 auto; max-width:46mm;
  max-height:18mm; filter:grayscale(100%) contrast(160%) }` → centré, dimensionné.
- **Zéro** ligne touchée dans `escpos.ts` / `posRawPrint.ts` / la logique tiroir →
  aucun risque de tiroir déclenché en boucle.

## Régénérer le logo (si le logo officiel change)

```bash
cd packages/pos-desktop/src/renderer/assets
# 1) remplacer wesleys-logo-official.png par le nouveau logo OFFICIEL
# 2) version ticket : niveaux de gris, 320 px de large
sips -Z 320 wesleys-logo-official.png --out /tmp/wl.png
sips --matchTo '/System/Library/ColorSync/Profiles/Generic Gray Profile.icc' /tmp/wl.png --out /tmp/wl-gray.png
# 3) régénérer la constante
python3 - <<'PY'
import base64
b = base64.b64encode(open('/tmp/wl-gray.png','rb').read()).decode()
open('wesleyReceiptLogo.ts','w').write(
 "export const WESLEY_RECEIPT_LOGO_DATA_URL =\n  'data:image/png;base64,%s';\n" % b)
PY
```

## Validation matérielle (obligatoire — sur la caisse Windows réelle)

Non reproductible sur Mac/CI. Depuis une version **réellement installée** (pas le mode dev) :
1. 3 ventes réelles consécutives → le logo officiel, centré et net, sort sur les 3 tickets.
2. Redémarrage complet de la caisse → une 4ᵉ vente → le logo ressort.
3. Vérifier que le tiroir s'ouvre bien UNE fois par vente (pas de boucle).
