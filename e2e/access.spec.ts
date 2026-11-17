import { expect, test } from '@playwright/test';
import { createProject, editorText, guestPage, setLinkAccess, signedInPage, waitForSaved } from './fixtures';

test('link roles and revocation are enforced live', async ({ browser }) => {
  const alice = await signedInPage(browser, 'alice');
  const id = await createProject(alice, 'TS library');
  await waitForSaved(alice);
  await setLinkAccess(alice, 'viewer');

  const jess = await guestPage(browser, 'Jess');
  await jess.goto(`/p/${id}`);
  await waitForSaved(jess);
  await expect(jess.getByText('You have view access. Changes from the terminal stay in your browser.')).toBeVisible();
  await jess.getByRole('treeitem', { name: 'index.ts' }).click();
  await expect(editorText(jess)).toContainText('export');
  const before = await editorText(jess).innerText();
  await jess.locator('.monaco-editor .view-lines').click();
  await jess.keyboard.type('x');
  await expect(jess.locator('.toast')).toHaveText('You have view access');
  expect(await editorText(jess).innerText()).toBe(before);

  // Alice restricts the link: Jess loses access on the spot.
  await setLinkAccess(alice, 'restricted');
  await expect(jess.getByText('You no longer have access')).toBeVisible();

  // Someone new with the link is turned away.
  const sam = await guestPage(browser, 'Sam');
  await sam.goto(`/p/${id}`);
  await expect(sam.getByRole('heading', { name: 'You need access' })).toBeVisible();
});
