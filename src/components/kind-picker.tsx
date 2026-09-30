'use client';

import type { MediaKind } from '../media/kinds';
import { MEDIA, MEDIA_KINDS } from '../media/kinds';
import { acceptList, extensionsFor } from '../formats/extensions';
import { Icon } from './icons';
import { Segmented } from './ui/segmented';

const ICON = { text: 'doc', image: 'image', audio: 'audio' } as const;

/** What is to be compared, chosen before the files: documents, images or audio. */
export function KindPicker({ value, onChange, className = '' }: { value: MediaKind; onChange(k: MediaKind): void; className?: string }) {
  return (
    <Segmented
      className={`text kind-picker ${className}`}
      label="What are you comparing?"
      value={value}
      onChange={onChange}
      segments={MEDIA_KINDS.map((k) => ({
        value: k,
        tip: MEDIA[k].formats,
        content: (
          <>
            <Icon name={ICON[k]} />
            <span>{MEDIA[k].label}</span>
          </>
        ),
      }))}
    />
  );
}

/** The file dialog's filter for a kind. */
export const acceptFor = (k: MediaKind) => acceptList(extensionsFor(k));
