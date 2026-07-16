import { expect, test, type Page } from '@playwright/test';

/**
 * The 5B exit demonstration: the full chargen -> play -> death -> conclusion -> Hall lifecycle,
 * proven in a real chromium against the real server and content pack, by keyboard.
 *
 * Two independent journeys share this file:
 *
 * 1. The seven-step chargen wizard (`/play?seed=...`, NO quickstart), driven the way a player would:
 *    a typed name, keyboard-navigated option lists, a point-buy allocation adjusted with the arrow
 *    keys, and a click on "Next" between steps (mirroring `chargen-screen.test.tsx`'s hybrid). The
 *    seed pins the wizard's attribute rolls but is irrelevant to the point-buy path this walk ends
 *    on. The chosen block sets Vitality to 12; with the retuned `maxHealth = { base: 10, vitality: 1 }`
 *    formula and no equipment/background/trait touching maxHealth (verified against the bundled
 *    content), the Lamplighter lands in play with 10 + 12 = 22 HP and the brass lantern in its
 *    off-hand — both asserted in the hero panel.
 *
 * 2. The death loop (`/play?quickstart=1&seed=11.22.33.44`, the same pinned seed + `DEFAULT_GUEST_HERO`
 *    as the 5A walk). Town start (5C): quickstart now boots into the town, so the walk gains a
 *    one-step descend prefix (`3` then `>`, spawn (5,9) -> dungeon entrance (6,10) -> depth 1). On
 *    the 160x50 depth-1 floor the hero then marches into the far monster room and bump-attacks until
 *    ONE of the packed group dies (`CLUSTER_KILL`), leaving a live cave rat adjacent at (9,2) with the
 *    hero at (10,2). From there the hero simply WAITS (`.`): each wait passes the turn to the adjacent
 *    hostiles, which attack with no retaliation, and the hero dies (a cave rat lands the blow — 36
 *    waits for this pinned seed, engine-deterministic). That count is deliberately NOT hardcoded — we
 *    poll the conclusion screen with an immediate `isVisible()` under a generous cap — because a pinned
 *    wait-count would be brittle test data with no reader value, unlike the movement walk it builds on.
 */
const WIZARD_SEED_QUERY = '/play?seed=11.22.33.44';
const QUICKSTART_QUERY = '/play?quickstart=1&seed=11.22.33.44';

/** Town spawn (5,9) -> dungeon entrance / stair-down (6,10): one southeast step, then `>`. */
const DESCEND_PREFIX = ['3'];

/** Depth 1: march into the far monster room and kill one of the packed group, leaving a live cave
 * rat adjacent at (9,2) with the hero at (10,2) (see `guest-play.spec.ts`'s derivation notes). */
const CLUSTER_KILL = [
  '4', '7', '8', '8', '8', '8', '8', '8', '8', '7', '7', '7', '8', '8', '8', '8', '8', '8', '8',
  '8', '8', '8', '7', '4', '4', '1', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4',
  '4', '4', '4', '4', '4', '4', '4',
];

async function pressAll(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** See `guest-play.spec.ts`: the very first keydown after load can race the key listener
 * attaching, so prove the keyboard is live with a no-op `g` before the pinned walk. */
async function awaitKeyboardReady(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('g');
    await expect(page.getByRole('log', { name: /adventure log/i }))
      .toContainText(/nothing here to pick up/i, { timeout: 250 });
  }).toPass();
}

