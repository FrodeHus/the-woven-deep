import { describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useItemActionKeys } from './useItemActionKeys.js';

function keyEvent(key: string): ReactKeyboardEvent {
  return { key } as ReactKeyboardEvent;
}

describe('useItemActionKeys', () => {
  it('fires the bound action with the selected item', () => {
    const item = { id: 'item.torch' };
    const onUse = vi.fn();
    const handleKeyDown = useItemActionKeys(item, { u: onUse });

    handleKeyDown(keyEvent('u'));

    expect(onUse).toHaveBeenCalledWith(item);
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it('lowercases the pressed key before matching the map', () => {
    const item = { id: 'item.torch' };
    const onUse = vi.fn();
    const handleKeyDown = useItemActionKeys(item, { u: onUse });

    handleKeyDown(keyEvent('U'));

    expect(onUse).toHaveBeenCalledWith(item);
  });

  it('ignores a key that is not bound in the map', () => {
    const item = { id: 'item.torch' };
    const onUse = vi.fn();
    const handleKeyDown = useItemActionKeys(item, { u: onUse });

    handleKeyDown(keyEvent('z'));

    expect(onUse).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no selected item, even for a bound key', () => {
    const onUse = vi.fn();
    const handleKeyDown = useItemActionKeys(undefined, { u: onUse });

    handleKeyDown(keyEvent('u'));

    expect(onUse).not.toHaveBeenCalled();
  });
});
