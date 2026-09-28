import { test, expect, type Page } from '@playwright/test';
import { loginAndGoToDashboard } from '../helpers';

/**
 * Story V15.5 — edit / save / reset the Dockerfile and use your own image.
 * No real Docker build: only the stored override + image flag are exercised.
 */
const API = 'http://localhost:8000/api/v1';

async function headers(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('access_token') || '');
  return { Authorization: `Bearer ${token}` };
}

test.describe('Environments — custom Dockerfile & image', () => {
  const name = `e2e-custom-docker-${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await loginAndGoToDashboard(page);
    // "system" mode: no venv to create, nothing is installed.
    const resp = await page.request.post(`${API}/environments`, {
      headers: await headers(page),
      data: { name, venv_mode: 'system' },
    });
    expect(resp.ok()).toBeTruthy();
  });

  test.afterEach(async ({ page }) => {
    const h = await headers(page);
    const envs = await (await page.request.get(`${API}/environments`, { headers: h })).json();
    for (const env of envs.filter((e: { name: string }) => e.name === name)) {
      await page.request.delete(`${API}/environments/${env.id}`, { headers: h });
    }
  });

  test('edits, saves and resets the Dockerfile; sets a custom image', async ({ page }) => {
    await page.goto('/environments');
    const card = page.locator('.card', { hasText: name });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.locator('.card-header').click();

    // Dockerfile: empty editor (no packages yet) → type → save → badge.
    await card.getByTestId('dockerfile-details').locator('summary').click();
    const editor = card.getByTestId('dockerfile-editor');
    await expect(editor).toBeVisible();
    await editor.fill('FROM python:3.12-slim\nRUN pip install robotframework\n');
    await card.getByTestId('dockerfile-save').click();
    await expect(card.getByTestId('docker-custom-dockerfile-badge')).toBeVisible();

    // Reload: the saved Dockerfile is what the editor shows.
    await page.reload();
    await card.locator('.card-header').click();
    await card.getByTestId('dockerfile-details').locator('summary').click();
    await expect(card.getByTestId('dockerfile-editor')).toHaveValue(/RUN pip install robotframework/);

    // Reset → badge gone.
    await card.getByTestId('dockerfile-reset').click();
    await expect(card.getByTestId('docker-custom-dockerfile-badge')).toHaveCount(0);

    // Own image → "custom image" badge, then back to managed.
    await card.getByTestId('docker-own-image-input').fill('myorg/rf-image:1.0');
    await card.getByTestId('docker-own-image-form').getByRole('button').click();
    await expect(card.getByTestId('docker-custom-image-badge')).toBeVisible();
    await expect(card.locator('.docker-tag')).toHaveText('myorg/rf-image:1.0');

    await card.getByTestId('docker-managed-image').click();
    await expect(card.getByTestId('docker-custom-image-badge')).toHaveCount(0);
  });
});
