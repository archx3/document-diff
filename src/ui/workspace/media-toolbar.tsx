import type { MouseEvent, ReactNode } from 'react';
import { AudioModes, AudioNav, AudioZoom } from '../audio/audio-tools';
import { ImageModes, ImageNav, ImageZoom } from '../image/image-tools';
import { HistoryTools, ShareTool, Tool, ToolbarFrame } from '../toolbar';
import type { MediaCompare } from './use-media';

interface MediaToolbarProps {
  kind: 'image' | 'audio';
  media: Pick<MediaCompare, 'imageCtl' | 'audioCtl'>;
  /** The list beside the picture or recordings (their notes, or the differences heard) is open. */
  sidebar: boolean;
  onSidebar(): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  /** The share menu is open. */
  sharing: boolean;
  onShare(e: MouseEvent<HTMLButtonElement>): void;
}

/** The toolbar for two pictures or two recordings: their own tools, then undo, redo and sharing, and last (as for documents) the list beside them. */
export function MediaToolbar({ kind, media, sidebar, onSidebar, canUndo, canRedo, onUndo, onRedo, sharing, onShare }: Readonly<MediaToolbarProps>) {
  const { imageCtl, audioCtl } = media;
  const right = (own: ReactNode, list: string) => (
    <>
      {own}
      <div className="tgroup edit" role="group" aria-label="Edit">
        <HistoryTools canUndo={canUndo} canRedo={canRedo} onUndo={onUndo} onRedo={onRedo} />
        <ShareTool expanded={sharing} onClick={onShare} />
      </div>
      <div className="tgroup panel">
        <Tool id="btn-sidebar" icon="sidebar" label={list} kbd="S" toggle pressed={sidebar} controls="changes" onClick={onSidebar} />
      </div>
    </>
  );
  return kind === 'image' ? (
    <ToolbarFrame
      kind="image"
      idle={!imageCtl.loaded}
      same={!!imageCtl.diff && !imageCtl.diff.changed}
      left={<ImageNav ctl={imageCtl} />}
      middle={<ImageModes ctl={imageCtl} annotatable />}
      right={right(<ImageZoom ctl={imageCtl} />, 'Notes')}
    />
  ) : (
    <ToolbarFrame
      kind="audio"
      idle={!audioCtl.sides}
      same={!!audioCtl.sides && !audioCtl.busy && !audioCtl.differences.length}
      left={<AudioNav ctl={audioCtl} />}
      middle={<AudioModes ctl={audioCtl} />}
      right={right(<AudioZoom ctl={audioCtl} />, 'List of differences')}
    />
  );
}
