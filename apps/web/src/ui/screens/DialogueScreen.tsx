import { useMemo, useState, type JSX } from 'react';
import type { CompiledContentPack, DialogueTopic } from '@woven-deep/content';
import type { GameplayProjection } from '@woven-deep/engine';
import { dialogueById, npcById } from '@woven-deep/session-core';
import type { PlayerIntent } from '../../session/intents.js';
import { adjacentDialogueNpc } from '../../session/projection-view.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/dialog.js';

export interface DialogueScreenProps {
  readonly pack: CompiledContentPack;
  readonly projection: GameplayProjection;
  readonly onDispatch: (intent: PlayerIntent) => void;
  readonly onRevealLore: (contentId: string) => void;
  readonly onClose: () => void;
}

/** The topic ids reachable straight from the greeting -- every topic NOT named in some other
 * topic's `reveals`. A topic that is itself never `reveals`-gated by anything else is, by
 * definition, offered up front; everything else stays hidden until the topic that names it is
 * chosen. */
function greetingTopicIds(topics: readonly DialogueTopic[]): ReadonlySet<string> {
  const gated = new Set<string>();
  for (const topic of topics) {
    for (const id of topic.reveals ?? []) gated.add(id);
  }
  return new Set(topics.filter((topic) => !gated.has(topic.id)).map((topic) => topic.id));
}

/**
 * The client conversation screen: a self-contained overlay body (mirrors `CodexOverlay`, not
 * `TradeScreen`'s snapshot-driven presence) that resolves its own target -- the adjacent, same-
 * floor, non-hostile NPC actor whose content entry carries a `dialogueId` (`adjacentDialogueNpc`)
 * -- and walks that NPC's authored dialogue tree from the client `pack`. Renders "No one to talk
 * to." with a close control when no such NPC is adjacent (a race between the `talk` keypress and
 * the NPC stepping away, or the overlay surviving a stale re-render).
 *
 * `revealed`/`chosen` are per-open React state, seeded fresh every mount: `revealed` starts at the
 * topics reachable from the greeting (`greetingTopicIds`), `chosen` starts empty. A topic is
 * offered once it is in `revealed` and, if `once`, not yet in `chosen` -- choosing an `once` topic
 * therefore removes it from the offered list for the rest of this conversation (the "greys out
 * after use" the brief describes); a fresh open (e.g. leaving and re-approaching) always starts
 * over, since the server-side one-time reputation guard (`dialogue.ts`'s
 * `dialogueConsequencesApplied`) is the actual authority, not this client-side hint.
 *
 * Choosing a topic reveals its `reveals`, marks it `chosen`, shows its `response` as the panel's
 * current text, and fires its `consequence`: `reveal-lore` calls `onRevealLore` (a client-only
 * codex insert, the conversation stays open); `open-trade` dispatches the engine `trade-open`
 * intent and closes this overlay (trade owns the screen from here); `reputation` dispatches the
 * client-only `dialogue-consequence` intent, which the command builder maps onto the engine's
 * `DialogueConsequenceCommand` (the server re-derives/re-validates the actual reputation change).
 */
export function DialogueScreen({
  pack,
  projection,
  onDispatch,
  onRevealLore,
  onClose,
}: DialogueScreenProps): JSX.Element {
  const npcActor = adjacentDialogueNpc(projection, pack);
  const npc = npcActor?.contentId ? npcById(pack, npcActor.contentId) : undefined;
  const dialogue = npc?.dialogueId ? dialogueById(pack, npc.dialogueId) : undefined;

  const initialRevealed = useMemo(
    () => (dialogue ? greetingTopicIds(dialogue.topics) : new Set<string>()),
    [dialogue],
  );
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(initialRevealed);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [lastResponse, setLastResponse] = useState<string | null>(null);

  const handleClose = (): void => onClose();
  const onOpenChange = (open: boolean): void => {
    if (!open) handleClose();
  };

  if (!npcActor || !npc || !dialogue) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Talk</DialogTitle>
          </DialogHeader>
          <p>No one to talk to.</p>
          <button type="button" onClick={handleClose} className="mt-2 self-start">
            Leave
          </button>
        </DialogContent>
      </Dialog>
    );
  }

  const npcActorId = npcActor.actorId;

  function chooseTopic(topic: DialogueTopic): void {
    setRevealed((prev) => new Set([...prev, ...(topic.reveals ?? [])]));
    setChosen((prev) => new Set([...prev, topic.id]));
    setLastResponse(topic.response);

    const { consequence } = topic;
    if (!consequence) return;
    switch (consequence.kind) {
      case 'reveal-lore':
        onRevealLore(consequence.contentId);
        return;
      case 'open-trade':
        onDispatch({ type: 'trade-open' });
        onClose();
        return;
      case 'reputation':
        onDispatch({
          type: 'dialogue-consequence',
          npcActorId,
          topicId: topic.id,
        });
        return;
    }
  }

  const availableTopics = dialogue.topics.filter(
    (topic) => revealed.has(topic.id) && !(topic.once && chosen.has(topic.id)),
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-center sm:text-center">
          <span aria-hidden="true" className="text-subtle">
            ─── ❦ ───
          </span>
          <DialogTitle className="text-center">{npc.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="border-y border-dotted border-subtle py-2 text-sm text-fg">
            {lastResponse ?? dialogue.greeting}
          </p>
          <ul className="flex flex-col gap-1.5">
            {availableTopics.map((topic) => (
              <li key={topic.id}>
                <button
                  type="button"
                  className="w-full cursor-pointer border border-line bg-raised px-2.5 py-1.5 text-left text-sm text-fg hover:border-accent"
                  onClick={() => chooseTopic(topic)}
                >
                  {topic.prompt}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={handleClose}
            className="self-start border border-line bg-raised px-2.5 py-1 text-sm text-subtle hover:border-accent"
          >
            Leave
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
