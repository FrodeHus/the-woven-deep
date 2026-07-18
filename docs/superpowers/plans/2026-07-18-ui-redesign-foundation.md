# UI Redesign — Foundation & In-Game Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web client's hand-rolled overlay/chrome UI with a shadcn/ui (Base UI) + Tailwind v4 + `cmdk` component system in a coherent dark-fantasy theme, keeping the deterministic engine, session layer, and ASCII grid untouched.

**Architecture:** Presentation-layer swap inside `apps/web/src/ui/` only. Rebuilt React components consume the existing `SessionSnapshot` (via `useGuestSession`) and dispatch the existing `PlayerIntent`s. A vendored, owned component layer (shadcn on Base UI primitives) replaces `OverlayScaffold`/`focus-trap`/`roving-focus`; a single `OverlayHost` on `Sheet`/`Dialog` replaces the two duplicated overlay hosts; the play screen is recomposed into Layout A (grid + right rail + full-width log); a new `cmdk` command palette becomes the keyboard-first action spine.

**Tech Stack:** React 19, Vite 7, TypeScript 5.8, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui on Base UI (`@base-ui-components/react`), `cmdk`, `clsx` + `tailwind-merge` + `class-variance-authority`, `lucide-react`. Tests: Vitest 3.2 + Testing Library + user-event; Playwright e2e.

## Global Constraints

- **Presentation-layer only.** Touch only `apps/web/src/ui/**` and the `apps/web` build config (`package.json`, `vite.config.ts`, `tsconfig.json`, Tailwind/shadcn config, entry CSS). Do NOT modify `apps/web/src/session/**`, `packages/engine/**`, or `packages/content/**`.
- **Grid renderer untouched.** Do NOT modify `GridRenderer.tsx`, `EffectsLayer.tsx`, `camera.ts`, `cell-color.ts`, `effects-map.ts`, `light-sources.ts`, or `styles.css` lines that style the grid/effects (the contiguous keep-zone ~189–489, plus `:root` material palette ~17–25, `.sr-only` ~598–611, and the reduced/full-motion media queries). Only chrome CSS is retired.
- **Landing page untouched.** Do NOT modify `apps/web/src/landing/**`.
- **Input target:** keyboard-first + mouse, desktop viewports. Every rebuilt surface must be fully keyboard-operable; mouse/hover is first-class. No dedicated touch/phone layout is required.
- **Component layer:** shadcn/ui components vendored into `apps/web/src/ui/components/`; the underlying primitive library is Base UI (`@base-ui-components/react`); the command palette is `cmdk`. The vendored files are owned source.
- **Theme:** "Grimoire / ember" — warm near-black surfaces, ember-gold accent, crimson danger token for HP/threats, serif headings + sans body, monospace retained in playfield + message log. One semantic CSS-variable token set drives chrome and the semantic UI colors.
- **Contracts are stable:** rebuilt components read `SessionSnapshot` via `useGuestSession(session)` and dispatch `PlayerIntent` via `session.dispatch(...)`. `OverlayId = 'inventory' | 'character-sheet' | 'map-journal' | 'codex' | 'settings' | 'help'`. Keymap enumeration uses `ACTION_IDS`, `ACTION_LABELS`, `resolveKeymap`, `chordKey` from `session/settings.ts`.
- **No history comments.** Comments describe current behavior/intent, never what code used to be or what was removed.
- **Build order:** the web Vitest/Playwright suites require `@woven-deep/content` and `@woven-deep/engine` dist built first. Run `npm run build -w @woven-deep/content && npm run build -w @woven-deep/engine` before the web suites in a fresh worktree.
- **Runtime:** Node ≥22.12, ESM, TypeScript strict.

---

## File Structure

New (created):
- `apps/web/src/ui/theme/tokens.css` — semantic CSS-variable token set (Grimoire/ember) + Tailwind `@theme` mapping.
- `apps/web/src/ui/lib/cn.ts` — `cn()` class-merge util.
- `apps/web/src/ui/components/*` — vendored shadcn primitives (sheet, dialog, command, tabs, tooltip, dropdown-menu, button, input, switch, select, label, scroll-area).
- `apps/web/src/ui/providers.tsx` — `UiProviders` + `usePack`/`useSettingsCtx`/`useSessionCtx` hooks.
- `apps/web/src/ui/overlays/OverlayHost.tsx` — single overlay host on Sheet/Dialog.
- `apps/web/src/ui/components/ListDetail.tsx` — shared slot-grid + list + detail skeleton.
- `apps/web/src/ui/CommandPalette.tsx` — ⌘K palette.
- `apps/web/src/ui/panels/*` — recomposed play-screen panels (Hero/Vitals, Threat, Status, Log, Minimap) for Layout A.

Rebuilt (heavy modify):
- `apps/web/src/ui/overlays/{InventoryOverlay,CharacterSheetOverlay,MapJournalOverlay,CodexOverlay,HelpOverlay,SettingsOverlay}.tsx`
- `apps/web/src/ui/PlayScreen.tsx` (Layout A shell), `apps/web/src/App.tsx` (single overlay host, providers, screen restyle), `apps/web/src/ui/panels.tsx` (split/restyle), `apps/web/src/ui/screens/{HallScreen,HouseScreen,TradeScreen,ConclusionScreen,SignInScreen,TitleScreen,ChargenScreen}.tsx` (restyle/re-skin).

Retired (deleted once unreferenced):
- `apps/web/src/ui/overlays/{OverlayScaffold.tsx,focus-trap.ts,overlay-components.tsx}`, `apps/web/src/ui/screens/roving-focus.ts` (if no remaining consumers), and the chrome CSS blocks in `styles.css`.

---

### Task 1: Tailwind v4 + tokens + tooling foundation

**Files:**
- Modify: `apps/web/package.json` (deps), `apps/web/vite.config.ts` (tailwind plugin + `@` alias), `apps/web/tsconfig.json` (paths)
- Create: `apps/web/src/ui/theme/tokens.css`, `apps/web/src/ui/lib/cn.ts`, `apps/web/components.json`
- Modify: `apps/web/src/main.tsx` (import tokens.css), `apps/web/src/styles.css` (leave grid/effects; the token import is separate)
- Test: `apps/web/src/ui/lib/cn.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` (from `ui/lib/cn.ts`); Tailwind utilities backed by tokens (`bg-surface`, `bg-deep`, `bg-raised`, `text-fg`, `text-muted`, `text-accent`, `text-danger`, `border-line`, `font-serif`, `font-sans`, `font-mono`); the `@/*` → `src/*` path alias.

- [ ] **Step 1: Install dependencies**

Run in repo root:
```bash
npm i -w @woven-deep/web tailwindcss@^4 @tailwindcss/vite@^4 @base-ui-components/react cmdk clsx tailwind-merge class-variance-authority lucide-react
```
Expected: packages added to `apps/web/package.json` dependencies; `npm install` completes.

- [ ] **Step 2: Add the `@` alias + tailwind plugin to Vite**

