import { expect, test, type Page } from '@playwright/test';

/**
 * The 5A exit demonstration: a guest plays the real game — real server, real content pack,
 * real chromium — by keyboard alone.
 *
 * The seed and every key below are pinned test data, reviewed like the engine demos' hashes.
 * Derivation: a throwaway node script drove the built engine exactly like `GuestSession.dispatch`
 * (`createNewRun({ pack, seed: [11, 22, 33, 44], hero: DEFAULT_GUEST_HERO })`, then
 * `resolveCommand`/`descendToNextFloor` per keypress, path-planned over the floor's true tiles)
 * and printed the resulting key sequence. Engine determinism (same seed + same command sequence
 * = same states) makes the replay exact.
 *
 * Seed hunt notes: on floor depth-001 this seed spawns two hostile cave rats at (32,3)/(33,3),
 * hero at (57,18) on the stair-up, stair-down at (23,19) — all mutually reachable. A 40-seed
 * sweep confirmed NO seed places ground items on floor 1 (monsters carry no loot tables, and
 * `createNewRun` only creates the hero's own items), so the "walk onto an item and press g"
 * requirement is met by dropping one of the hero's three travel rations (a real ground item),
 * stepping off it, stepping back onto it, and picking it up.
 */
// The landing page now owns `/`; the guest game lives behind the `/play` path (see
// `src/main.tsx`'s path check). The seed override still parses out of the query string exactly
// as before (see `App.tsx`'s `parseSeedFromQuery`).
const SEED_QUERY = '/play?seed=11.22.33.44';

/** Keys 1–40: walk from the stair-up to the cave rats and bump-attack until one dies. */
const KILL_PHASE = [
  '6', '6', '9', '7', '4', '4', '4', '4', '7', '7', '7', '8', '8', '8', '8', '8', '8', '8',
  '8', '8', '7', '4', '4', '7', '7', '4', '4', '4', '4', '1', '2', '2', '2', '1', '4', '4',
  '4', '4', '7', '7',
];

/** Keys 51–106: walk from the kill site to the stair-down at (23,19). */
const STAIR_PHASE = [
  '3', '2', '2', '2', '3', '3', '3', '2', '1', '1', '1', '1', '1', '4', '1', '2', '2', '2',
  '1', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4',
  '4', '4', '4', '4', '4', '7', '9', '9', '6', '3', '6', '6', '6', '6', '6', '9', '9', '6',
  '6', '6',
];

async function pressAll(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/**
 * The very first keydown after load can race the key listener attaching. Pressing `g` with
 * nothing underfoot is rejected client-side ("There is nothing here to pick up.") WITHOUT
 * touching engine state, so it proves the keyboard is live without desyncing the pinned walk.
 */
async function awaitKeyboardReady(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('g');
    await expect(page.getByRole('log', { name: /adventure log/i }))
      .toContainText(/nothing here to pick up/i, { timeout: 250 });
  }).toPass();
}

/** Opens the backpack with `i` and waits until its focus trap owns the keyboard, so the
 * following menu keys can never race the dialog's mount. */