test('a guest builds a Lamplighter through the seven-step wizard and enters play', async ({ page }) => {
  await page.goto(WIZARD_SEED_QUERY);

  // Title -> Enter the Deep.
  await expect(page.getByRole('option', { name: 'Enter the Deep' })).toBeVisible();
  await page.getByRole('option', { name: 'Enter the Deep' }).click();

  // Step 1: name + portrait.
  await expect(page.getByLabel(/Step 1 of 7/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Name' }).fill('Testa');
  await page.locator('.chargen-portrait-list .chargen-portrait').nth(1).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 2: choose Roll first...
  await expect(page.getByLabel(/Step 2 of 7/)).toBeVisible();
  await page.getByRole('option', { name: /Roll/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 3 (roll): roll, then use the one-shot reroll.
  await expect(page.getByLabel(/Step 3 of 7/)).toBeVisible();
  await page.getByRole('button', { name: 'Roll attributes' }).click();
  await page.getByRole('button', { name: 'Reroll' }).click();
  await expect(page.getByRole('button', { name: 'Reroll used' })).toBeVisible();

  // ...then switch the method to point buy and allocate a legal block by keyboard.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel(/Step 2 of 7/)).toBeVisible();
  await page.getByRole('option', { name: 'Point buy' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByLabel(/Step 3 of 7/)).toBeVisible();
  await expect(page.getByText(/Points spent: 0\/30/)).toBeVisible();
  // Attribute order is [might, agility, vitality, wits, resolve]; the first row auto-focuses, so
  // ArrowDown x2 selects Vitality, then ArrowRight x12 raises it to 12 (cost 14 of the 30 budget).
  await page.locator('.chargen-attribute-row').first().focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByText(/Max health: 22/)).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 4: Lamplighter.
  await expect(page.getByLabel(/Step 4 of 7/)).toBeVisible();
  await page.getByRole('option', { name: /Lamplighter/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 5: the lantern kit.
  await expect(page.getByLabel(/Step 5 of 7/)).toBeVisible();
  await page.getByRole('option', { name: 'Lantern' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 6: deep-miner background + two traits.
  await expect(page.getByLabel(/Step 6 of 7/)).toBeVisible();
  await page.getByRole('option', { name: 'Deep miner' }).click();
  await page.getByRole('option', { name: 'Keen-eyed' }).click();
  await page.getByRole('option', { name: 'Sure-footed' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 7: confirm and enter play.
  await expect(page.getByLabel(/Step 7 of 7/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();

  // The Lamplighter's loadout is live in the hero panel: brass lantern equipped, 22 HP derived
  // from the allocated Vitality.
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();
  const heroPanel = page.getByRole('region', { name: 'Hero' });
  await expect(heroPanel).toContainText(/off-hand: Brass lantern/i);
  await expect(heroPanel).toContainText('22/22 HP');
});

test('a death finalizes into the Hall and the conclusion closes the loop', async ({ page }) => {
  await page.goto(QUICKSTART_QUERY);
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();
  await awaitKeyboardReady(page);

  // Descend from town, march into the monster room and kill one of the group, then wait beside the
  // survivors until they kill the wounded hero.
  await pressAll(page, DESCEND_PREFIX);
  await page.keyboard.press('>');
  await expect(page.locator('.status-depth')).toHaveText('Depth 1');
  await pressAll(page, CLUSTER_KILL);
  await expect(page.getByRole('log', { name: /adventure log/i })).toContainText(/dies/i);

  // The armoured hero shrugs off most of the survivor's swings, so death takes many waits (85 for
  // this pinned seed). We poll with an immediate `isVisible()` rather than a per-iteration timeout
  // so the loop stays fast; the cap is a generous guard, not pinned test data.
  const fallen = page.getByRole('heading', { name: /you have fallen/i });
  let concluded = false;
  for (let i = 0; i < 200 && !concluded; i += 1) {
    await page.keyboard.press('.');
    concluded = await fallen.isVisible();
  }
  await expect(fallen).toBeVisible();

  // Conclusion: the rat is named as the killer, the itemized score is present, and the run is
  // marked unverified/session-only (its finalization into the Hall already ran automatically).
  await expect(page.getByText(/Slain by Cave rat/i)).toBeVisible();
  const scoreTable = page.getByRole('table', { name: 'Score' });
  await expect(scoreTable).toBeVisible();
  await expect(scoreTable.getByText('Total')).toBeVisible();
  await expect(scoreTable.locator('tbody tr').first()).toBeVisible();
  await expect(page.getByRole('note')).toContainText(/unverified/i);

  // View the Hall: the just-finalized run is the first record, tagged "Run #1".
  await page.getByRole('option', { name: 'Hall of Records' }).click();
  await expect(page.getByRole('heading', { name: 'Hall of Records' })).toBeVisible();
  const record = page.getByRole('listbox', { name: 'Hall records' }).getByRole('option');
  await expect(record).toBeVisible();
  await expect(record).toContainText('Run #1');

  // Back to the conclusion, then start a new hero — which lands back at chargen step 1.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: /you have fallen/i })).toBeVisible();
  await page.getByRole('option', { name: 'New Hero' }).click();
  await expect(page.getByLabel(/Step 1 of 7/)).toBeVisible();

  // Regression: New Hero -> wizard -> Confirm must start the NEW hero fresh, not restore the
  // just-finalized dead run (whose non-null conclusion would otherwise bounce straight back to
  // this same conclusion screen forever). Complete a minimal wizard run-through and arrive in the
  // dungeon at Turn 0 with the new hero's name visible.
  await page.getByRole('textbox', { name: 'Name' }).fill('Nova');
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByRole('option', { name: /Roll/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByRole('button', { name: 'Roll attributes' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByRole('option', { name: /Wayfarer/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByRole('option').first().click();
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByRole('option', { name: 'Caravan guard' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByLabel(/Step 7 of 7/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /you have fallen/i })).not.toBeVisible();
  const heroPanel = page.getByRole('region', { name: 'Hero' });
  await expect(heroPanel).toContainText('Nova');
  await expect(page.getByTestId('turn-count')).toHaveText('Turn 0');
});
