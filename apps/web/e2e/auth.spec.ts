import { expect, test } from '@playwright/test';

/**
 * The 6A exit demonstration: the full email magic-link sign-in loop and settings roaming, proven end
 * to end in a real chromium against the real server. The playwright webServer boots the server with
 * no Mailgun configuration (PUBLIC_URL is a localhost value), so the dev-echo mail transport is
 * active and `GET /api/dev/last-login-link` hands back the link the server would have emailed.
 *
 *   title -> "Sign in with email" -> submit a unique email -> the uniform confirmation ->
 *   fetch the magic link from the dev-echo endpoint -> open it (the server sets the session cookie
 *   and redirects to `/?auth=ok`) -> boot the app signed in (the title shows the email) ->
 *   flip the theme to high contrast (it roams to the server) -> open a FRESH browser context that
 *   carries only the session cookie (empty localStorage) and confirm the high-contrast theme arrived
 *   from the server, not this device -> sign out -> the title returns to the guest menu.
 *
 * Hermeticity: the e2e sqlite persists across runs and the dev-echo endpoint is keyed by normalized
 * email, so each run uses a fresh address to isolate itself. Specs are not the deterministic engine,
 * so a wall-clock-derived email is fine here.
 */
test('sign in by magic link, roam a setting to a fresh device, and sign out', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const email = `e2e-${Date.now()}@example.test`;

  // --- Title -> sign-in screen -> submit the email -> the uniform confirmation. ---
  await page.goto('/play');
  await page.getByRole('option', { name: 'Sign in with email' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in with email' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await expect(page.getByRole('status')).toContainText(/link is on its way/i);

  // --- Retrieve the magic link from the dev-echo endpoint (no Mailgun configured in e2e). ---
  const linkResponse = await request.get(`/api/dev/last-login-link?email=${encodeURIComponent(email)}`);
  expect(linkResponse.ok()).toBeTruthy();
  const { link } = (await linkResponse.json()) as { link: string };
  expect(link).toContain('/api/auth/verify?token=');

  // --- Follow the link: the server sets the session cookie and 303-redirects to `/?auth=ok`.
  // Booting the app at /play then picks up the fresh session and the title shows the email. ---
  await page.goto(link);
  await page.goto('/play');
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

  // --- Change a setting (theme -> high contrast) and let it roam to the server. The signed-in
  // client's debounced PUT carries the change; we wait for it before reading it back elsewhere. ---
  // The settings overlay's content (font scale/theme/onboarding/motion/every rebindable key row/
  // clear-session) is taller than the pinned 1440x900 viewport and the dialog itself never scrolls
  // (`DialogContent` has no `max-h`/`overflow-y`), so the Theme control -- centered well above the
  // fold at 900px -- is otherwise unreachable; briefly growing the viewport is the only way to
  // interact with it without touching component source.
  await page.setViewportSize({ width: 1440, height: 2200 });
  await page.getByRole('option', { name: 'Settings' }).click();
  const settings = page.getByTestId('overlay-settings');
  await expect(settings).toBeVisible();
  const settingsPush = page.waitForResponse(
    (res) =>
      res.url().endsWith('/api/profile/settings') && res.request().method() === 'PUT' && res.ok(),
  );
  await settings.getByRole('combobox', { name: 'Theme' }).click();
  await page.getByRole('option', { name: /High contrast/ }).click();
  await expect(page.locator('.guest-app-root')).toHaveClass(/theme-high-contrast/);
  await settingsPush;
  await page.setViewportSize({ width: 1440, height: 900 });

  // --- A fresh browser context carrying ONLY the session cookie (empty localStorage) proves the
  // high-contrast theme roamed from the server: a fresh device has no local settings to read it
  // from, so high contrast here can only have come from the profile the server returned. ---
  const cookies = await page.context().cookies();
  const freshContext = await browser.newContext({ baseURL: baseURL ?? undefined });
  await freshContext.addCookies(cookies);
  const freshPage = await freshContext.newPage();
  try {
    await freshPage.goto('/play');
    await expect(freshPage.getByText(`Signed in as ${email}`)).toBeVisible();
    await expect(freshPage.locator('.guest-app-root')).toHaveClass(/theme-high-contrast/);

    // --- Sign out on the fresh device: the title returns to the guest menu. ---
    await freshPage.getByRole('option', { name: 'Sign out' }).click();
    await expect(freshPage.getByText(`Signed in as ${email}`)).toBeHidden();
    await expect(freshPage.getByRole('option', { name: 'Sign in with email' })).toBeVisible();
  } finally {
    await freshContext.close();
  }
});
