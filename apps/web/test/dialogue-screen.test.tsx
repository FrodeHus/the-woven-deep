import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection } from '@woven-deep/engine';
import { DialogueScreen } from '../src/ui/screens/DialogueScreen.js';

/**
 * `DialogueScreen` only reads `npcById`/`dialogueById` (both plain `pack.entries` lookups) and
 * `adjacentDialogueNpc` (which reads `hero.{x,y}` and each actor's
 * `{actorId, contentId, x, y, disposition}`) -- a hand-built pack/projection exercises it fully,
 * mirroring `merchant-adjacency.test.ts`'s posture for `adjacentMerchant`/`tradeIsAvailable`.
 * Deliberately NOT drawn from the bundled demo content (no fixture may change for this task): a
 * dialogue-bearing NPC does not exist in the bundled content yet.
 */

const NPC_ID = 'npc.test-lampwright';
const DIALOGUE_ID = 'dialogue.test-lampwright';

const pack = {
  entries: [
    {
      kind: 'npc',
      id: NPC_ID,
      name: 'Tomas',
      dialogueId: DIALOGUE_ID,
    },
    {
      kind: 'dialogue',
      id: DIALOGUE_ID,
      greeting: 'Well met, traveler.',
      topics: [
        {
          id: 'ask-name',
          prompt: 'Ask their name',
          response: 'I am Tomas.',
          reveals: ['ask-work'],
        },
        {
          id: 'ask-work',
          prompt: 'What do you do?',
          response: 'I sell lamps and oil.',
          consequence: { kind: 'open-trade' },
        },
        {
          id: 'ask-lore',
          prompt: 'Tell me about the ruins',
          response: 'Old bones, old fire.',
          consequence: { kind: 'reveal-lore', contentId: 'monster.cave-rat' },
        },
        {
          id: 'flatter',
          prompt: 'Compliment them',
          response: 'Kind of you to say.',
          consequence: { kind: 'reputation', factionId: 'faction.test', amount: 5 },
          once: true,
        },
      ],
    },
  ],
} as unknown as CompiledContentPack;

function projectionWithNpc(): GameplayProjection {
  return {
    hero: { x: 5, y: 5 },
    actors: [
      {
        actorId: 'actor.tomas',
        contentId: NPC_ID,
        x: 6,
        y: 5,
        disposition: 'neutral',
      },
    ],
  } as unknown as GameplayProjection;
}

function projectionWithoutNpc(): GameplayProjection {
  return { hero: { x: 5, y: 5 }, actors: [] } as unknown as GameplayProjection;
}

describe('DialogueScreen', () => {
  it('renders "No one to talk to." when no dialogue-bearing NPC is adjacent', () => {
    render(
      <DialogueScreen
        pack={pack}
        projection={projectionWithoutNpc()}
        onDispatch={vi.fn()}
        onRevealLore={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('No one to talk to.')).toBeInTheDocument();
  });

  it('shows the greeting and only the topics reachable from it', () => {
    render(
      <DialogueScreen
        pack={pack}
        projection={projectionWithNpc()}
        onDispatch={vi.fn()}
        onRevealLore={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Well met, traveler.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask their name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tell me about the ruins' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compliment them' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'What do you do?' })).not.toBeInTheDocument();
  });

  it('choosing a topic shows its response and reveals its follow-up topic', async () => {
    const user = userEvent.setup();
    render(
      <DialogueScreen
        pack={pack}
        projection={projectionWithNpc()}
        onDispatch={vi.fn()}
        onRevealLore={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Ask their name' }));

    expect(screen.getByText('I am Tomas.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What do you do?' })).toBeInTheDocument();
  });

  it('a reveal-lore topic calls onRevealLore with the consequence content id', async () => {
    const user = userEvent.setup();
    const onRevealLore = vi.fn();
    render(
      <DialogueScreen
        pack={pack}
        projection={projectionWithNpc()}
        onDispatch={vi.fn()}
        onRevealLore={onRevealLore}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Tell me about the ruins' }));

    expect(onRevealLore).toHaveBeenCalledWith('monster.cave-rat');
    expect(screen.getByText('Old bones, old fire.')).toBeInTheDocument();
  });

  it('an open-trade topic dispatches trade-open and closes the overlay', async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const onClose = vi.fn();
    render(
      <DialogueScreen
        pack={pack}
        projection={projectionWithNpc()}
        onDispatch={onDispatch}
        onRevealLore={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Ask their name' }));
    await user.click(screen.getByRole('button', { name: 'What do you do?' }));

    expect(onDispatch).toHaveBeenCalledWith({ type: 'trade-open' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a reputation topic dispatches dialogue-consequence with the npc actor id and topic id', async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(
      <DialogueScreen
        pack={pack}
        projection={projectionWithNpc()}
        onDispatch={onDispatch}
        onRevealLore={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Compliment them' }));

    expect(onDispatch).toHaveBeenCalledWith({
      type: 'dialogue-consequence',
      npcActorId: 'actor.tomas',
      topicId: 'flatter',
    });
  });

  it('a chosen once topic greys out (disappears from the offered list)', async () => {
    const user = userEvent.setup();
    render(
      <DialogueScreen
        pack={pack}
        projection={projectionWithNpc()}
        onDispatch={vi.fn()}
        onRevealLore={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Compliment them' }));

    expect(screen.queryByRole('button', { name: 'Compliment them' })).not.toBeInTheDocument();
  });

  it('Leave calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DialogueScreen
        pack={pack}
        projection={projectionWithNpc()}
        onDispatch={vi.fn()}
        onRevealLore={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Leave' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
