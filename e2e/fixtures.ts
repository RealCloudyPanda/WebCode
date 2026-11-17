import { expect, type Browser, type Page } from '@playwright/test';

export const BASE_URL = `http://localhost:${process.env.E2E_PORT ?? 8090}`;

/** A new browser context signed in as the GitHub-less test user `login` (POST /auth/test-login). */
export async function signedInPage(browser: Browser, login: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const res = await context.request.post('/auth/test-login', { data: { login }, headers: { Origin: BASE_URL } });
  expect(res.status(), 'test login').toBe(204);
  return page;
}

/** A new browser context that has already joined as the guest `name`. */
export async function guestPage(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const res = await context.request.post('/api/guest', { data: { name }, headers: { Origin: BASE_URL } });
  expect(res.ok(), 'guest join').toBe(true);
  return page;
}

/** A fresh, unidentified browser context. */
export async function anonymousPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/** Creates a project from `template` through the home page and returns its id. */
export async function createProject(page: Page, templateLabel: RegExp | string): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: templateLabel }).click();
  await page.waitForURL(/\/p\/[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname.split('/').pop()!;
}

export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

/** Visible text of the open Monaco editor (non-breaking spaces normalised). */
export function editorText(page: Page) {
  return page.locator('.monaco-editor .view-lines');
}

/** Opens the share dialog and sets general access; `role` is ignored for Restricted. */
export async function setLinkAccess(page: Page, access: 'restricted' | 'viewer' | 'editor'): Promise<void> {
  await page.getByRole('button', { name: /^Share/ }).click();
  const dialog = page.getByRole('dialog');
  const patched = () => page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/api/projects/'));
  if (access === 'restricted') {
    await Promise.all([patched(), dialog.getByLabel('General access').selectOption('restricted')]);
  } else {
    const general = dialog.getByLabel('General access');
    if ((await general.inputValue()) !== 'anyone') await Promise.all([patched(), general.selectOption('anyone')]);
    const role = dialog.getByLabel('Link role');
    if ((await role.inputValue()) !== access) await Promise.all([patched(), role.selectOption(access)]);
  }
  await dialog.getByRole('button', { name: 'Done' }).click();
}
