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

describe('parseClientMessage — temper intent', () => {
  it('validates the temper intent over the wire', () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'command',
          commandId: 'c.1',
          expectedRevision: 1,
          intent: { type: 'temper', attribute: 'wits' },
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'command',
          commandId: 'c.1',
          expectedRevision: 1,
          intent: { type: 'temper', attribute: 'luck' },
        }),
      ).ok,
    ).toBe(false);
  });
});

describe('parseClientMessage — surrender', () => {
  it('accepts a well-formed surrender', () => {
    const parsed = parseClientMessage(
      JSON.stringify({ type: 'surrender', commandId: 'c.1', expectedRevision: 7 }),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value).toEqual({
      type: 'surrender',
      commandId: 'c.1',
      expectedRevision: 7,
    });
  });

  it('rejects a surrender missing its envelope fields', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'surrender' })).ok).toBe(false);
  });
});
