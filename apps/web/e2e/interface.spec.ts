import { expect, test, type Page } from '@playwright/test';

/**
 * The 5D-1 exit demonstration: the whole guest INTERFACE, proven end to end in a real chromium
 * against the real server and content pack, by keyboard alone. This is the milestone's exit gate,
 * the interface counterpart to 5A's `guest-play`, 5B's `run-lifecycle`, and 5C's `town-loop`:
 *
 *   boot to town -> open and close every registry overlay by key (character sheet / map & journal /
 *   codex / settings / help / inventory) -> rebind Move west to `q` in settings and walk with it ->
 *   set font scale 130% and complete a walk under the enlarged camera -> read the codex in town
 *   (starting gear + the hero's class discovered, every monster still a silhouette) -> descend,
 *   land the first kill, ascend, and watch the killed monster's name appear in the codex ->
 *   buy an unidentified potion from the curios dealer and identify it through the inline picker ->
 *   clear the guest session from settings and land back on a fresh title screen.
 *
 * The seed and every key below are pinned test data, reviewed like the engine demos' hashes.
 * Derivation: the town/dungeon walks were replayed against the real built engine (the same engine
 * `town-loop`/`guest-play` pin, byte-for-byte deterministic on seed [11,22,33,44]) by driving the
 * live app and reading the hero's own aria label after each step; the KILL and TO_STAIR_UP dungeon
 * walks are lifted verbatim from `town-loop.spec.ts` (identical descend origin, so identical floor).
 * Engine determinism (same seed + same command sequence = byte-identical state) makes the replay
 * exact.
 *
 * Town facts (seed-independent, authored, cross-checked in `content/vaults/town.yaml`): town is
 * 34x16, hero spawns at (5,9); the dungeon entrance / stair-down is (6,10); the three merchant
 * stalls sit along the top wall -- provisioner at (6,2), arms dealer at (16,2), CURIOS DEALER at
 * (25,2), reachable by standing directly south of it at (25,3). Depth 1 for this seed is 160x50;
 * the hero arrives on the stair-up at (38,23); the KILL walk bump-attacks until a Training beetle
 * dies at (27,10) (hero ends at (28,10)); ascending returns the hero to the town stair cell (6,10).
 *
 * SPEC-REALITY NOTES (why this spec's assertions differ from the task brief's prose):
 *  - The shipped codex has four categories -- classes, items, spells, monsters -- and NO NPC/merchant
 *    category (see `codex.ts`'s `deriveCodexState`). A town merchant such as the provisioner is an
 *    `npc`-kind actor, never a `monster`-kind content entry, so it can never surface as a codex
 *    entry. The faithful "something met in town is already discovered" beat is therefore asserted
 *    against what the codex genuinely shows in town: the hero's own class (Wayfarer) and the starting
 *    gear it carries (Iron sword, Leather armor) are discovered, while every monster stays a
 *    silhouette until one is actually perceived below.
 *  - The hero starts with no unidentified items, so this spec BUYS the curios dealer's unidentified
 *    potion first (its stock's base band is a single crimson potion, which projects under an
 *    unidentified appearance name until identified) and then identifies that. The seed is unchanged
 *    from the other three specs -- seed [11,22,33,44]'s own curios stock already offers the
 *    unidentified potion, so no per-spec seed override was needed.
 */
const SEED_QUERY = '/play?quickstart=1&seed=11.22.33.44';

/** Depth 1: chase the intercepting monster and bump-attack until a Training beetle dies at (27,10).
 * Lifted verbatim from `town-loop`/`guest-play` -- same descend origin, same deterministic floor. */
const KILL = ['4', '7', '8', '8', '8', '8', '8', '8', '8', '7', '7', '7', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '7', '4', '1', '2', '2', '2', '2', '2', '2', '2', '1', '4', '4'];
/** Depth 1: from the post-KILL cell back to the stair-up at (38,23). Lifted from `town-loop`. */
const TO_STAIR_UP = ['6', '9', '8', '8', '8', '8', '8', '8', '8', '9', '6', '3', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2', '3', '3', '3', '2', '3', '6'];
/** Town: from the stair cell (6,10) up to the walkway and east into the curios stall's mouth,
 * ending directly south of the dealer at (25,3) -- Chebyshev-adjacent, so trade can open. */
const TO_CURIOS = ['8', '8', '8', '8', '8', '8', '6', '6', '6', '6', '6', '6', '6', '6', '6', '6', '6', '6', '6', '6', '6', '6', '6', '6', '6', '8'];

async function pressAll(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** The very first keydown after load can race the key listener attaching; a `g` with nothing
 * underfoot is rejected client-side ("nothing here to pick up") WITHOUT touching engine state, so
 * it proves the keyboard is live without desyncing the pinned walk. */
async function awaitKeyboardReady(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('g');
    await expect(page.getByRole('log', { name: /adventure log/i }))
      .toContainText(/nothing here to pick up/i, { timeout: 250 });
  }).toPass();
}

