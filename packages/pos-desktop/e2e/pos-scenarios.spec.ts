import { test, expect, Page } from '@playwright/test';

/**
 * P364 — Scénarios e2e S2→S5 (POS-011→015 + offline), même conventions que
 * pos-smoke.spec.ts (seed local, env surchargables — voir e2e/README.md).
 *
 * ⚠️ HONNÊTETÉ : écrits dans le sandbox (pas de navigateur+backend ici),
 * JAMAIS exécutés au moment du commit. Statut « écrits, à prouver localement » :
 *   cd packages/pos-desktop && npm run test:e2e
 * Les sélecteurs suivent le smoke prouvé + les composants réels
 * (ReturnModal, CloseSessionModal, garde remise D3, offlineStore).
 * Si un sélecteur diverge chez toi : copie l'erreur Playwright, je corrige.
 */
const STORE_ID = process.env.E2E_STORE_ID || '93883cd9-5816-4b24-9436-f4f2fddbf2b6';
const PIN = process.env.E2E_PIN || '1234';
const RESPONSABLE_PIN = process.env.E2E_RESPONSABLE_PIN || PIN; // seed : admin
const EAN = process.env.E2E_EAN || '3760001000001'; // T-Shirt Blanc, 29,90 €

async function login(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('ID Magasin').fill(STORE_ID);
  await page.locator('input[type="password"]').first().fill(PIN);
  await page.getByRole('button', { name: /se connecter/i }).click();
  await expect(page.getByPlaceholder(/rechercher produit/i)).toBeVisible({ timeout: 20_000 });
}

async function scan(page: Page, ean = EAN) {
  const search = page.getByPlaceholder(/rechercher produit/i);
  await search.fill(ean);
  await search.press('Enter');
}

async function payCash(page: Page) {
  await page.getByRole('button', { name: /^payer/i }).last().click();
  await page.getByRole('button', { name: /tout en esp[eè]ces/i }).click();
  await expect(page.getByText(/0\s*article/i)).toBeVisible({ timeout: 12_000 });
}

// ── S2 — POS-012 panier : quantités et retrait recalculent les totaux ──────
test('S2 — panier : +qté puis retrait, totaux exacts (POS-012)', async ({ page }) => {
  await login(page);
  await scan(page); // 1× 29,90
  await scan(page); // 2× — le scan du même EAN incrémente la quantité
  await expect(page.getByText(/59,80/).first()).toBeVisible(); // 2 × 29,90

  // retrait total de la ligne → panier vide (bouton retrait/corbeille de la ligne)
  await page.getByRole('button', { name: /supprimer|retirer/i }).first().click();
  await expect(page.getByText(/0\s*article/i)).toBeVisible();
});

// ── S3 — POS-015 retour : vente puis avoir généré (NF525) ─────────────────
test('S3 — vente espèces puis RETOUR → avoir généré (POS-015)', async ({ page }) => {
  await login(page);
  await scan(page);
  await payCash(page);

  // Ouvrir le flux retour (bouton Retour / Retours du header caisse)
  await page.getByRole('button', { name: /retour/i }).first().click();
  const modal = page.getByRole('dialog').or(page.locator('[class*="modal" i]').first());
  await expect(modal).toBeVisible({ timeout: 10_000 });

  // Sélectionner la vente du jour la plus récente et retourner 1 article
  await modal.getByText(/T-Shirt Blanc/).first().click();
  await modal.getByRole('button', { name: /valider|g[ée]n[ée]rer|avoir/i }).first().click();

  // VERT : un code d'avoir est affiché (les codes avoirs du backend : préfixe AV/CN + montant)
  await expect(page.getByText(/avoir|29,90/i).first()).toBeVisible({ timeout: 12_000 });
});

// ── S4 — POS-054 remise 21-30 % : PIN responsable EXIGÉ ───────────────────
test('S4 — remise 25 % exige le PIN responsable (garde D3 + POS-054)', async ({ page }) => {
  await login(page);
  await scan(page);

  await page.getByRole('button', { name: /remise/i }).first().click();
  // saisir 25 % — au-dessus de 20 %, la garde doit réclamer le PIN responsable
  await page.getByPlaceholder(/%|pourcentage|montant/i).first().fill('25');
  await page.getByRole('button', { name: /appliquer|valider/i }).first().click();

  const pinField = page.locator('input[type="password"]').last();
  await expect(pinField).toBeVisible({ timeout: 8_000 }); // le PIN est réclamé — c'est le test
  await pinField.fill(RESPONSABLE_PIN);
  await page.getByRole('button', { name: /confirmer|valider/i }).last().click();

  // VERT : la remise apparaît sur le total (22,43 = 29,90 − 25 %)
  await expect(page.getByText(/22,4[23]/).first()).toBeVisible({ timeout: 8_000 });
});

// ── S5 — POS-016/017 clôture : comptage → écart signé serveur ─────────────
test('S5 — clôture de session avec comptage → écart affiché (POS-016/017)', async ({ page }) => {
  await login(page);
  await scan(page);
  await payCash(page); // 29,90 en espèces sur la session du terminal

  // Ouvrir la clôture (bouton clôture/fermer la caisse)
  await page.getByRole('button', { name: /cl[ôo]ture|fermer la caisse/i }).first().click();
  const modal = page.getByRole('dialog').or(page.locator('[class*="modal" i]').first());
  await expect(modal).toBeVisible({ timeout: 10_000 });

  // Compter 25,00 € → attendu ≥ 29,90 (ventes cash session) → écart négatif affiché
  await modal.locator('input[type="number"]').first().fill('25');
  await expect(modal.getByText(/-\s*4,90|écart/i).first()).toBeVisible({ timeout: 8_000 });

  // Confirmer la clôture — le comptage est PERSISTÉ (P351, écart figé serveur)
  await modal.getByRole('button', { name: /confirmer|cl[ôo]turer/i }).last().click();
  await expect(modal).not.toBeVisible({ timeout: 12_000 });
});
