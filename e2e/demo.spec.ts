import { expect, test } from '@playwright/test';

const HERO = 'Google Docs for coding: open a project, share a link, edit and run it together';

test('a guest can try the demo and comes back to the same copy', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: HERO })).toBeVisible();

  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.getByLabel('Your name').fill('Sam');
  await page.getByRole('button', { name: 'Join as guest' }).click();
  await page.waitForURL(/\/p\/[A-Za-z0-9_-]+$/);
  const first = new URL(page.url()).pathname;
  await expect(page.getByText("This is your demo copy. It's deleted after 24 hours of inactivity.")).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.waitForURL(/\/p\/[A-Za-z0-9_-]+$/);
  expect(new URL(page.url()).pathname).toBe(first);
});
