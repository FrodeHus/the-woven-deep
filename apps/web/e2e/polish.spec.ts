import { expect, test, type Page } from '@playwright/test';

/**
 * The 5D-2 exit demonstration: the whole GUEST-EXPERIENCE POLISH layer, proven end to end in a
 * real chromium against the real server and content pack, by keyboard. This is the milestone's
 * exit gate -- the polish counterpart to 5A's `guest-play`, 5B's `run-lifecycle`, 5C's
 * `town-loop`, and 5D-1's `interface`:
 *
 *   boot with onboarding ON -> the movement hint leads (priority 0) -> walk ten town steps and it
 *   retires, the inspection hint taking its place -> dismiss that one by hand (the dismiss key) and
 *   it stays gone, the inventory hint stepping up -> open settings, turn onboarding off, the strip
 *   vanishes -> switch the theme to high contrast (the root class lands and the palette recomputes)
 *   -> descend, the fade-through-dark playing then clearing itself away -> clear the guest session
 *   and land on a fresh title, with every guest storage key -- the onboarding mastery ledger among
 *   them -- wiped.
 *
 * WHY THE WIZARD, NOT `?quickstart=1` (as the other four specs use): quickstart deliberately FORCES
 * onboarding off no matter the stored setting (`App.tsx`: `settings.onboarding === 'on' &&
 * !quickstart`), precisely so it can never perturb those four pinned walks. The onboarding beats
 * here therefore need a NON-quickstart boot, so this spec builds a hero through the chargen wizard
 * (the minimal path `run-lifecycle` already exercises) and lands in the town with onboarding live.
 * Town geometry is authored and seed-independent (see `interface.spec.ts`'s town facts); the seed
 * is carried only for parity with the other specs and to pin the wizard's attribute roll.
 *
 * WHY THE SEEDED SETTINGS BLOB: `page.addInitScript` writes `woven-deep.settings.v1` before the app
 * boots, pinning two fields this spec depends on -- `onboarding: 'on'` (explicit, not merely the
 * default) and `reducedMotion: 'off'`, which guarantees the descend fade element actually renders
 * regardless of the host/CI `prefers-reduced-motion` setting (under reduced motion `ScreenFade`
 * mounts NO element at all -- an instant swap -- so the fade beat could not otherwise be observed).
 */
const SEED_QUERY = '/play?seed=11.22.33.44';

/** Ten successful town moves that begin and end on the spawn cell (5,9), oscillating only across
 * row 9 columns 5-9 -- all open floor (`interface.spec.ts` walks (4,9)->(9,9) there). Ten applied
 * `move` intents is exactly the movement hint's mastery threshold (`onboarding.ts`'s `HINTS`). */
const TEN_TOWN_STEPS = ['6', '6', '6', '6', '4', '4', '4', '4', '6', '4'];

/** See the sibling specs: the first keydown after load can race the key listener attaching, so
 * prove the keyboard is live with a no-op `g` (rejected client-side, engine state untouched). */
async function awaitKeyboardReady(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('g');
    await expect(page.getByRole('log', { name: /adventure log/i }))
      .toContainText(/nothing here to pick up/i, { timeout: 250 });
  }).toPass();
}

