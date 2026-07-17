import { expect, test, type Page } from '@playwright/test';

/**
 * The 5C exit demonstration: the full town loop, proven end to end in a real chromium against the
 * real server and content pack, by keyboard alone. This is the milestone's exit gate:
 *
 *   boot to town -> buy a ration from the provisioner -> store an item in the house -> descend ->
 *   kill a monster -> return to town and back down (the killed monster stays dead: the hero walks
 *   onto its very cell) -> sell surplus starting gear to the arms dealer -> buy the strongbox
 *   upgrade (house capacity 6 -> 10) -> withdraw the stored item -> descend once more.
 *
 * The seed and every key below are pinned test data, reviewed like the engine demos' hashes.
 * Derivation: a throwaway node script (`scripts/_derive.mjs`, not committed) drove the built engine
 * exactly like `GuestSession.dispatch` + `command-builder` (`createNewRun({ pack, seed:
 * [11,22,33,44], hero: DEFAULT_GUEST_HERO })`, path-planned over each floor's true tiles with the
 * engine's own `findPath`, trade/house/unequip via the real engine commands the screens issue) and
 * printed the resulting key sequences. Engine determinism (same seed + same command sequence =
 * byte-identical state) makes the browser replay exact.
 *
 * Town facts (seed-independent, authored): town is 34x16, hero spawns at (5,9); the dungeon
 * entrance / stair-down is (6,10); the house door is (27,13); the provisioner stall is (6,2), the
 * arms dealer (armorer) (16,2). Economy (authored, seed-independent): start 40g; a Travel ration
 * costs 7g; the armorer buys the iron sword for 9g and the leather armor for 10g; the strongbox
 * service costs 50g. So 40 - 7 (ration) = 33, + 9 + 10 (gear) = 52, - 50 (strongbox) = 2.
 *
 * Depth 1 for this seed is 160x50; the hero arrives on the stair-up at (38,23). The nearest hostile
 * cluster is in the far room around (6..9, 2..4); the KILL walk bump-attacks until a training beetle
 * dies at (27,10). The stored-floor proof re-descends and walks the hero back onto (27,10): only
 * reachable if that monster stays dead (a live monster would block the cell).
 */
const SEED_QUERY = '/play?quickstart=1&seed=11.22.33.44';

/** Depth-1 walks. */
const TO_STAIR = ['4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '7', '7', '7', '7'];
const KILL = ['4', '7', '8', '8', '8', '8', '8', '8', '8', '7', '7', '7', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '7', '4', '1', '2', '2', '2', '2', '2', '2', '2', '1', '4', '4'];
const TO_STAIR_UP = ['6', '9', '8', '8', '8', '8', '8', '8', '8', '9', '6', '3', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '3', '3', '3', '2', '3', '6'];
// After re-descending: walk the hero back onto the corpse cell (27,10), then to the stair-up (38,23).
const TO_CORPSE = ['4', '7', '8', '8', '8', '8', '8', '8', '8', '7', '7', '7', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '7', '4', '1', '2', '2', '2', '2', '2', '2', '2', '1', '4', '4'];
const TO_STAIR_UP_2 = ['6', '6', '9', '8', '8', '8', '8', '8', '8', '8', '9', '6', '3', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '3', '3', '3', '2', '3', '6'];
// Town walks.
const TO_PROVISIONER = ['8', '8', '8', '8', '8', '9'];
const TO_HOUSE = ['6', '6', '3', '6', '6', '6', '6', '3', '3', '3', '3', '3', '3', '3', '3', '3', '3', '6', '6', '6'];
const TO_ARMORER = ['6', '6', '9', '9', '9', '9', '9', '9', '9'];
const TO_PROVISIONER_2 = ['1', '4', '4', '4', '4', '4', '7', '7'];
const TO_HOUSE_2 = ['3', '3', '6', '6', '6', '6', '3', '3', '3', '3', '3', '3', '3', '3', '3', '3', '6', '6', '6'];
const TO_STAIR_2 = ['4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '7', '7', '7', '7'];

async function pressAll(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** The very first keydown after load can race the key listener attaching; a `g` with nothing
 * underfoot is rejected client-side without touching engine state, proving the keyboard is live. */
async function awaitKeyboardReady(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('g');
    await expect(page.getByRole('log', { name: /adventure log/i }))
      .toContainText(/nothing here to pick up/i, { timeout: 250 });
  }).toPass();
}

async function openDialog(page: Page, key: string, name: RegExp): Promise<void> {
  await page.keyboard.press(key);
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('button').first()).toBeFocused();
}