Edit `apps/web/vite.config.ts` — add the Tailwind plugin and resolve alias (merge into the existing config; keep the React plugin):
```ts
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
// ...existing imports (react, defineConfig)...

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // ...preserve existing test/build config...
});
```

- [ ] **Step 3: Add path alias to tsconfig**

Edit `apps/web/tsconfig.json` `compilerOptions`: add
```json
"baseUrl": ".",
"paths": { "@/*": ["src/*"] }
```

- [ ] **Step 4: Write the token theme**

Create `apps/web/src/ui/theme/tokens.css`:
```css
@import "tailwindcss";

@theme {
  --color-deep: #100d0a;
  --color-surface: #17130c;
  --color-raised: #211a10;
  --color-line: #2a2013;
  --color-fg: #e8ddc9;
  --color-fg-strong: #f0e6d2;
  --color-muted: #9a8f7c;
  --color-subtle: #6a6152;
  --color-accent: #d99a2b;
  --color-accent-strong: #e6c34d;
  --color-danger: #c23b52;
  --color-danger-fg: #d9536a;
  --color-good: #8caa6e;
  --color-cool: #9a8fd0;
  --color-warn: #d9a441;

  --font-serif: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
  --font-sans: -apple-system, "Segoe UI", Roboto, system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;

  --radius: 0.5rem;
}
```
(Tailwind v4 reads `@theme` custom properties and generates `bg-surface`, `text-accent`, `border-line`, `font-serif`, etc. `--color-line` backs `border-line`.)

- [ ] **Step 5: Import tokens at the app entry**

Edit `apps/web/src/main.tsx`: add `import './ui/theme/tokens.css';` above the existing `import './styles.css';`. Leave `styles.css` in place (grid/effects still needs it).

- [ ] **Step 6: Create the `cn` util + shadcn config**

Create `apps/web/src/ui/lib/cn.ts`:
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges conditional class names, de-duplicating conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

Create `apps/web/components.json` (so the shadcn CLI in Task 2 targets the right paths):
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/ui/theme/tokens.css", "baseColor": "neutral", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/ui/components",
    "utils": "@/ui/lib/cn",
    "ui": "@/ui/components"
  }
}
```

- [ ] **Step 7: Write the failing test**

Create `apps/web/src/ui/lib/cn.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { cn } from './cn.js';

describe('cn', () => {
  it('merges conditional classes', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
  it('de-duplicates conflicting tailwind utilities, last wins', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
```

- [ ] **Step 8: Run tests + typecheck + build**

```bash
npm run build -w @woven-deep/content && npm run build -w @woven-deep/engine
npm run test -w @woven-deep/web -- cn.test.ts
npm run typecheck -w @woven-deep/web
npm run build -w @woven-deep/web
```
Expected: cn tests PASS; typecheck clean; production build succeeds (Tailwind processes tokens.css). The existing grid/effects styling is unchanged.

- [ ] **Step 9: Commit**

```bash
git add apps/web/package.json apps/web/vite.config.ts apps/web/tsconfig.json apps/web/components.json apps/web/src/ui/theme apps/web/src/ui/lib apps/web/src/main.tsx package-lock.json
git commit -m "feat(web): add Tailwind v4 + Grimoire tokens + cn util"
```

---

### Task 2: Vendor shadcn/Base UI primitives

**Files:**
- Create: `apps/web/src/ui/components/{sheet,dialog,command,tabs,tooltip,dropdown-menu,button,input,switch,select,label,scroll-area}.tsx`
- Test: `apps/web/src/ui/components/dialog.test.tsx`

**Interfaces:**
- Produces: the shadcn component exports used downstream — `Sheet, SheetContent, SheetHeader, SheetTitle`; `Dialog, DialogContent, DialogHeader, DialogTitle`; `Command, CommandInput, CommandList, CommandItem, CommandGroup, CommandEmpty`; `Tabs, TabsList, TabsTrigger, TabsContent`; `Tooltip, TooltipTrigger, TooltipContent`; `DropdownMenu*`; `Button` (with `buttonVariants`); `Input`; `Switch`; `Select*`; `Label`; `ScrollArea`. All keyboard/ARIA-correct via Base UI, styled with token utilities.

- [ ] **Step 1: Add primitives via the shadcn CLI**

```bash
cd apps/web
npx shadcn@latest add sheet dialog command tabs tooltip dropdown-menu button input switch select label scroll-area --yes
cd ../..
```
Expected: component files created under `apps/web/src/ui/components/` importing from `@base-ui-components/react` and `@/ui/lib/cn`. If a primitive's generated output references a different import path, adjust the import to `@/ui/lib/cn`'s `cn`.

- [ ] **Step 2: Re-theme generated components to tokens**

In each generated file, replace neutral/zinc utility classes with the token utilities (e.g. `bg-background`→`bg-surface`, `text-foreground`→`text-fg`, `border`→`border-line`, primary accents→`bg-accent`/`text-accent`, destructive→`bg-danger`/`text-danger`). Overlay scrims use `bg-black/55`. Keep all Base UI behavior/props intact — only class strings change.

- [ ] **Step 3: Write the failing keyboard test**

Create `apps/web/src/ui/components/dialog.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle } from './dialog.js';

function Harness() {
  return (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>Grimoire</DialogTitle>
        <button>first</button>
        <button>second</button>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog primitive', () => {
  it('renders as a modal dialog with an accessible name', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: 'Grimoire' })).toBeInTheDocument();
  });
  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm run test -w @woven-deep/web -- dialog.test.tsx
npm run typecheck -w @woven-deep/web
```
Expected: PASS — dialog has role+name and closes on Escape (focus trap + ESC handled by Base UI). If jsdom lacks an API a primitive needs (e.g. `ResizeObserver`, `scrollIntoView`, `PointerEvent`), add a minimal stub to `apps/web/vitest.setup.ts` (create it and register via `test.setupFiles` in the vite config if not present); do not alter component behavior.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/components apps/web/vitest.setup.ts apps/web/vite.config.ts
git commit -m "feat(web): vendor shadcn/Base UI primitives themed to tokens"
```

---

### Task 3: UI context providers

**Files:**
- Create: `apps/web/src/ui/providers.tsx`
- Test: `apps/web/src/ui/providers.test.tsx`

**Interfaces:**
- Consumes: `CompiledContentPack` (from `@woven-deep/content`), `Settings` + `resolveKeymap` (from `session/settings.ts`), `GuestSession` + `SessionSnapshot` (from `session/guest-session.ts`), `useGuestSession` (from `session/store.ts`).
- Produces:
  - `UiProviders({ pack, settings, onChangeSettings, session, children }): JSX.Element` where `session?: GuestSession` (absent on non-play screens).
  - `usePack(): CompiledContentPack`
  - `useSettingsCtx(): { readonly settings: Settings; readonly onChange: (next: Settings) => void; readonly keymap: ResolvedKeymap }`
  - `useSessionCtx(): { readonly session: GuestSession; readonly snapshot: SessionSnapshot } | null` (null when no session in context)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/providers.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UiProviders, usePack, useSettingsCtx, useSessionCtx } from './providers.js';