/** Opens a global/play overlay by its key, asserts its `overlay-*` host mounted, then Escapes back
 * to the live play grid -- the per-overlay "open by key, Esc returns to play, hero responsive
 * after" contract. */
async function cycleOverlay(page: Page, key: string, testId: string): Promise<void> {
  await page.keyboard.press(key);
  await expect(page.getByTestId(testId)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(testId)).toBeHidden();
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();
}

test('the guest interface: overlays, rebinding, font scale, codex discovery, identify, and reset', async ({ page }) => {
  await page.goto(SEED_QUERY);
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();
  await expect(page.locator('.status-depth')).toHaveText('Town');
  await expect(page.getByLabel('Hero at 5, 9')).toBeVisible();
  await awaitKeyboardReady(page);

  // --- Open and close every registry overlay by its key; each returns to a live play grid. ---
  await cycleOverlay(page, 'c', 'overlay-character-sheet');
  await cycleOverlay(page, 'm', 'overlay-map-journal');
  await cycleOverlay(page, 'x', 'overlay-codex');
  await cycleOverlay(page, 'o', 'overlay-settings');
  await cycleOverlay(page, 'Shift+?', 'overlay-help');
  await cycleOverlay(page, 'i', 'overlay-inventory');
  // Hero is still responsive after the whole overlay tour (state untouched at the spawn cell).
  await awaitKeyboardReady(page);
  await expect(page.getByLabel('Hero at 5, 9')).toBeVisible();

  // --- Rebind Move west to `q`, then walk west with it; the aria hero label proves the move. ---
  await page.keyboard.press('o');
  const settings = page.getByTestId('overlay-settings');
  await expect(settings).toBeVisible();
  const westRow = settings.locator('.settings-bindings-list li').filter({ hasText: 'Move west' });
  await expect(westRow.locator('.settings-binding-chord')).toHaveText('h');
  await westRow.getByRole('button', { name: 'Rebind' }).click();
  await page.keyboard.press('q'); // committed into the armed capture field
  await expect(westRow.locator('.settings-binding-chord')).toHaveText('q');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  await page.keyboard.press('q'); // `q` now routes to Move west
  await expect(page.getByLabel('Hero at 4, 9')).toBeVisible();

  // Rebind back: reset the Move west row to its default `h`.
  await page.keyboard.press('o');
  await expect(settings).toBeVisible();
  await westRow.getByRole('button', { name: 'Reset' }).click();
  await expect(westRow.locator('.settings-binding-chord')).toHaveText('h');

  // --- Set font scale to 130% and complete a five-step walk: the walk succeeding under the
  // enlarged camera IS the camera-consistency assertion (a broken camera desyncs the hero cell). ---
  await settings.getByRole('radio', { name: '130%' }).click();
  await expect(settings.getByRole('radio', { name: '130%' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  await pressAll(page, ['6', '6', '6', '6', '6']); // walk east five cells: (4,9) -> (9,9)
  await expect(page.getByLabel('Hero at 9, 9')).toBeVisible();

  // --- Codex in town: the hero's class and starting gear are discovered (perceived in town),
  // but every monster is still a silhouette -- nothing has been perceived below yet. ---
  await page.keyboard.press('x');
  const codex = page.getByTestId('overlay-codex');
  await expect(codex).toBeVisible();
  await codex.getByRole('tab', { name: 'Classes' }).click();
  await expect(codex.getByRole('listbox', { name: 'Classes' })).toContainText('Wayfarer');
  await codex.getByRole('tab', { name: 'Items' }).click();
  await expect(codex.getByRole('listbox', { name: 'Items' })).toContainText('Iron sword');
  await codex.getByRole('tab', { name: 'Monsters' }).click();
  const monsters = codex.getByRole('listbox', { name: 'Monsters' });
  await expect(monsters).toContainText('???');
  await expect(monsters).not.toContainText(/Training beetle/i);
  await page.keyboard.press('Escape');
  await expect(codex).toBeHidden();

  // --- Descend to Depth 1, land the first kill, and ascend back to town. ---
  await pressAll(page, ['4', '4', '4', '2']); // (9,9) -> (6,9) -> (6,10), onto the stair
  await page.keyboard.press('>');
  await expect(page.locator('.status-depth')).toHaveText('Depth 1');
  await expect(page.getByLabel('Hero at 38, 23')).toBeVisible();

  await pressAll(page, KILL);
  await expect(page.getByRole('log', { name: /adventure log/i })).toContainText(/dies/i);

  await pressAll(page, TO_STAIR_UP);
  await page.keyboard.press('<');
  await expect(page.locator('.status-depth')).toHaveText('Town');
  await expect(page.getByLabel('Hero at 6, 10')).toBeVisible();

  // --- Codex again: the perceived-and-killed Training beetle is now a named, discovered entry. ---
  await page.keyboard.press('x');
  await expect(codex).toBeVisible();
  await codex.getByRole('tab', { name: 'Monsters' }).click();
  await expect(codex.getByRole('listbox', { name: 'Monsters' })).toContainText(/Training beetle/i);
  await page.keyboard.press('Escape');
  await expect(codex).toBeHidden();

  // --- Curios dealer: buy the unidentified potion, then identify it through the inline picker. ---
  await pressAll(page, TO_CURIOS);
  await page.keyboard.press('Shift+T');
  const trade = page.getByRole('dialog', { name: 'Trade' });
  await expect(trade).toBeVisible();
  await expect(trade.locator('.trade-currency')).toHaveText('40g');

  await page.keyboard.press('Enter'); // buy the first stock row (the unidentified potion)
  await expect(trade.locator('.trade-currency')).toHaveText('24g');

  await page.keyboard.press('Tab'); // Buy -> Sell
  await page.keyboard.press('Tab'); // Sell -> Services
  await page.keyboard.press('Enter'); // identify service opens the inline target picker
  const picker = trade.locator('.trade-picker');
  await expect(picker.getByRole('listbox', { name: 'Identify target' })).toBeVisible();
  await expect(picker).not.toContainText(/Mending draught/i); // still unidentified in the picker

  await page.keyboard.press('Enter'); // identify the selected target
  await expect(trade.locator('.trade-picker')).toBeHidden();
  await expect(trade.locator('.trade-currency')).toHaveText('13g');
  await expect(trade).toContainText(/Mending draught/i); // now identified by its true name
  await page.keyboard.press('Escape');
  await expect(trade).toBeHidden();

  // --- Clear the guest session from settings; the app lands on a fresh title screen. ---
  // Strip the quickstart query first (no reload; React state intact): with `?quickstart=1` still
  // in the URL, App.tsx's quickstart boot effect re-fires the instant clearing sets `session`
  // back to undefined and constructs a fresh hidden GuestSession, whose constructor re-persists
  // the sightings cache (`syncSightings`) -- re-creating `woven-deep.guest-codex` right after the
  // wipe. Real users clearing their session are never on a quickstart URL, so the storage-empty
  // assertion below targets the real flow.
  await page.evaluate(() => window.history.replaceState(null, '', '/'));
  await page.keyboard.press('o');
  await expect(settings).toBeVisible();
  await settings.locator('#settings-clear-confirm').fill('clear');
  await settings.getByRole('button', { name: 'Clear guest session' }).click();

  // The title menu is a roving listbox of `option`s (see `TitleScreen`), not buttons.
  await expect(page.getByRole('listbox', { name: 'Title menu' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Enter the Deep' })).toBeVisible();
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeHidden();

  // The fresh title alone doesn't prove the clear itself worked -- routing decouples the title
  // transition from the storage wipe, so a broken clear could still land here. Prove storage is
  // actually empty: every key named by `clear-guest-session.ts`'s GUEST_SESSION_STORAGE_KEYS
  // (sessionStorage) and GUEST_LOCAL_STORAGE_KEYS (localStorage).
  await expect(async () => {
    const remaining = await page.evaluate(() => ({
      session: [
        'woven-deep.guest-run',
        'woven-deep.guest-command-seq',
        'woven-deep.guest-hall',
        'woven-deep.guest-portrait',
        'woven-deep.guest-codex',
      ].filter((key) => sessionStorage.getItem(key) !== null),
      local: ['woven-deep.settings.v1'].filter((key) => localStorage.getItem(key) !== null),
    }));
    expect(remaining.session).toEqual([]);
    expect(remaining.local).toEqual([]);
  }).toPass();
});