test('the town loop: buy, store, descend, kill, return, sell, upgrade, retrieve, descend', async ({ page }) => {
  await page.goto(SEED_QUERY);
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();

  // --- Boot to town: the status label reads "Town" and the provisioner is on the town panel. ---
  await expect(page.locator('.status-depth')).toHaveText('Town');
  await expect(page.getByRole('region', { name: 'Town' })).toContainText(/provisioner/i);
  await awaitKeyboardReady(page);

  // --- Buy a Travel ration from the provisioner: currency drops 40g -> 33g. ---
  await pressAll(page, TO_PROVISIONER);
  await openDialog(page, 'Shift+T', /trade/i);
  await expect(page.locator('.trade-currency')).toHaveText('40g');
  await page.keyboard.press('Enter'); // buy the first stock row (a Travel ration, 7g)
  await expect(page.locator('.trade-currency')).toHaveText('33g');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /trade/i })).toBeHidden();

  // --- Store a ration in the house: the capacity readout shows 1/6. ---
  await pressAll(page, TO_HOUSE);
  await openDialog(page, 'Shift+H', /house/i);
  await page.keyboard.press('Enter'); // deposit the selected backpack stack (a ration)
  await expect(page.locator('.house-capacity')).toHaveText('House (1/6)');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /house/i })).toBeHidden();

  // --- Descend to Depth 1. ---
  await pressAll(page, TO_STAIR);
  await page.keyboard.press('>');
  await expect(page.locator('.status-depth')).toHaveText('Depth 1');

  // --- Kill a monster. ---
  await pressAll(page, KILL);
  await expect(page.getByRole('log', { name: /adventure log/i })).toContainText(/dies/i);

  // --- Return to town, then back down to the SAME stored floor. ---
  await pressAll(page, TO_STAIR_UP);
  await page.keyboard.press('<');
  await expect(page.locator('.status-depth')).toHaveText('Town');
  await page.keyboard.press('>');
  await expect(page.locator('.status-depth')).toHaveText('Depth 1');

  // Dead stays dead: walk the hero back onto the killed monster's cell (27,10). It is only
  // reachable and standable because the corpse never respawned -- a regenerated floor would have a
  // live monster there. The hero glyph occupying the cell is the proof.
  await pressAll(page, TO_CORPSE);
  await expect(page.getByLabel('Hero at 27, 10')).toBeVisible();

  // Back up to town for the trade half of the loop.
  await pressAll(page, TO_STAIR_UP_2);
  await page.keyboard.press('<');
  await expect(page.locator('.status-depth')).toHaveText('Town');

  // --- Unequip the surplus starting gear (sword + armor) into the backpack so it can be sold. ---
  await openDialog(page, 'i', /backpack/i);
  await page.keyboard.press('ArrowDown'); // -> Iron sword (equipped)
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // -> Leather armor (equipped)
  await page.keyboard.press('e'); // unequip armor
  await page.keyboard.press('ArrowUp'); // -> Iron sword (equipped)
  await page.keyboard.press('e'); // unequip sword
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /backpack/i })).toBeHidden();

  // --- Sell both to the arms dealer: currency rises 33g -> 52g. ---
  await pressAll(page, TO_ARMORER);
  await openDialog(page, 'Shift+T', /trade/i);
  await expect(page.locator('.trade-currency')).toHaveText('33g');
  await page.keyboard.press('Tab'); // buy -> sell list
  await page.keyboard.press('Enter'); // sell the first sale offer
  // Wait for the sale to settle (the offer list re-renders) before selling the next.
  await expect(page.locator('.trade-currency')).not.toHaveText('33g');
  await page.keyboard.press('Enter'); // sell the remaining sale offer
  await expect(page.locator('.trade-currency')).toHaveText('52g');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /trade/i })).toBeHidden();

  // --- Buy the strongbox upgrade from the provisioner: currency 52g -> 2g. ---
  await pressAll(page, TO_PROVISIONER_2);
  await openDialog(page, 'Shift+T', /trade/i);
  await page.keyboard.press('Tab'); // buy -> sell
  await page.keyboard.press('Tab'); // sell -> services
  await page.keyboard.press('Enter'); // buy the strongbox service (50g)
  await expect(page.locator('.trade-currency')).toHaveText('2g');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /trade/i })).toBeHidden();

  // --- Retrieve the stored ration: the house readout now shows capacity 10 (6 -> 10). ---
  await pressAll(page, TO_HOUSE_2);
  await openDialog(page, 'Shift+H', /house/i);
  await expect(page.locator('.house-capacity')).toHaveText('House (1/10)');
  await page.keyboard.press('Tab'); // backpack -> house list
  await page.keyboard.press('Enter'); // withdraw the stored ration
  await expect(page.locator('.house-capacity')).toHaveText('House (0/10)');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /house/i })).toBeHidden();

  // --- Descend once more to close the loop. ---
  await pressAll(page, TO_STAIR_2);
  await page.keyboard.press('>');
  await expect(page.locator('.status-depth')).toHaveText('Depth 1');
});