import { DEFAULT_SETTINGS } from '../session/settings.js';

function Probe() {
  const pack = usePack();
  const { keymap } = useSettingsCtx();
  const session = useSessionCtx();
  return <output>{pack.id}:{keymap.byAction.inventory.key}:{session ? 'session' : 'none'}</output>;
}

describe('UiProviders', () => {
  it('exposes pack, resolved keymap, and null session when none given', () => {
    const pack = { id: 'core' } as never;
    render(
      <UiProviders pack={pack} settings={DEFAULT_SETTINGS} onChangeSettings={() => {}}>
        <Probe />
      </UiProviders>,
    );
    expect(screen.getByRole('status').textContent).toBe('core:i:none');
  });
});
```
(`<output>` has implicit role `status`.)

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -w @woven-deep/web -- providers.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement providers**

Create `apps/web/src/ui/providers.tsx`:
```tsx
import { createContext, useContext, useMemo, type JSX, type ReactNode } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GuestSession, SessionSnapshot } from '../session/guest-session.js';
import { resolveKeymap, type ResolvedKeymap, type Settings } from '../session/settings.js';
import { useGuestSession } from '../session/store.js';

const PackContext = createContext<CompiledContentPack | null>(null);
const SettingsContext = createContext<{
  settings: Settings; onChange: (next: Settings) => void; keymap: ResolvedKeymap;
} | null>(null);
const SessionContext = createContext<{ session: GuestSession; snapshot: SessionSnapshot } | null>(null);

export function usePack(): CompiledContentPack {
  const value = useContext(PackContext);
  if (!value) throw new Error('usePack must be used within UiProviders');
  return value;
}

export function useSettingsCtx(): { readonly settings: Settings; readonly onChange: (next: Settings) => void; readonly keymap: ResolvedKeymap } {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettingsCtx must be used within UiProviders');
  return value;
}

export function useSessionCtx(): { readonly session: GuestSession; readonly snapshot: SessionSnapshot } | null {
  return useContext(SessionContext);
}

function SessionBridge({ session, children }: Readonly<{ session: GuestSession; children: ReactNode }>): JSX.Element {
  const snapshot = useGuestSession(session);
  return <SessionContext.Provider value={{ session, snapshot }}>{children}</SessionContext.Provider>;
}

export function UiProviders({ pack, settings, onChangeSettings, session, children }: Readonly<{
  pack: CompiledContentPack;
  settings: Settings;
  onChangeSettings: (next: Settings) => void;
  session?: GuestSession;
  children: ReactNode;
}>): JSX.Element {
  const settingsValue = useMemo(
    () => ({ settings, onChange: onChangeSettings, keymap: resolveKeymap(settings.bindings) }),
    [settings, onChangeSettings],
  );
  const tree = session ? <SessionBridge session={session}>{children}</SessionBridge> : children;
  return (
    <PackContext.Provider value={pack}>
      <SettingsContext.Provider value={settingsValue}>{tree}</SettingsContext.Provider>
    </PackContext.Provider>
  );
}
```

- [ ] **Step 4: Run test + typecheck**

```bash
npm run test -w @woven-deep/web -- providers.test.tsx
npm run typecheck -w @woven-deep/web
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/providers.tsx apps/web/src/ui/providers.test.tsx
git commit -m "feat(web): add UI context providers (pack/settings/session)"
```

---

### Task 4: Single OverlayHost on Sheet/Dialog (frame swap)

Replaces `App.renderOverlayHost` + the `PlayScreen` overlay IIFE + `OverlayScaffold` + `OverlayErrorBoundary` wrapping with one host. This task swaps the *frame* while still rendering the current overlay bodies (rebuilt one-per-task afterward), proving the open/close/focus/ESC coordination end-to-end.

**Files:**
- Create: `apps/web/src/ui/overlays/OverlayHost.tsx`
- Modify: `apps/web/src/App.tsx` (wrap tree in `UiProviders`; replace `renderOverlayHost` with `<OverlayHost>`), `apps/web/src/ui/PlayScreen.tsx` (remove the overlay IIFE; render `<OverlayHost>`)
- Test: `apps/web/src/ui/overlays/OverlayHost.test.tsx`

**Interfaces:**
- Consumes: `OverlayId`, `OVERLAY_REGISTRY`, `canOpenOverlay` (from `overlays/registry.ts`); `usePack`, `useSettingsCtx`, `useSessionCtx` (Task 3); existing overlay body components.
- Produces: `OverlayHost({ overlay, onClose, isPlayActive }: { overlay: OverlayId | null; onClose: () => void; isPlayActive: boolean }): JSX.Element | null`. Uses `Sheet` (side="right") for `inventory`/`character-sheet`/`map-journal`; `Dialog` for `codex`/`settings`/`help`. The primitive owns dismissal: `onOpenChange={(open) => { if (!open) onClose(); }}`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/overlays/OverlayHost.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OverlayHost } from './OverlayHost.js';
import { UiProviders } from '../providers.js';
import { DEFAULT_SETTINGS } from '../../session/settings.js';

function renderHost(overlay: 'help' | null, onClose = vi.fn()) {
  const pack = { entries: [], id: 'core' } as never;
  return {
    onClose,
    ...render(
      <UiProviders pack={pack} settings={DEFAULT_SETTINGS} onChangeSettings={() => {}}>
        <OverlayHost overlay={overlay} onClose={onClose} isPlayActive={false} />
      </UiProviders>,
    ),
  };
}

describe('OverlayHost', () => {
  it('renders nothing when overlay is null', () => {
    renderHost(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('opens a global overlay as a dialog and closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderHost('help');
    expect(screen.getByRole('dialog', { name: /help/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -w @woven-deep/web -- OverlayHost.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement OverlayHost**

Create `apps/web/src/ui/overlays/OverlayHost.tsx`. Render the matching primitive keyed on the overlay id, titled from `OVERLAY_REGISTRY[id].title`, with the current body component inside. Wire each body's props from context (`usePack`/`useSettingsCtx`/`useSessionCtx`) so the host no longer threads the `OverlayBodyProps` bag. Example structure:
```tsx
import type { JSX } from 'react';
import { OVERLAY_REGISTRY, type OverlayId } from './registry.js';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/sheet.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/dialog.js';
import { usePack, useSettingsCtx, useSessionCtx } from '../providers.js';
// ...import the current overlay body components...

const SHEET_OVERLAYS: ReadonlySet<OverlayId> = new Set(['inventory', 'character-sheet', 'map-journal']);

