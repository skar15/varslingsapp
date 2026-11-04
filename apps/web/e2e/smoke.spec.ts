import { expect, test } from '@playwright/test';

test('root redirects to Norwegian and shows the plans from the API', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/nb$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Værvarsel for det du eier');
  await expect(page.getByTestId('plan-familie')).toContainText('Opptil 5 brukere');
  await expect(page.getByTestId('plan-familie').getByRole('button')).toBeEnabled();
  // No prices are hard-coded; the price is shown in Stripe Checkout.
  await expect(page.getByText('Pris vises i kassen.')).toBeVisible();
  await expect(page.getByText(/kr\b|NOK/)).toHaveCount(0);
});

test('English version and language switch', async ({ page }) => {
  await page.goto('/nb');
  await page.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Weather warnings for what you own');
});

test('links without locale (SMS and email) resolve', async ({ page }) => {
  await page.goto('/invite/abc');
  await expect(page).toHaveURL(/\/nb\/invite\/abc$/);
});

test('sign-in page has no prices or buy buttons and points to the website', async ({ page }) => {
  await page.goto('/nb/login');
  await expect(page.getByRole('heading', { name: 'Logg inn' })).toBeVisible();
  await expect(page.getByText('Kontoer opprettes på nettsiden.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Velg/ })).toHaveCount(0);
});

test('the dashboard requires sign-in', async ({ page }) => {
  await page.goto('/nb/dashboard');
  await expect(page).toHaveURL(/\/nb\/login$/);
});

test('an invalid registration link is reported', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/nb/register/this-token-does-not-exist-123');
  await expect(page.getByText('Lenken er ugyldig eller utløpt.')).toBeVisible({ timeout: 40_000 });
});
