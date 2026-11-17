import { expect, test } from '@playwright/test';
import { anonymousPage, createProject, editorText, setLinkAccess, signedInPage, waitForSaved } from './fixtures';

test('two people edit the same project live', async ({ browser }) => {
  const alice = await signedInPage(browser, 'alice');
  const id = await createProject(alice, 'TS library');
  await waitForSaved(alice);
  await setLinkAccess(alice, 'editor');

  // Jess opens the link as a fresh visitor and joins as a guest.
  const jess = await anonymousPage(browser);
  await jess.goto(`/p/${id}`);
  await jess.getByLabel('Your name').fill('Jess');
  await jess.getByRole('button', { name: 'Join as guest' }).click();
  await waitForSaved(jess);
  await jess.getByRole('treeitem', { name: 'index.ts' }).click();
  await expect(editorText(jess)).toContainText('export');

  // Alice types at the top of src/index.ts.
  await alice.getByRole('treeitem', { name: 'index.ts' }).click();
  await alice.locator('.monaco-editor .view-lines').click();
  await alice.keyboard.press('ControlOrMeta+Home');
  await alice.keyboard.type('// hello');
  await alice.keyboard.press('Escape');
  await alice.keyboard.press('Enter');

  await expect(editorText(jess)).toContainText(/\/\/\s+hello/);
  // Alice's caret shows up in Jess's editor with her name on the flag.
  const head = jess.locator('[class*="yRemoteSelectionHead-"]').first();
  await expect(head).toBeAttached();
  await expect
    .poll(() => head.evaluate((el) => getComputedStyle(el, '::after').content))
    .toBe('"alice"');

  // Jess creates a file; it appears in Alice's explorer.
  await jess.getByRole('button', { name: 'New file' }).click();
  await jess.getByRole('dialog').getByLabel('Name').fill('src/new.ts');
  await jess.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(alice.getByRole('treeitem', { name: 'new.ts' })).toBeVisible();
});