export function OverlayHost({ overlay, onClose, isPlayActive }: Readonly<{
  overlay: OverlayId | null; onClose: () => void; isPlayActive: boolean;
}>): JSX.Element | null {
  const pack = usePack();
  const { settings, onChange, keymap } = useSettingsCtx();
  const sessionCtx = useSessionCtx();
  if (overlay === null) return null;
  if (!canOpenOverlay(OVERLAY_REGISTRY[overlay], isPlayActive)) return null;

  const title = OVERLAY_REGISTRY[overlay].title;
  const body = renderBody(overlay, { pack, settings, onChange, keymap, sessionCtx, onClose });
  const onOpenChange = (open: boolean): void => { if (!open) onClose(); };

  if (SHEET_OVERLAYS.has(overlay)) {
    return (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent side="right" data-testid={`overlay-${overlay}`}>
          <SheetHeader><SheetTitle>{title}</SheetTitle></SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-testid={`overlay-${overlay}`}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
```
`renderBody` switches on the id and passes each existing body the concrete props it needs (from context), preserving current behavior. Wrap `body` in an error boundary (reuse `OverlayErrorBoundary` for now; it is retired in Task 15 only if unreferenced). Do not add history comments.

- [ ] **Step 4: Wire App + PlayScreen to the single host**

In `App.tsx`: wrap the play and title subtrees in `<UiProviders pack={pack} settings={settings} onChangeSettings={handleSettingsChange} session={session}>` (session only where present). Delete `renderOverlayHost`; render `<OverlayHost overlay={overlay} onClose={closeOverlay} isPlayActive={screen.screen === 'play' && session !== undefined} />` where the title screen currently calls `{renderOverlayHost()}`.
In `PlayScreen.tsx`: delete the overlay IIFE (lines ~422–445) and render `<OverlayHost overlay={overlay} onClose={onCloseOverlay} isPlayActive />`. Leave `createKeyDispatcher` wiring intact — its `closeOverlay` handler and `isOverlayOpen` predicate are unchanged; the primitive's `onOpenChange` calls the same `onCloseOverlay`. (Escape now resolves via Base UI; the KeyRouter Escape branch remains a harmless idempotent fallback.)

- [ ] **Step 5: Run tests + typecheck + targeted e2e**

```bash
npm run test -w @woven-deep/web -- OverlayHost.test.tsx
npm run typecheck -w @woven-deep/web
npm run build -w @woven-deep/web
```
Expected: PASS + clean typecheck + build. (e2e updated in later tasks as bodies change.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/overlays/OverlayHost.tsx apps/web/src/ui/overlays/OverlayHost.test.tsx apps/web/src/App.tsx apps/web/src/ui/PlayScreen.tsx
git commit -m "feat(web): single OverlayHost on Sheet/Dialog, retire dual hosts"
```

---

### Task 5: Play-screen Layout A shell + panels

**Files:**
- Create: `apps/web/src/ui/panels/HeroPanel.tsx`, `ThreatPanel.tsx`, `StatusBar.tsx`, `LogPanel.tsx`, `MinimapPanel.tsx` (moved out of the monolithic `panels.tsx`, restyled with tokens)
- Modify: `apps/web/src/ui/PlayScreen.tsx` (Layout A CSS-grid shell), keep `panels.tsx` re-exporting `HeroStatusAnnouncer`/`VitalsStrip` or fold them in
- Test: `apps/web/src/ui/panels/StatusBar.test.tsx`, `apps/web/src/ui/panels/MinimapPanel.test.tsx`

**Interfaces:**
- Consumes: `SessionSnapshot` via `useSessionCtx()`; `visibleForeground` from `ui/cell-color.js` (minimap); `PanelProps = { snapshot: SessionSnapshot }`.
- Produces: Layout A shell — a CSS-grid container `grid-cols-[1fr_15rem] grid-rows-[1fr_auto]`: grid+effects in the main cell (untouched renderer), right rail (Hero/Vitals above Minimap; Threat/Town below) in the side cell, `LogPanel` spanning the full width in the bottom row. `MinimapPanel({ snapshot }): JSX.Element` renders a compact remembered/visible map from `snapshot.projection.floor` + `.hero`.

- [ ] **Step 1: Write the failing StatusBar test**

Create `apps/web/src/ui/panels/StatusBar.test.tsx` asserting the restyled StatusBar still renders the hero name, depth, and `data-testid="turn-count"` from a stub snapshot (mirror the current StatusBar contract). Provide a minimal snapshot stub with `projection.hero.name`, `projection.floor`, `projection.metrics`.
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from './StatusBar.js';

const snapshot = {
  projection: { hero: { name: 'Ashwalker' }, floor: { depth: 3, town: false }, metrics: { turns: 42 } },
} as never;

describe('StatusBar', () => {
  it('renders hero name, depth and turn count', () => {
    render(<StatusBar snapshot={snapshot} />);
    expect(screen.getByText('Ashwalker')).toBeInTheDocument();
    expect(screen.getByTestId('turn-count')).toHaveTextContent('42');
  });
});
```
(Confirm the exact field names against the current `StatusBar` in `panels.tsx` before writing the stub; match them precisely.)

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -w @woven-deep/web -- StatusBar.test.tsx
```
Expected: FAIL — module `./StatusBar.js` not found.

- [ ] **Step 3: Split + restyle the panels**

Move each panel from `panels.tsx` into its own file under `ui/panels/`, preserving its exact data reads and `data-testid`s, replacing hand-CSS classes with token utilities (`bg-surface`, `border-line`, `text-fg`, health bar via `bg-danger`/`bg-good`, log severity via `text-danger`/`text-good`/`text-muted`). Keep `role="log" aria-live="polite"` on `LogPanel`, `role="group"` on `StatusBar`, the `HeroStatusAnnouncer` live region, and the colorblind condition badge. Keep the message log **monospace** (`font-mono`). Add `MinimapPanel` using `visibleForeground` from `cell-color.ts` at a small fixed cell size (mirror `MapJournalOverlay`'s map pane logic, read-only).

- [ ] **Step 4: Recompose PlayScreen into Layout A**

In `PlayScreen.tsx`, replace the `.triptych` markup with the Layout A CSS-grid: main cell = the existing `GridRenderer` + `EffectsLayer` (unchanged); right rail = `HeroPanel`/`VitalsStrip` + `MinimapPanel` + (`ThreatPanel` or `TownPanel`); bottom row = `LogPanel` full width. Keep `HintStrip`, `DecisionPrompt`, `HouseScreen`, `TradeScreen`, and the `OverlayHost` from Task 4. The playfield must never reflow when an overlay opens (the Sheet overlays the rail, not the grid).

- [ ] **Step 5: Add the MinimapPanel test**

Create `apps/web/src/ui/panels/MinimapPanel.test.tsx` rendering a tiny floor stub and asserting it renders a grid region (`getByRole('img', { name: /map/i })` or a `data-testid="minimap"`), and does not throw when `projection.floor.town` is true.

- [ ] **Step 6: Run tests + typecheck + build**

```bash
npm run test -w @woven-deep/web -- panels/
npm run typecheck -w @woven-deep/web
npm run build -w @woven-deep/web
```
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui/panels apps/web/src/ui/PlayScreen.tsx apps/web/src/ui/panels.tsx
git commit -m "feat(web): play-screen Layout A shell + tokenized panels"
```

---

### Task 6: Shared ListDetail component

The slot-grid + navigable list + detail skeleton reused by inventory, character sheet, and codex.

**Files:**
- Create: `apps/web/src/ui/components/ListDetail.tsx`
- Test: `apps/web/src/ui/components/ListDetail.test.tsx`

**Interfaces:**
- Produces:
```ts
export interface ListDetailItem { readonly id: string; readonly glyph?: string; readonly glyphColor?: string; readonly label: string; readonly badge?: string; readonly quantity?: number; }
export interface ListDetailProps {
  readonly items: readonly ListDetailItem[];
  readonly renderDetail: (item: ListDetailItem | undefined, index: number) => ReactNode;
  readonly selectedIndex: number;
  readonly onSelect: (index: number) => void;
  readonly listLabel: string;
  readonly slots?: ReactNode; // optional equipped-slot grid rendered above the list
  readonly toolbar?: ReactNode; // optional category/sort controls
}
export function ListDetail(props: Readonly<ListDetailProps>): JSX.Element
```
Keyboard: `ArrowUp`/`ArrowDown` move selection (wrapping) via `aria-activedescendant` on a `role="listbox"`; `Home`/`End` jump; selection is controlled by the parent (so parents can bind action keys). Mouse: click a row selects. Detail pane renders `renderDetail(items[selectedIndex], selectedIndex)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/components/ListDetail.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ListDetail, type ListDetailItem } from './ListDetail.js';

const items: ListDetailItem[] = [
  { id: 'a', label: 'Iron sword' },
  { id: 'b', label: 'Ashen potion', quantity: 2 },
];

function Harness({ onSelect }: { onSelect: (i: number) => void }) {
  const [sel, setSel] = useState(0);
  return (
    <ListDetail
      items={items}
      listLabel="Pack"
      selectedIndex={sel}
      onSelect={(i) => { setSel(i); onSelect(i); }}
      renderDetail={(item) => <p>{item ? item.label : 'nothing'}</p>}
    />
  );
}

describe('ListDetail', () => {
  it('moves selection with ArrowDown and shows detail', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const listbox = screen.getByRole('listbox', { name: 'Pack' });
    listbox.focus();
    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenLastCalledWith(1);
    expect(screen.getByText('Ashen potion')).toBeInTheDocument();
  });
  it('selects on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await user.click(screen.getByText('Ashen potion'));
    expect(onSelect).toHaveBeenLastCalledWith(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -w @woven-deep/web -- ListDetail.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ListDetail**

Create `apps/web/src/ui/components/ListDetail.tsx` implementing the `role="listbox"` + `role="option"` pattern with `aria-activedescendant`, wrapping arrow navigation, `Home`/`End`, click-to-select, an optional `slots` region above the list and `toolbar` above that, and a detail pane beside the list. Style with tokens (selected row: `bg-raised` + `border-l-2 border-accent`). Two-column layout `grid-cols-[1.05fr_1fr]`. Keep the list font `font-sans` for labels but glyphs `font-mono` with `glyphColor` inline.

- [ ] **Step 4: Run test + typecheck**

```bash
npm run test -w @woven-deep/web -- ListDetail.test.tsx
npm run typecheck -w @woven-deep/web
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/components/ListDetail.tsx apps/web/src/ui/components/ListDetail.test.tsx
git commit -m "feat(web): shared ListDetail slot-grid+list+detail component"
```

---

### Task 7: Inventory overlay (structure 1)

**Files:**
- Rebuild: `apps/web/src/ui/overlays/InventoryOverlay.tsx`
- Modify: `apps/web/src/ui/overlays/OverlayHost.tsx` (render the rebuilt body from `useSessionCtx`)
- Test: `apps/web/src/ui/overlays/InventoryOverlay.test.tsx`

**Interfaces:**
- Consumes: `useSessionCtx()` → `{ session, snapshot }`; `snapshot.projection.hero` as `{ backpack, equipment }` (same cast the current file uses — reuse the existing `ProjectedItemLike` shape and `CATEGORY_FILTER_ORDER`/`CategoryFilter` exports, keep them exported); `effectLabel` from `ui/labels.js`; the shared `ListDetail`.
- Produces: `InventoryOverlay(): JSX.Element` (props now come from context, not a bag). Dispatches `{ type: 'backpack', action, itemId }` for equip/unequip/use/drop/toggle-light.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/overlays/InventoryOverlay.test.tsx` rendering the overlay inside `UiProviders` with a stub `GuestSession` whose snapshot exposes a backpack of two items and an equipped weapon. Assert: (a) the equipped slot-grid shows the weapon glyph; (b) the pack list shows both item labels; (c) pressing `e` on the selected equipped item dispatches `{ type: 'backpack', action: 'unequip', itemId }` (spy on `session.dispatch`); (d) `d` dispatches `drop`. Build the stub session as `{ getSnapshot: () => snap, subscribe: () => () => {}, dispatch: vi.fn() } as unknown as GuestSession`.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -w @woven-deep/web -- InventoryOverlay.test.tsx
```
Expected: FAIL — new component/exports not present.

- [ ] **Step 3: Rebuild InventoryOverlay**

Rebuild on `ListDetail`: equipped gear → the `slots` grid (weapon/armor/shield/light/ring/amulet from `hero.equipment`); backpack → `items` (glyph, label, quantity, `EQ` badge when equipped); `renderDetail` → name, category/condition/identification meta, description, and contextual action `Button`s labeled with the bound key from `useSettingsCtx().keymap.byAction` (`e` equip/unequip, `u` use, `d` drop, `l` toggle-light). Keep the category filter (`CATEGORY_FILTER_ORDER`) + name/quantity sort as the `toolbar`. Bind the action keys via an `onKeyDown` on the container (not window) so they work only while focused in the drawer. Preserve `session.recordOnboardingIntent('open-inventory')` behavior — that already fires in the key dispatcher on open, so no change needed here.

- [ ] **Step 4: Run tests + typecheck + build**

```bash
npm run test -w @woven-deep/web -- InventoryOverlay.test.tsx
npm run typecheck -w @woven-deep/web
npm run build -w @woven-deep/web
```
Expected: PASS + clean.

- [ ] **Step 5: Update the inventory e2e**

Update `apps/web/e2e/interface.spec.ts` (and any inventory assertions in `guest-play.spec.ts`) to the new DOM: overlay is `[data-testid="overlay-inventory"]`, rows are `role="option"`, actions are buttons. Run:
```bash
npm run build -w @woven-deep/content && npm run build -w @woven-deep/engine && npm run build -w @woven-deep/web
npm run e2e -w @woven-deep/web -- interface.spec.ts
```
Expected: PASS. (If Playwright browsers aren't installed, run `npx playwright install` first.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/overlays/InventoryOverlay.tsx apps/web/src/ui/overlays/InventoryOverlay.test.tsx apps/web/src/ui/overlays/OverlayHost.tsx apps/web/e2e/interface.spec.ts
git commit -m "feat(web): rebuild inventory as drawer (slots+list+detail)"
```

---

### Task 8: Character sheet overlay

**Files:**
- Rebuild: `apps/web/src/ui/overlays/CharacterSheetOverlay.tsx`; Modify: `OverlayHost.tsx`
- Test: `apps/web/src/ui/overlays/CharacterSheetOverlay.test.tsx`

**Interfaces:**
- Consumes: `useSessionCtx()` → `snapshot.projection.hero` (`ProjectedHeroLike`: attributes, derived, health, maxHealth, sightRadius, hungerStage, conditions, equipment), `snapshot.projection.floor.town`, `snapshot.projection.metrics`; `DERIVED_STAT_NAMES`, `DerivedStatFormula`, `DerivedStatName` from `@woven-deep/engine`; `ProjectedItemLike` from `InventoryOverlay`.
- Produces: `CharacterSheetOverlay(): JSX.Element` — read-only, no dispatch.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/overlays/CharacterSheetOverlay.test.tsx` inside `UiProviders` + stub session; assert the six section headings render (Attributes, Derived stats, Vitals, Conditions, Equipment, Run statistics) and a sample attribute value + a condition (with its color style) appear.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -w @woven-deep/web -- CharacterSheetOverlay.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Rebuild the overlay**

Render the six sections with tokenized styling. Present Attributes/Derived/Vitals/Run-stats as clean definition rows (`grid grid-cols-2`), Conditions as tokened badges (keep the inline `condition.color`), Equipment as a compact slot list. Reuse `ListDetail` only if a list+detail reads better for equipment; otherwise a static section grid is fine (YAGNI — do not force ListDetail here). Same data reads as the current file.

- [ ] **Step 4: Run tests + typecheck**

```bash
npm run test -w @woven-deep/web -- CharacterSheetOverlay.test.tsx
npm run typecheck -w @woven-deep/web
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/overlays/CharacterSheetOverlay.tsx apps/web/src/ui/overlays/CharacterSheetOverlay.test.tsx apps/web/src/ui/overlays/OverlayHost.tsx
git commit -m "feat(web): rebuild character-sheet overlay in drawer"
```

---

### Task 9: Map & journal overlay

**Files:**
- Rebuild: `apps/web/src/ui/overlays/MapJournalOverlay.tsx`; Modify: `OverlayHost.tsx`
- Test: `apps/web/src/ui/overlays/MapJournalOverlay.test.tsx`

**Interfaces:**
- Consumes: `useSessionCtx()` → `snapshot.projection.floor` (cells/width/height/town/floorId), `.hero` (x,y), `.actors`, `.slots`; `snapshot.sightings.landmarks`; `snapshot.log`; `visibleForeground` from `cell-color.ts`; keep exported `JOURNAL_OBJECTIVE`; the shadcn `Tabs`.
- Produces: `MapJournalOverlay(): JSX.Element` — a right `Sheet` (from OverlayHost) with a `Tabs` (`map`/`journal`). Tab switching via `Tabs` (ArrowLeft/Right handled by Base UI), replacing the hand-rolled tablist.

- [ ] **Step 1: Write the failing test**

Create the test inside `UiProviders` + stub session; assert both tabs render (`role="tab"` named Map and Journal), the map pane renders a grid region, and switching to Journal shows a log entry. Use `user.keyboard('{ArrowRight}')` on the focused tab to assert Base UI tab switching.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -w @woven-deep/web -- MapJournalOverlay.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Rebuild the overlay**

Use `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`. Map pane: same fixed-cell grid render from `projection.floor` + `visibleForeground` + `sightings.landmarks` (reuse the existing rendering math). Journal pane: the full `snapshot.log` history + `JOURNAL_OBJECTIVE`. Tokenize; keep the map cells monospace. This overlay had real CSS (`styles.css` 732–759) — migrate those rules to token utilities/inline styles and mark the block for removal in Task 15.

- [ ] **Step 4: Run tests + typecheck**

```bash
npm run test -w @woven-deep/web -- MapJournalOverlay.test.tsx
npm run typecheck -w @woven-deep/web
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/overlays/MapJournalOverlay.tsx apps/web/src/ui/overlays/MapJournalOverlay.test.tsx apps/web/src/ui/overlays/OverlayHost.tsx
git commit -m "feat(web): rebuild map & journal overlay with Tabs"
```

---

### Task 10: Codex overlay

**Files:**
- Rebuild: `apps/web/src/ui/overlays/CodexOverlay.tsx`; Modify: `OverlayHost.tsx`
- Test: `apps/web/src/ui/overlays/CodexOverlay.test.tsx`

**Interfaces:**
- Consumes: `deriveCodexState`, `sortedClassEntries`, `CodexCategory`, `CodexEntry`, `Sightings` from `session/codex.js`; `usePack()`, `useSessionCtx()` (snapshot may be null on title — codex is `global` scope), `records` (Hall records) and `sightings`. Since codex needs `records` + `sightings` + optional snapshot + pack: read `pack` from `usePack`, `sightings`/`snapshot` from `useSessionCtx` (null-safe), and `records` — pass `records` through `UiProviders`? No: records are Hall data. Add `records` to the codex path by reading them where the host has them. **Decision:** thread `records` into `OverlayHost` as a prop `records: readonly StoredHallRecord[]` (App already holds them) and pass to the codex body; keep other overlays contextual.
- Produces: `CodexOverlay({ records }): JSX.Element` — a `Dialog` with `Tabs` (class/item/spell/monster in that order), each tab a `ListDetail` (undiscovered entries show `???` + silhouette glyph + unlock hint).

- [ ] **Step 1: Write the failing test**

Create the test with a stub pack + records + sightings; assert the four category tabs render in order and selecting an item shows its detail; an undiscovered entry shows `???`.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -w @woven-deep/web -- CodexOverlay.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Rebuild the overlay**

`Dialog` + `Tabs` for the four categories; each panel a `ListDetail` (entries → `{ glyph, glyphColor, label }`, `renderDetail` → name/glyph/description/first-seen or the spoiler-free `???`/unlock-hint variant). Preserve `unlockHintFor` logic and the spoiler-free undiscovered rendering. Thread `records` from `OverlayHost` (add the `records` prop to the host and to `App`'s `<OverlayHost>` usages).

- [ ] **Step 4: Run tests + typecheck**

```bash
npm run test -w @woven-deep/web -- CodexOverlay.test.tsx
npm run typecheck -w @woven-deep/web
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/overlays/CodexOverlay.tsx apps/web/src/ui/overlays/CodexOverlay.test.tsx apps/web/src/ui/overlays/OverlayHost.tsx apps/web/src/App.tsx
git commit -m "feat(web): rebuild codex overlay with Tabs + ListDetail"
```

---

### Task 11: Settings overlay

**Files:**
- Rebuild: `apps/web/src/ui/overlays/SettingsOverlay.tsx`; Modify: `OverlayHost.tsx`
- Test: `apps/web/src/ui/overlays/SettingsOverlay.test.tsx`

**Interfaces:**
- Consumes: `useSettingsCtx()` → `{ settings, onChange, keymap }`; `onClearGuestSession` (thread from context or host — App owns it; add `onClearGuestSession` to `OverlayHost` props like `records`); `ACTION_IDS`, `ACTION_LABELS`, `bindingConflict`, `chordKey`, `chordReserved` from settings; shadcn `Select`/`Switch`/`Input`/`Label`/`Button`.
- Produces: `SettingsOverlay({ onClearGuestSession }): JSX.Element` — a `Dialog`. Sections: Font scale (`Select` `[1,1.15,1.3,1.5]`), Theme (`Select` `tapestry`/`high-contrast`), Onboarding hints (`Switch`), Reduce motion (`Select` system/on/off), Key bindings (press-to-rebind with conflict/hardwired refusal, same logic), Clear guest session (type "clear" → `Input` + `Button`).

- [ ] **Step 1: Write the failing test**

Create the test asserting: changing font-scale calls `onChange` with the new `fontScale`; a rebind that collides is refused (use `bindingConflict` path — press a chord already bound and assert no `onChange` for that action); the Clear button is disabled until the confirm input reads `clear`.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -w @woven-deep/web -- SettingsOverlay.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Rebuild the overlay**

Rebuild the six sections on shadcn form controls, preserving the exact rebinding logic (`bindingConflict`/`chordReserved`/`chordKey`) and the "type clear" guard. Keep every setting field name identical so `onChange` payloads match `Settings`.

- [ ] **Step 4: Run tests + typecheck**

```bash
npm run test -w @woven-deep/web -- SettingsOverlay.test.tsx
npm run typecheck -w @woven-deep/web
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/overlays/SettingsOverlay.tsx apps/web/src/ui/overlays/SettingsOverlay.test.tsx apps/web/src/ui/overlays/OverlayHost.tsx apps/web/src/App.tsx
git commit -m "feat(web): rebuild settings overlay on shadcn form controls"
```

---

### Task 12: Help overlay

**Files:**
- Rebuild: `apps/web/src/ui/overlays/HelpOverlay.tsx`; Modify: `OverlayHost.tsx`
- Test: `apps/web/src/ui/overlays/HelpOverlay.test.tsx`

**Interfaces:**
- Consumes: `useSettingsCtx().keymap`, `usePack()`; `TILE_DEFINITIONS` from engine; `HINTS` from `session/onboarding.js`; `ACTION_IDS`, `ACTION_LABELS`, `chordKey` from settings; `humanize` from `ui/labels.js`.
- Produces: `HelpOverlay(): JSX.Element` — a `Dialog` with four sections: Controls (action → bound chord table), Glyph legend, Mechanics notes, Guidance.

- [ ] **Step 1: Write the failing test**

Assert the Controls section lists an action with its default chord (e.g. Inventory → `i`), and the glyph legend renders at least one entry.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -w @woven-deep/web -- HelpOverlay.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Rebuild the overlay**

Tokenized `Dialog`; keep the four sections and all data reads. Controls table via `ACTION_IDS`/`ACTION_LABELS`/`keymap.byAction`/`chordKey`.

- [ ] **Step 4: Run tests + typecheck**

```bash
npm run test -w @woven-deep/web -- HelpOverlay.test.tsx
npm run typecheck -w @woven-deep/web
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/overlays/HelpOverlay.tsx apps/web/src/ui/overlays/HelpOverlay.test.tsx apps/web/src/ui/overlays/OverlayHost.tsx
git commit -m "feat(web): rebuild help overlay dialog"
```

---

### Task 13: ⌘K command palette

**Files:**
- Create: `apps/web/src/ui/CommandPalette.tsx`
- Modify: `apps/web/src/ui/PlayScreen.tsx` (mount + Cmd/Ctrl+K toggle)
- Test: `apps/web/src/ui/CommandPalette.test.tsx`

**Interfaces:**
- Consumes: `useSessionCtx()` (dispatch + snapshot for context-availability), `useSettingsCtx().keymap`; `ACTION_IDS`, `ACTION_LABELS` from settings; the overlay open handler (`onOpenOverlay`) and intent dispatch; shadcn `Command` (cmdk) inside a `Dialog`.
- Produces: `CommandPalette({ open, onOpenChange, onOpenOverlay, isTownContext, tradeAvailable }): JSX.Element`. Selecting an entry either opens the matching overlay (`inventory`/`character-sheet`/`map-journal`/`codex`/`settings`/`help`) or dispatches the matching `PlayerIntent` (`wait`/`rest`/`pickup`/`descend`/`ascend`/`house`/`trade-open`). Each entry shows its bound chord from `keymap.byAction`. Entries not available in the current context (e.g. `trade` when no merchant adjacent) are omitted.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/CommandPalette.test.tsx`: render open, inside `UiProviders` + stub session; type "inv", assert the Inventory entry is filtered in and shows its chord `i`; press Enter → `onOpenOverlay('inventory')` called and `onOpenChange(false)`. Type "rest" → Enter dispatches `{ type: 'rest' }`.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -w @woven-deep/web -- CommandPalette.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the palette**

Build a `Dialog` wrapping `Command`/`CommandInput`/`CommandList`/`CommandGroup`/`CommandItem`. Derive the entry list from a static action→handler map (overlay-openers vs intent-dispatchers), filtering out context-unavailable actions (`trade-open` only when `tradeAvailable`, `house` only in town, movement actions excluded — the palette is for verbs, not steps). Show `chordKey(keymap.byAction[action])` as each item's trailing hint. On select, invoke the handler and close.

- [ ] **Step 4: Wire Cmd/Ctrl+K in PlayScreen**

In `PlayScreen.tsx`, add local `const [paletteOpen, setPaletteOpen] = useState(false)` and a `keydown` handler (window-level, guarded to fire only when no overlay/house/trade/decision is active) that opens the palette on `(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'` with `preventDefault`. Render `<CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenOverlay={onOpenOverlay} isTownContext={projection.floor.town} tradeAvailable={/* merchant adjacency or projection.trade */} />`. Keep this handler separate from `createKeyDispatcher` (it is a UI concern, not a game intent).

- [ ] **Step 5: Run tests + typecheck + build**

```bash
npm run test -w @woven-deep/web -- CommandPalette.test.tsx
npm run typecheck -w @woven-deep/web
npm run build -w @woven-deep/web
```
Expected: PASS + clean.

- [ ] **Step 6: Add an e2e smoke for the palette**

Add to `apps/web/e2e/interface.spec.ts`: open the palette with `Meta+K` (or `Control+K`), type "map", press Enter, assert the map/journal overlay opens. Run:
```bash
npm run build -w @woven-deep/content && npm run build -w @woven-deep/engine && npm run build -w @woven-deep/web
npm run e2e -w @woven-deep/web -- interface.spec.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui/CommandPalette.tsx apps/web/src/ui/CommandPalette.test.tsx apps/web/src/ui/PlayScreen.tsx apps/web/e2e/interface.spec.ts
git commit -m "feat(web): add ⌘K command palette"
```

---

### Task 14: Restyle supporting in-run screens + re-skin title/chargen

**Files:**
- Modify: `apps/web/src/ui/screens/{HallScreen,HouseScreen,TradeScreen,ConclusionScreen,SignInScreen,TitleScreen,ChargenScreen}.tsx`
- Modify: `apps/web/src/ui/PlayScreen.tsx` (DecisionPrompt) if it uses retired helpers
- Test: update `apps/web/src/ui/screens/*.test.tsx` where they exist; add a `TradeScreen` interaction test if none

**Interfaces:**
- Consumes: same session/props each screen already uses; shadcn `Button`/`Input`/`Dialog`/`ListDetail` as fitting; token utilities.
- Produces: visually consistent screens on the new system. Behavior/flow unchanged (title + chargen are **re-skin only** — full chargen redesign is sub-project 2). `HouseScreen`/`TradeScreen`/`DecisionPrompt` no longer depend on `focus-trap.ts`/`roving-focus.ts`; where they were modal, wrap in `Dialog`; where they were lists, use `ListDetail`.

- [ ] **Step 1: Write/adjust failing tests**

For each screen with an existing test, update the selectors/assertions to the tokenized DOM and run to confirm they fail against the old markup first. Add a `TradeScreen` test: buying an item dispatches `{ type: 'trade-buy', itemId, quantity }`.

- [ ] **Step 2: Restyle each screen**

Replace hand-CSS classes with token utilities and shadcn controls. Keep every dispatch/callback and `data-testid` identical. `HouseScreen` (deposit/withdraw) and `TradeScreen` (buy/sell/service) become `Dialog`-framed with `ListDetail` panes; `HallScreen`/`ConclusionScreen`/`SignInScreen` get tokenized layout + `Button`/`Input`. `TitleScreen`/`ChargenScreen`: swap chrome classes for tokens and shadcn `Button`/`Input` only — do not change the step flow.

- [ ] **Step 3: Run the web suite + typecheck + build**

```bash
npm run test -w @woven-deep/web
npm run typecheck -w @woven-deep/web
npm run build -w @woven-deep/web
```
Expected: PASS + clean (full unit suite green).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/ui/screens apps/web/src/ui/PlayScreen.tsx
git commit -m "feat(web): restyle in-run screens + re-skin title/chargen"
```

---

### Task 15: Retire dead infra + CSS, final e2e pass

**Files:**
- Delete (if unreferenced): `apps/web/src/ui/overlays/{OverlayScaffold.tsx,focus-trap.ts,overlay-components.tsx}`, `apps/web/src/ui/screens/roving-focus.ts`, `apps/web/src/ui/overlays/OverlayErrorBoundary.tsx` (only if no longer used; otherwise keep and tokenize its `.overlay-error`)
- Modify: `apps/web/src/styles.css` (remove chrome blocks; keep grid/effects keep-zone), `apps/web/src/ui/panels.tsx` (remove now-dead exports)
- Modify: `apps/web/e2e/*.spec.ts` (all six specs)

**Interfaces:**
- Consumes: nothing new. Produces: a clean tree with no dangling references to retired modules; all e2e green.

- [ ] **Step 1: Find and remove dead references**

```bash
cd apps/web && npx tsc -p tsconfig.json --noEmit 2>&1 | head -40; cd ../..
grep -rn "OverlayScaffold\|useDialogFocusTrap\|overlay-components\|roving-focus\|OverlayBodyProps" apps/web/src || echo "no references"
```
Delete each retired file only after `grep` shows zero remaining imports. If `roving-focus`/`OverlayErrorBoundary` still have consumers, keep them.

- [ ] **Step 2: Remove dead chrome CSS**

In `apps/web/src/styles.css`, delete the chrome blocks now replaced by Tailwind (frame vocabulary ~27–40, `.framed*` ~68–100, triptych ~492–515, hint-strip ~517–529, status/hero/threat/log panel rules ~531–596, `.threat-popover` ~614–624, map-journal ~732–759, and any overlay class rules). **Keep** the grid/effects keep-zone (`:root` material ~17–25, playfield/cells/materials/effects ~189–489, `.sr-only` ~598–611, motion media queries) and any rule still referenced by a kept component (chargen/hall rules only if Task 14 left classes in place — prefer to have removed them). Verify nothing visual in the grid changed.

- [ ] **Step 3: Update all e2e specs**

Update `auth.spec.ts`, `guest-play.spec.ts`, `interface.spec.ts`, `town-loop.spec.ts`, `run-lifecycle.spec.ts`, `polish.spec.ts` to the new DOM (overlay testids `overlay-<id>`, `role="option"` rows, `role="tab"` tabs, `Sheet`/`Dialog` roles, palette). Run the full e2e suite:
```bash
npm run build -w @woven-deep/content && npm run build -w @woven-deep/engine && npm run build -w @woven-deep/web
npm run e2e -w @woven-deep/web
```
Expected: all specs PASS.

- [ ] **Step 4: Full green + typecheck + build**

```bash
npm run test -w @woven-deep/web
npm run typecheck -w @woven-deep/web
npm run build -w @woven-deep/web
```
Expected: PASS + clean + build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/e2e
git commit -m "chore(web): retire hand-rolled overlay infra + dead chrome CSS"
```

---

## Self-Review

**1. Spec coverage:**
- Foundation (Tailwind v4 + shadcn/Base UI + cmdk + tokens + Grimoire theme) → Tasks 1–2. ✅
- Providers/boundary cleanup → Task 3. ✅
- Single overlay host + Escape/focus coordination → Task 4. ✅
- Play-screen Layout A (grid + right rail + full-width log + minimap) → Task 5. ✅
- Six overlays rebuilt (inventory structure 1; character; map/journal Tabs; codex Dialog+Tabs; settings form controls; help) → Tasks 6–12. ✅
- ⌘K palette → Task 13. ✅
- Supporting in-run screens restyled + title/chargen re-skin → Task 14. ✅
- Retire hand-rolled infra + dead CSS, e2e updates → Task 15. ✅
- Untouched: engine/content/session/grid — enforced by Global Constraints + each task's file list. ✅

**2. Placeholder scan:** No "TBD/TODO/handle edge cases". Codegen steps (shadcn CLI) are concrete commands with expected outputs; per-overlay rebuild steps name exact data sources and dispatch payloads and carry real test assertions rather than reproducing 200+ lines of JSX (the shared logic is fully shown in ListDetail/OverlayHost/providers/palette; the per-overlay work is data mapping onto that shared code). This is intentional to keep the plan navigable; each overlay task is independently testable and reviewable.

**3. Type consistency:** `OverlayHost` prop shape (`overlay`, `onClose`, `isPlayActive`, plus `records`/`onClearGuestSession` added in Tasks 10–11) is consistent across Tasks 4/10/11. `ListDetail`'s `ListDetailItem`/`ListDetailProps` are defined in Task 6 and consumed unchanged in Tasks 7/10. `useSessionCtx()` returns `{ session, snapshot } | null` consistently (Tasks 3, 7–13). Intent payloads match `PlayerIntent` (`backpack`/`rest`/`trade-buy`) verbatim.

Note for the executor: `OverlayHost` gains two props across later tasks (`records` in Task 10, `onClearGuestSession` in Task 11). When implementing Task 4, add these as optional from the start (`records?`, `onClearGuestSession?`) to avoid churn, wiring them in `App`'s `<OverlayHost>` usages then.
