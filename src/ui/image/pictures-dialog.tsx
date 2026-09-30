import { ImageModes, ImageNav, ImageZoom, imageKey } from './image-tools';
import { ImageView } from './image-view';
import type { ImageSide } from './use-image-compare';
import { useImageCompare } from './use-image-compare';

/** Two versions of a picture in a document, compared in a dialog: the image tools in a row over the view. */
export function PicturesDialog({ a, b }: { a: ImageSide; b: ImageSide }) {
  const ctl = useImageCompare({ a, b });
  return (
    <div
      className="pictures"
      tabIndex={-1}
      onKeyDown={(e) => {
        if ((e.target as Element).closest('input')) return;
        if (imageKey(ctl, e)) e.preventDefault();
      }}
    >
      <div className="ic-bar">
        <ImageNav ctl={ctl} />
        <ImageModes ctl={ctl} />
        <ImageZoom ctl={ctl} />
      </div>
      <ImageView ctl={ctl} />
    </div>
  );
}
