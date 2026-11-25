import { expect, test } from '@playwright/test';

test('home page renders the tagline', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByText('Every match. Every stat. One database.')
  ).toBeVisible();
});
