import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../src/ws-protocol.js';

describe('parseClientMessage — offer intent', () => {
  it('accepts a well-formed offer intent over the wire', () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'command',
          commandId: 'c.1',
          expectedRevision: 1,
          intent: { type: 'offer', itemId: 'item.scroll.0001' },
        }),
      ).ok,
    ).toBe(true);
  });

  it('rejects a malformed offer intent over the wire', () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'command',
          commandId: 'c.1',
          expectedRevision: 1,
          intent: { type: 'offer' },
        }),
      ).ok,
    ).toBe(false);
  });
});
