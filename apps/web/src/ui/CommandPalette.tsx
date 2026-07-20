import type { JSX } from 'react';
import { ACTION_LABELS, chordKey, type ActionId } from '../session/settings.js';
import type { PlayerIntent } from '../session/intents.js';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from './components/command.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/dialog.js';
import { OVERLAY_REGISTRY, type OverlayId } from './overlays/registry.js';
import { useSessionCtx, useSettingsCtx } from './providers.js';
import type { OverlayActionId } from './KeyRouter.js';

const OVERLAY_ENTRIES: readonly OverlayId[] = [
  'inventory',
  'character-sheet',
  'map-journal',
  'codex',
  'settings',
  'help',
];

/** Static action -> intent map for every non-overlay verb the palette can dispatch. Deliberately
 * excludes every `move.*` action -- the palette is a discovery surface for VERBS, not a parallel
 * way to take a step (see the task brief). `house`/`trade` are further gated at render time by
 * `isTownContext`/`tradeAvailable`. */
const INTENT_ENTRIES: Readonly<
  Record<'wait' | 'rest' | 'pickup' | 'descend' | 'ascend' | 'house' | 'trade', PlayerIntent>
> = {
  wait: { type: 'wait' },
  rest: { type: 'rest' },
  pickup: { type: 'pickup' },
  descend: { type: 'descend' },
  ascend: { type: 'ascend' },
  house: { type: 'house' },
  trade: { type: 'trade-open' },
};

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenOverlay: (overlay: OverlayActionId) => void;
  readonly isTownContext: boolean;
  readonly tradeAvailable: boolean;
}

/**
 * A keyboard-first, filterable list of every verb the keymap can resolve -- opened with Cmd/Ctrl+K
 * from `PlayScreen`. This is a DISCOVERY surface over the same intents/overlays the keymap already
 * routes to, never a parallel command path: every entry here calls the exact same
 * `onOpenOverlay`/`session.dispatch` a keypress would.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onOpenOverlay,
  isTownContext,
  tradeAvailable,
}: Readonly<CommandPaletteProps>): JSX.Element {
  const sessionCtx = useSessionCtx();
  const { keymap } = useSettingsCtx();

  const hint = (action: ActionId): string | undefined => {
    const chord = keymap.byAction[action];
    return chord ? chordKey(chord) : undefined;
  };

  const runOverlay = (overlay: OverlayId): void => {
    onOpenOverlay(overlay);
    onOpenChange(false);
  };

  const runIntent = (intent: PlayerIntent): void => {
    sessionCtx?.session.dispatch(intent);
    onOpenChange(false);
  };

  const intentActions: readonly (keyof typeof INTENT_ENTRIES)[] = [
    'wait',
    'rest',
    'pickup',
    'descend',
    'ascend',
    ...(isTownContext ? (['house'] as const) : []),
    ...(tradeAvailable ? (['trade'] as const) : []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-lg" data-testid="command-palette">
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
        </DialogHeader>
        {/* A plain case-insensitive substring filter rather than cmdk's default fuzzy scoring --
         * this is a short, fixed verb list, and fuzzy subsequence matching produces surprising
         * false positives here (e.g. "rest" is a letter-subsequence of "Character sheet"),
         * which a discovery surface should never do. */}
        <Command
          filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder="Type a command..." />
          <CommandList>
            <CommandEmpty>No matching command.</CommandEmpty>
            <CommandGroup heading="Screens">
              {OVERLAY_ENTRIES.map((overlay) => {
                const action = OVERLAY_REGISTRY[overlay].action;
                const label = ACTION_LABELS[action];
                const shortcut = hint(action);
                return (
                  <CommandItem key={overlay} value={label} onSelect={() => runOverlay(overlay)}>
                    <span>{label}</span>
                    {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandGroup heading="Actions">
              {intentActions.map((action) => {
                const label = ACTION_LABELS[action];
                const shortcut = hint(action);
                return (
                  <CommandItem
                    key={action}
                    value={label}
                    onSelect={() => runIntent(INTENT_ENTRIES[action])}
                  >
                    <span>{label}</span>
                    {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