async function pressAll(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** Builds a hero through the minimal chargen wizard path and enters play -- the same lean
 * run-through `run-lifecycle.spec.ts`'s "New Hero" leg uses, lifted here so this spec can reach
 * town play WITHOUT quickstart (the only boot under which onboarding is allowed to show). */
async function buildHeroAndEnterTown(page: Page): Promise<void> {
  await page.getByRole('option', { name: 'Enter the Deep' }).click();

  await expect(page.getByLabel(/Step 1 of 7/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Name' }).fill('Ember');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByLabel(/Step 2 of 7/)).toBeVisible();
  await page.getByRole('option', { name: /Roll/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByLabel(/Step 3 of 7/)).toBeVisible();
  await page.getByRole('button', { name: 'Roll attributes' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByLabel(/Step 4 of 7/)).toBeVisible();
  await page.getByRole('option', { name: /Wayfarer/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByLabel(/Step 5 of 7/)).toBeVisible();
  await page.getByRole('option').first().click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByLabel(/Step 6 of 7/)).toBeVisible();
  await page.getByRole('option', { name: 'Caravan guard' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByLabel(/Step 7 of 7/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Status' })).toContainText('Town');
}

test('the guest polish: onboarding, theme, the descend fade, and a clean reset', async ({ page }) => {
  // Seed the settings blob BEFORE boot: onboarding on (explicit) and motion forced full so the
  // descend fade element is guaranteed to render (see the file header).
  await page.addInitScript(() => {
    window.localStorage.setItem('woven-deep.settings.v1', JSON.stringify({
      fontScale: 1, reducedMotion: 'off', theme: 'tapestry', onboarding: 'on', bindings: {},
    }));
  });

  await page.goto(SEED_QUERY);
  await buildHeroAndEnterTown(page);
  await expect(page.getByLabel('Hero at 5, 9')).toBeVisible();
  await awaitKeyboardReady(page);

  // --- The onboarding sequence leads with movement (priority 0), triggered in town. ---
  const strip = page.locator('.hint-strip');
  await expect(strip).toContainText(/The dark waits on your step/i);

  // Ten successful town steps master movement; the hint retires and inspection (priority 1) takes
  // over. The walk returns to the spawn cell, keeping the later descend origin exact.
  await pressAll(page, TEN_TOWN_STEPS);
  await expect(page.getByLabel('Hero at 5, 9')).toBeVisible();
  await expect(strip).not.toContainText(/The dark waits on your step/i);
  await expect(strip).toContainText(/read your own measure/i);

  // Dismiss the inspection hint by hand (the rebindable `dismiss-hint` key, default `'`). It stays
  // gone, and the inventory hint (priority 2) steps up in its place.
  await page.keyboard.press("'");
  await expect(strip).not.toContainText(/read your own measure/i);
  await expect(strip).toContainText(/see what you carry/i);

  // --- Settings: everything below is asserted against the play screen, which stays mounted behind
  // the overlay (the overlay host lives inside `PlayScreen`), so the canvas/strip/theme changes are
  // observable live without closing the overlay between each. The overlay's own content (font
  // scale/theme/onboarding/motion/every rebindable key row/clear-session) is taller than the
  // pinned 1440x900 viewport and the dialog itself never scrolls (`DialogContent` has no
  // `max-h`/`overflow-y`), so several of its controls are otherwise unreachable; briefly growing
  // the viewport is the only way to interact with them without touching component source. ---
  await page.setViewportSize({ width: 1440, height: 2200 });
  await page.keyboard.press('o');
  const settings = page.getByTestId('overlay-settings');
  await expect(settings).toBeVisible();

  // Turn onboarding off -> the strip vanishes entirely (HintStrip renders nothing).
  const onboardingToggle = settings.getByRole('switch', { name: /show contextual guidance/i });
  await expect(onboardingToggle).toBeChecked();
  await onboardingToggle.click();
  await expect(onboardingToggle).not.toBeChecked();
  await expect(strip).toHaveCount(0);

  // Theme: high contrast lands the root class and recomputes the palette (a computed-style spot
  // check on `--ink`, which the `.theme-high-contrast` block redeclares to pure white).
  await settings.getByRole('combobox', { name: 'Theme' }).click();
  await page.getByRole('option', { name: /High contrast/ }).click();
  await expect(page.locator('.guest-app-root')).toHaveClass(/theme-high-contrast/);
  await expect(async () => {
    const ink = await page.evaluate(() => getComputedStyle(
      document.querySelector('.guest-app-root')!,
    ).getPropertyValue('--ink').trim());
    expect(ink).toBe('#ffffff');
  }).toPass();

  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });

  // --- Descend: step onto the town stair-down (6,10) and go down. The floor change plays the
  // fade-through-dark, which mounts, then tears itself away. The appearance is caught by arming the
  // wait BEFORE the keystroke (the fade is short and self-clearing); its duration is never timed. ---
  await expect(page.getByLabel('Hero at 5, 9')).toBeVisible();
  await page.keyboard.press('3'); // south-east: (5,9) -> (6,10), onto the stair
  await expect(page.getByLabel('Hero at 6, 10')).toBeVisible();

  const fadeAppeared = page.waitForSelector('.screen-fade', { state: 'attached', timeout: 3000 });
  await page.keyboard.press('>');
  await fadeAppeared; // the fade element mounted -> the transition is playing
  await expect(page.locator('.screen-fade')).toHaveCount(0); // and it clears itself away
  await expect(page.getByRole('group', { name: 'Status' })).toContainText('Depth 1');

  // --- Clear the guest session from settings; the app lands on a fresh title screen and every
  // guest storage key is wiped -- including the onboarding mastery ledger this run wrote to. ---
  await page.setViewportSize({ width: 1440, height: 2200 });
  await page.keyboard.press('o');
  await expect(settings).toBeVisible();
  await settings.locator('#settings-clear-confirm').fill('clear');
  await settings.getByRole('button', { name: 'Clear guest session' }).click();

  await expect(page.getByRole('listbox', { name: 'Title menu' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Enter the Deep' })).toBeVisible();
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeHidden();

  // Prove the wipe itself: every key named by `clear-guest-session.ts` (its
  // GUEST_SESSION_STORAGE_KEYS in sessionStorage, GUEST_LOCAL_STORAGE_KEYS in localStorage,
  // the latter now carrying `woven-deep.onboarding.v1` alongside the settings blob).
  await expect(async () => {
    const remaining = await page.evaluate(() => ({
      session: [
        'woven-deep.guest-run',
        'woven-deep.guest-command-seq',
        'woven-deep.guest-hall',
        'woven-deep.guest-portrait',
        'woven-deep.guest-codex',
      ].filter((key) => sessionStorage.getItem(key) !== null),
      local: [
        'woven-deep.settings.v1',
        'woven-deep.onboarding.v1',
      ].filter((key) => localStorage.getItem(key) !== null),
    }));
    expect(remaining.session).toEqual([]);
    expect(remaining.local).toEqual([]);
  }).toPass();
});
