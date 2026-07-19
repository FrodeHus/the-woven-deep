import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** Maps a lowercase key (e.g. `'e'`, `'u'`) to the action it runs against the selected item. */
export type ItemActionKeyMap<T> = Readonly<Record<string, (item: T) => void>>;

/**
 * Builds an `onKeyDown` handler for "press a bound key to run an action on the selected item"
 * interactions, such as a backpack drawer's equip/use/drop/refuel bindings. Looks up
 * `event.key.toLowerCase()` in `actions` and, when both a selected item and a bound handler exist,
 * calls the handler with that item. An unbound key, or no selection at all, is a no-op -- callers
 * do not need to guard against either case themselves. Never calls `event.preventDefault()`,
 * leaving that decision (and any keys the caller wants to handle itself, e.g. a filter or sort
 * toggle) to the caller.
 */
export function useItemActionKeys<T>(
  selected: T | undefined,
  actions: ItemActionKeyMap<T>,
): (event: ReactKeyboardEvent) => void {
  return (event: ReactKeyboardEvent): void => {
    if (!selected) return;
    const action = actions[event.key.toLowerCase()];
    if (!action) return;
    action(selected);
  };
}