async function openBackpack(page: Page): Promise<void> {
  await page.keyboard.press('i');
  const dialog = page.getByRole('dialog', { name: 'Backpack' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('button').first()).toBeFocused();
}

async function closeBackpack(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Backpack' })).toBeHidden();
}

test('a guest plays, persists, and descends by keyboard alone', async ({ page }) => {
  await page.goto(SEED_QUERY);
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();
  const log = page.getByRole('log', { name: /adventure log/i });
  await awaitKeyboardReady(page);

  // Bump-attack a cave rat until it dies.
  await pressAll(page, KILL_PHASE);
  await expect(log).toContainText(/dies/i);

  // Drop a travel ration (creating a real ground item), step off and back onto it, pick it up.
  await openBackpack(page);
  await page.keyboard.press('d');
  await closeBackpack(page);
  await pressAll(page, ['8', '2']);
  await page.keyboard.press('g');
  await expect(log).toContainText(/you pick up an item/i);

  // Consume a travel ration through the backpack menu.
  await openBackpack(page);
  await page.keyboard.press('u');
  await closeBackpack(page);
  await expect(log).toContainText(/you consume an item/i);

  // Rest (completes or is interrupted — either way the engine reports why it stopped).
  await page.keyboard.press('Shift+R');
  await expect(log).toContainText(/stop resting/i);

  // Walk to the stair-down and descend.
  await pressAll(page, STAIR_PHASE);
  await page.keyboard.press('>');
  await expect(page.getByText(/depth 2/i)).toBeVisible();
});

test('a mid-run reload restores the run and a cleared session starts fresh', async ({ page }) => {
  await page.goto(SEED_QUERY);
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();

  // Wait at least one turn (pressing again if the very first keydown raced the listener
  // attaching); every applied command persists the run to sessionStorage.
  await expect(async () => {
    await page.keyboard.press('.');
    await expect(page.getByTestId('turn-count')).not.toHaveText(/turn 0/i, { timeout: 250 });
  }).toPass();
  const turnBefore = await page.getByTestId('turn-count').textContent();

  await page.reload();
  await expect(page.getByTestId('turn-count')).toHaveText(turnBefore!); // restored, not reset
  await expect(page.getByText(/your run was restored/i)).toBeVisible();

  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId('turn-count')).toHaveText(/turn 0/i); // fresh
  await expect(page.getByText(/a new run has begun/i)).toBeVisible();
});

test('every interactive surface is reachable by keyboard', async ({ page }) => {
  await page.goto(SEED_QUERY);
  const grid = page.getByRole('grid', { name: /dungeon/i });
  await expect(grid).toBeVisible();

  // The session banner's Dismiss button is first in tab order; dismiss it by keyboard.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Dismiss' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: /new run/i })).toBeHidden();

  // Tab reaches the dungeon grid.
  await page.keyboard.press('Tab');
  await expect(grid).toBeFocused();

  // `i` opens the backpack as a focus-trapped dialog: focus lands inside...
  await page.keyboard.press('i');
  const dialog = page.getByRole('dialog', { name: 'Backpack' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('button').first()).toBeFocused();

  // ...and Tab cannot escape it (a single focusable wraps onto itself).
  await page.keyboard.press('Tab');
  await expect(dialog.locator('button').first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator('button').first()).toBeFocused();

  // Escape closes the dialog and restores focus to the grid.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(grid).toBeFocused();
});

test('the compact tier swaps the threat panel for a drawer and offers the hover popover', async ({ page }) => {
  await page.goto(SEED_QUERY);
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();
  await awaitKeyboardReady(page);

  // Play up to the kill so a hostile is on screen: after these 40 keys the surviving cave rat
  // sits at world cell (35,4) beside the hero at (36,5) — pinned by the same derivation run.
  await pressAll(page, KILL_PHASE);
  await expect(page.getByRole('log', { name: /adventure log/i })).toContainText(/dies/i);

  // At the pinned 1440x900 viewport the layout sits in the full tier: threat panel present,
  // no drawer.
  await expect(page.locator('.triptych')).toHaveAttribute('data-tier', 'full');
  await expect(page.locator('.threat-drawer')).toHaveCount(0);

  // Resize into the compact tier mid-run: the threat panel collapses into its drawer while
  // the grid stays put.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator('.triptych')).toHaveAttribute('data-tier', 'compact');
  const drawer = page.locator('details.threat-drawer');
  await expect(drawer).toBeVisible();
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();

  // The drawer stays keyboard-reachable: its summary takes focus and Enter toggles it open,
  // with the visible rat listed inside. (The drawer's grid track is deliberately squeezed to
  // zero width at this tier — see styles.css — so these are reachability assertions, not
  // pixel-visibility ones, which Playwright would fail on any zero-width element.)
  await drawer.locator('summary').focus();
  await expect(drawer.locator('summary')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(drawer).toHaveJSProperty('open', true);
  await expect(drawer.getByText(/cave rat/i)).toBeAttached();

  // Hovering the rat's cell raises the threat popover card.
  await page.locator('[data-cell="35,4"]').hover();
  const popover = page.getByRole('tooltip');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText(/cave rat/i);
});
