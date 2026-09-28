/**
 * Flow Editor — %{ENV} environment-variable awareness (Story FE-ENV).
 * A suite using %{HOME=/tmp} shows the node indicator and a read-only summary
 * in the Variables panel; the reference survives a flow→code round-trip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndGoToDashboard } from '../helpers';

const API = 'http://localhost:8000/api/v1';
const EMAIL = 'admin@roboscope.local';
const PASSWORD = 'admin123';

const SEED_ROBOT = `*** Test Cases ***
Env Test
    Log    %{HOME=/tmp}
    Log    plain value

Second Test
    Log    trivial second case
`;

async function getAuthToken(page: Page): Promise<string> {
  const res = await page.request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  return (await res.json()).access_token as string;
}

async function createSeedRepo(page: Page, token: string): Promise<number> {
  const repoName = `flow-env-e2e-${Date.now()}`;
  const localPath = `/tmp/roboscope-flow-env-${Date.now()}`;
  const res = await page.request.post(`${API}/repos`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: repoName, repo_type: 'local', local_path: localPath },
  });
  expect(res.status()).toBe(201);
  const repoId = (await res.json()).id as number;
  await page.request.post(`${API}/explorer/${repoId}/file`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { path: 'tests/env.robot', content: SEED_ROBOT },
  });
  return repoId;
}

async function openFlow(page: Page, repoId: number) {
  await page.goto(`/explorer/${repoId}`);
  await expect(page.locator('h1', { hasText: 'Explorer' })).toBeVisible({ timeout: 10_000 });
  const testsFolder = page.locator('text=/^tests$/').first();
  await expect(testsFolder).toBeVisible({ timeout: 10_000 });
  const fileRow = page.locator('text=env.robot').first();
  if (!(await fileRow.isVisible().catch(() => false))) await testsFolder.click();
  await expect(fileRow).toBeVisible({ timeout: 8_000 });
  await fileRow.click();
  const flowTab = page.locator('button', { hasText: /^Flow$/ }).first();
  await expect(flowTab).toBeVisible({ timeout: 8_000 });
  await flowTab.click();
  await expect(page.locator('.vue-flow__node[data-id$="-start"]').first()).toBeVisible({ timeout: 8_000 });
}

test.describe('Flow Editor — %{ENV} awareness', () => {
  let token: string;
  let repoId: number;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newPage();
    token = await getAuthToken(ctx);
    repoId = await createSeedRepo(ctx, token);
    await ctx.close();
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newPage();
    const t = await getAuthToken(ctx);
    await ctx.request.delete(`${API}/repos/${repoId}`, { headers: { Authorization: `Bearer ${t}` } });
    await ctx.close();
  });

  test.beforeEach(async ({ page }) => {
    await loginAndGoToDashboard(page);
  });

  test('shows the env-var indicator + Variables-panel summary', async ({ page }) => {
    await openFlow(page, repoId);

    // Exactly one step uses %{} → one node badge.
    await expect(page.getByTestId('env-badge')).toHaveCount(1);

    // Variables panel lists the env ref with its default.
    await page.getByTestId('flow-variables-toggle').click();
    const envSection = page.getByTestId('flow-env-vars');
    await expect(envSection).toBeVisible();
    await expect(envSection.getByTestId('flow-env-var')).toContainText('%{HOME=/tmp}');
  });
});

// Story V15.2 — refs are checked against the repo's environment KEYS.
const CHECK_ROBOT = `*** Test Cases ***
Uses Env
    Log    %{BASE_URL}
    Log    %{MISSING_VAR}

Second Test
    Log    trivial second case
`;

test.describe('Flow Editor — %{ENV} definition check (V15.2)', () => {
  let token: string;
  let repoId: number;
  let envId: number;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newPage();
    token = await getAuthToken(ctx);
    const auth = { Authorization: `Bearer ${token}` };
    const envRes = await ctx.request.post(`${API}/environments`, {
      headers: auth, data: { name: `env-check-${Date.now()}`, python_version: '3.12' },
    });
    envId = (await envRes.json()).id;
    const varRes = await ctx.request.post(`${API}/environments/${envId}/variables`, {
      headers: auth, data: { key: 'BASE_URL', value: 'https://staging', is_secret: false },
    });
    expect(varRes.status()).toBe(201);
    const repoRes = await ctx.request.post(`${API}/repos`, {
      headers: auth,
      data: {
        name: `flow-env-check-${Date.now()}`,
        repo_type: 'local',
        local_path: `/tmp/roboscope-flow-env-check-${Date.now()}`,
        environment_id: envId,
      },
    });
    repoId = (await repoRes.json()).id;
    await ctx.request.post(`${API}/explorer/${repoId}/file`, {
      headers: auth, data: { path: 'tests/env.robot', content: CHECK_ROBOT },
    });
    await ctx.close();
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newPage();
    const auth = { Authorization: `Bearer ${await getAuthToken(ctx)}` };
    await ctx.request.delete(`${API}/repos/${repoId}`, { headers: auth });
    await ctx.request.delete(`${API}/environments/${envId}`, { headers: auth });
    await ctx.close();
  });

  test.beforeEach(async ({ page }) => {
    await loginAndGoToDashboard(page);
  });

  test('flags the undefined ref, not the defined one', async ({ page }) => {
    await openFlow(page, repoId);
    await page.getByTestId('flow-variables-toggle').click();
    const chips = page.getByTestId('flow-env-vars').getByTestId('flow-env-var');
    await expect(chips.filter({ hasText: 'MISSING_VAR' })).toHaveAttribute('data-state', 'missing');
    await expect(chips.filter({ hasText: 'BASE_URL' })).toHaveAttribute('data-state', 'defined');
    await expect(page.locator('.flow-node-env-badge--missing')).toHaveCount(1);
  });
});
