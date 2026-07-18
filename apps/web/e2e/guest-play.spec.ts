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
 * Town start (5C): quickstart now boots into the authored town (depth 0), so every walk gains a
 * one-step descend prefix — the hero spawns at (5,9), the dungeon entrance / stair-down is (6,10)
 * (a single southeast step, `3`), then `>` drops to depth 1 (160x50, hero on the stair-up at
 * (38,23)). The two dungeon walks below are re-derived against that floor (the old 80x25 depth-1
 * pins are gone). `KILL` chases the lone monster that intercepts the hero and kills it at (27,10),
 * leaving a calm spot for the item-management beats. `CLUSTER_KILL` marches into the far monster
 * room and kills one of the packed group, leaving a live cave rat adjacent at (9,2) (hero at
 * (10,2)) for the threat-panel/death walks. No seed places ground items on a dungeon floor, so the
 * "walk onto an item and press g" beat drops one of the hero's travel rations and picks it back up.
 */
// The landing page now owns `/`; the guest game lives behind the `/play` path (see
// `src/main.tsx`'s path check). The seed override still parses out of the query string exactly
// as before (see `App.tsx`'s `parseSeedFromQuery`). `?quickstart=1` is the test-only escape hatch
// that skips the title screen and chargen wizard (added alongside `ScreenState`) and boots
// straight into play with `DEFAULT_GUEST_HERO`.
const SEED_QUERY = '/play?quickstart=1&seed=11.22.33.44';

/** Town spawn (5,9) -> dungeon entrance / stair-down (6,10): one southeast step, then `>`. */
const DESCEND_PREFIX = ['3'];

/** Depth 1: chase the intercepting monster and bump-attack until it dies at (27,10) (hero (28,10),
 * no hostiles left nearby — a calm spot for the drop/pickup/consume/rest beats). */
const KILL = [
  '4', '7', '8', '8', '8', '8', '8', '8', '8', '7', '7', '7', '8', '8', '8', '8', '8', '8', '8',
  '8', '8', '8', '7', '4', '1', '2', '2', '2', '2', '2', '2', '2', '1', '4', '4',
];

/** Depth 1: march into the far monster room and kill one of the packed group, leaving a live cave
 * rat adjacent at (9,2) with the hero at (10,2). */
const CLUSTER_KILL = [
  '4', '7', '8', '8', '8', '8', '8', '8', '8', '7', '7', '7', '8', '8', '8', '8', '8', '8', '8',
  '8', '8', '8', '7', '4', '4', '1', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4',
  '4', '4', '4', '4', '4', '4', '4',
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
 * following menu keys can never race the dialog's mount -- the overlay's mount effect moves focus
 * onto its own listbox (see `InventoryOverlay`'s `useEffect`), not onto any particular button. */
async function openBackpack(page: Page): Promise<void> {
  await page.keyboard.press('i');
  const dialog = page.getByRole('dialog', { name: 'Backpack' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('listbox')).toBeFocused();
}

async function closeBackpack(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Backpack' })).toBeHidden();
}

test('a guest plays, persists, and descends by keyboard alone', async ({ page }) => {
  await page.goto(SEED_QUERY);
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Status' })).toContainText('Town');
  const log = page.getByRole('log', { name: /adventure log/i });
  await awaitKeyboardReady(page);

  // Descend from town into the dungeon.
  await pressAll(page, DESCEND_PREFIX);
  await page.keyboard.press('>');
  await expect(page.getByRole('group', { name: 'Status' })).toContainText('Depth 1');

  // Bump-attack a monster until it dies.
  await pressAll(page, KILL);
  await expect(log).toContainText(/dies/i);

  // Drop a travel ration (creating a real ground item), step off and back onto it, pick it up.
  await openBackpack(page);
  await page.keyboard.press('d');
  await closeBackpack(page);
  await pressAll(page, ['4', '6']);
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

  // `i` opens the backpack as a focus-trapped dialog: its mount effect moves focus onto the
  // backpack's own listbox (see `InventoryOverlay`)...
  await page.keyboard.press('i');
  const dialog = page.getByRole('dialog', { name: 'Backpack' });
  await expect(dialog).toBeVisible();
  const listbox = dialog.getByRole('listbox');
  await expect(listbox).toBeFocused();

  // ...and Tab cannot escape the dialog: it wraps within its focusables (the toolbar's filter/sort
  // buttons, the listbox itself, the detail pane's action buttons, and the close button).
  const focusables = dialog.locator('button, [role="listbox"]');
  const firstFocusable = focusables.first();
  const lastFocusable = focusables.last();
  await lastFocusable.focus();
  await page.keyboard.press('Tab');
  await expect(firstFocusable).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(lastFocusable).toBeFocused();

  // Escape closes the dialog and restores focus to the grid.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(grid).toBeFocused();
});

// Layout A's right rail (hero/vitals, minimap, threat/town) is a fixed CSS grid that never
// reflows by viewport size (see `PlayScreen`'s own doc comment) -- the pre-redesign responsive
// tier/drawer-collapse this test used to cover (`.triptych`'s `data-tier` and `.threat-drawer`) no
// longer exists, so those assertions are removed rather than translated; the surviving intent is
// "the threat panel lists a nearby hostile, reachable regardless of viewport size, and hovering
// its cell raises the popover".
test('the right rail lists a nearby threat and offers the hover popover', async ({ page }) => {
  await page.goto(SEED_QUERY);
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();
  await awaitKeyboardReady(page);

  // Descend, then march into the monster room and kill one of the packed group: a surviving cave
  // rat is left at world cell (9,2) beside the hero at (10,2) — pinned by the derivation run.
  await pressAll(page, DESCEND_PREFIX);
  await page.keyboard.press('>');
  await expect(page.getByRole('group', { name: 'Status' })).toContainText('Depth 1');
  await pressAll(page, CLUSTER_KILL);
  await expect(page.getByRole('log', { name: /adventure log/i })).toContainText(/dies/i);

  const threatPanel = page.getByRole('region', { name: 'Threats' });
  await expect(threatPanel).toBeVisible();
  await expect(threatPanel).toContainText(/cave rat/i);

  // Resizing the viewport never collapses the right rail or hides the grid -- Layout A's
  // composition is fixed.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();
  await expect(threatPanel).toContainText(/cave rat/i);

  // Hovering the rat's cell raises the threat popover card.
  await page.locator('[data-cell="9,2"]').hover();
  const popover = page.getByRole('tooltip');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText(/cave rat/i);
});
