import type { Metadata } from 'next';
import Link from 'next/link';
import { GuidePage } from '../../../components/guide-page';
import type { Step } from '../../../components/replica/walkthrough';

export const metadata: Metadata = {
  title: 'Comparing images',
  description: 'A step-by-step walkthrough of comparing two pictures in Collate: side by side, swipe, onion skin and difference, with the changed areas outlined.',
};

const STEPS: Step[] = [
  {
    title: 'Two pictures, A and B',
    focus: 'heads',
    body: <p>Choose two pictures and they are compared as pictures. The column heads give each one’s size in pixels, its format and its file size, so a resize or a heavier export is easy to spot.</p>,
  },
  {
    title: 'Side by side',
    focus: 'view',
    body: (
      <p>
        The pictures start side by side. Zoom and pan stay in step between them: <kbd>Ctrl</kbd> or <kbd>⌘</kbd> with the scroll wheel zooms, and dragging pans.
      </p>
    ),
  },
  {
    title: 'Four ways to compare',
    focus: 'modes',
    body: (
      <>
        <p>
          Switch with the buttons or the keys <kbd>1</kbd> to <kbd>4</kbd>:
        </p>
        <ul>
          <li>
            <b>Side by side</b>, the two next to each other;
          </li>
          <li>
            <b>Swipe</b>, one picture with a divider to drag between A and B;
          </li>
          <li>
            <b>Onion skin</b>, B faded over A;
          </li>
          <li>
            <b>Difference</b>, the changed pixels in red over a faded picture.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Swipe and fade',
    focus: 'slider',
    body: <p>In swipe and onion skin, the slider sets where the divider sits or how much of B shows over A. In the replica you can also drag across the picture itself.</p>,
  },
  {
    title: 'The changed areas',
    focus: 'areas',
    body: <p>Each place the pictures differ is outlined. Click an outline to zoom in on it. Outlines can be turned off when you want a clean look at the picture.</p>,
  },
  {
    title: 'Step through them',
    focus: 'nav',
    body: (
      <p>
        The arrows, or <kbd>N</kbd> and <kbd>P</kbd>, go from one changed area to the next and zoom in on each. The count says how much of the picture changed and how many areas there are.
      </p>
    ),
  },
  {
    title: 'How small a change counts',
    focus: 'sensitivity',
    body: <p>Sensitivity sets how small a difference has to be before it is ignored. Lower it and the replica drops the small label change, keeping only the bar that grew.</p>,
  },
  {
    title: 'Zoom',
    focus: 'zoom',
    body: <p>Zoom in to check fine detail; both pictures zoom together. Going to a changed area zooms to it for you.</p>,
  },
  {
    title: 'Save the difference',
    focus: 'save',
    body: <p>Save the difference picture as a PNG, to attach to a bug report or a review. Like everything else, it is made in your browser.</p>,
  },
];

export default function ImagesGuide() {
  return (
    <GuidePage
      kind="image"
      href="/guides/images/"
      title={
        <>
          Comparing <em>images</em>
        </>
      }
      lead="Find what changed between two versions of a chart, a design or a screenshot. The replica uses the real sample charts, so every mode works as it does in Collate."
      steps={STEPS}
      formats={[
        ['PNG', '.png', 'Best for screenshots, charts and designs.'],
        ['JPEG', '.jpg .jpeg', 'Best for photos. Raise the sensitivity to catch the faintest edits.'],
        ['GIF, WebP, BMP', '.gif .webp .bmp', ''],
        ['SVG', '.svg', 'Drawn by the browser, then compared as a picture.'],
      ]}
      tips={[
        ['Resized is not changed', 'A picture that was only resized or saved again is recognised by what it shows, so it is not reported as a change.'],
        ['Pictures inside documents', 'Click a picture in a compared document to open these same tools in a dialog. The list of changes shows changed pictures as thumbnails.'],
        ['Keyboard', 'N and P step through the changed areas, and 1 to 4 switch modes.'],
      ]}
      sample={
        <>
          Try the <Link href="/samples/#images">image samples</Link>: a sales chart as PNG and an event poster as SVG.
        </>
      }
    />
  );
}
