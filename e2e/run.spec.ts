import { expect, test } from '@playwright/test';
import { createProject, signedInPage, waitForSaved } from './fixtures';

// Boots a real WebContainer and installs packages from npm, so it needs internet access.
test.describe('@webcontainer', () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(240_000);

  test('test a TS library and preview a React app', async ({ browser }) => {
    const alice = await signedInPage(browser, 'alice');
    await createProject(alice, 'TS library');
    await waitForSaved(alice);
    // The terminal tab Run/Test output goes to is selected automatically; only it is visible.
    const terminal = alice.locator('.term-view').filter({ visible: true }).locator('.xterm-rows');

    await expect(alice.getByText('Installing dependencies…')).toBeVisible();
    await expect(alice.getByText('Installing dependencies…')).toBeHidden({ timeout: 180_000 });
    await alice.getByRole('button', { name: '✓ Test' }).click();
    await expect(terminal).toContainText('passed', { timeout: 120_000 });

    await createProject(alice, 'React app');
    await waitForSaved(alice);
    await expect(alice.getByText('Installing dependencies…')).toBeHidden({ timeout: 180_000 });
    await alice.getByRole('button', { name: '▶ Run' }).click();
    await expect(alice.getByRole('complementary', { name: 'Preview' })).toBeVisible({ timeout: 120_000 });
  });
});
