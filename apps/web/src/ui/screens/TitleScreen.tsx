import type { JSX } from 'react';
import { decodeActiveRun } from '@woven-deep/engine';
import { SAVE_KEY, type SessionStorageLike } from '../../session/storage.js';
import { useListNavigation } from './roving-focus.js';

export interface TitleScreenProps {
  readonly storage: SessionStorageLike;
  readonly onEnterTheDeep: () => void;
  readonly onContinue: () => void;
  readonly onHall: () => void;
}

/**
 * Whether Continue should be offered: only when storage holds a save AND that save decodes
 * cleanly through the real engine codec. A corrupt or schema-incompatible save must NOT surface
 * Continue — `GuestSession` would discard it anyway (with a save-discarded notice) once
 * constructed, but the title screen shouldn't invite the player into that path in the first
 * place. Probed fresh on every render so a save that appears between renders (there is no such
 * path today, but the check is cheap) is picked up.
 */
function canContinue(storage: SessionStorageLike): boolean {
  const raw = storage.get(SAVE_KEY);
  if (raw === null) return false;
  try {
    decodeActiveRun(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * The guest's landing screen inside `/play`: a keyboard-first menu of "Enter the Deep" (starts
 * chargen), "Continue" (resumes a decodable save — omitted otherwise), and "Hall of Records"
 * (always offered; its content is wired up in a later task). Reuses the same roving-focus
 * listbox convention as the chargen wizard's option lists.
 */
export function TitleScreen({ storage, onEnterTheDeep, onContinue, onHall }: TitleScreenProps): JSX.Element {
  const options: readonly { readonly key: string; readonly label: string; readonly onSelect: () => void }[] = [
    { key: 'enter', label: 'Enter the Deep', onSelect: onEnterTheDeep },
    ...(canContinue(storage) ? [{ key: 'continue', label: 'Continue', onSelect: onContinue }] : []),
    { key: 'hall', label: 'Hall of Records', onSelect: onHall },
  ];
  const { selectedIndex, registerItem, handleArrowKeys } = useListNavigation(options.length);

  return (
    <section aria-label="Title" className="title-screen">
      <p className="eyebrow">The Woven Deep</p>
      <h1>The Woven Deep</h1>
      <div role="listbox" aria-label="Title menu" className="title-menu" onKeyDown={handleArrowKeys}>
        {options.map((option, index) => (
          <button
            key={option.key}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            ref={registerItem(index)}
            className={index === selectedIndex ? 'title-option title-option--focused' : 'title-option'}
            onClick={option.onSelect}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
