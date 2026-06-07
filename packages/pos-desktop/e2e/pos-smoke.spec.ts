import { test, expect } from '@playwright/test';

/**
 * Smoke réaliste du parcours caisse CRITIQUE (chemin de l'argent) :
 *   login → scan produit → panier/total → paiement espèces → panier vidé.
 *
 * Non décoratif : on assert des montants et l'état du panier réels renvoyés par
 * le backend local (données seed). Voir e2e/README.md pour les prérequis.
 *
 * Les identifiants viennent du seed local et sont surchargables par env pour
 * un autre jeu de données / CI.
 */
const STORE_ID = process.env.E2E_STORE_ID || '93883cd9-5816-4b24-9436-f4f2fddbf2b6';
const PIN = process.env.E2E_PIN || '1234';
const EAN = process.env.E2E_EAN || '3760001000001'; // T-Shirt Blanc, 29,90 €

test('login → scan → paiement espèces (parcours critique)', async ({ page }) => {
  await page.goto('/');

  // ── Login PIN ──
  await page.getByPlaceholder('ID Magasin').fill(STORE_ID);
  await page.locator('input[type="password"]').first().fill(PIN);
  await page.getByRole('button', { name: /se connecter/i }).click();

  // ── Page caisse chargée ──
  const search = page.getByPlaceholder(/rechercher produit/i);
  await expect(search).toBeVisible({ timeout: 20_000 });

  // ── Scan produit par code-barre ──
  await search.fill(EAN);
  await search.press('Enter');

  // ── Le produit et le total apparaissent ──
  await expect(page.getByText('T-Shirt Blanc')).toBeVisible();
  await expect(page.getByText(/29,90/).first()).toBeVisible();

  // ── Paiement espèces ──
  await page.getByRole('button', { name: /^payer/i }).last().click();
  await page.getByRole('button', { name: /tout en esp[eè]ces/i }).click();

  // ── Vente finalisée : panier vidé ──
  await expect(page.getByText(/0\s*article/i)).toBeVisible({ timeout: 12_000 });
});
