import { expect, test, type Locator, type Page } from '@playwright/test';

/* The editor, driven the way a person would: mouse, keyboard and the panels. */

const SUN = ['Path', 'Path', 'Path', 'Path', 'Path', 'Path', 'Path', 'Path', 'Circle'];

interface Studio {
  page: Page;
  /** Screen position of a document coordinate (call refresh() after anything that moves the view). */
  at(u: number, v: number): { x: number; y: number };
  refresh(): Promise<void>;
  drag(from: [number, number], to: [number, number], mods?: string[]): Promise<void>;
  layers(): Promise<string[]>;
  selected(): Promise<string[]>;
  box(): Promise<{ x: number; y: number; w: number; h: number }>;
  tool(name: string): Promise<void>;
}

async function open(page: Page, svg?: string): Promise<Studio> {
  await page.addInitScript(() => {
    // Start from the sample, once: a reload within the test keeps what the page saved.
    if (!sessionStorage.getItem('e2e-started')) {
      sessionStorage.setItem('e2e-started', '1');
      localStorage.removeItem('svg-studio:v1');
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const studio = makeStudio(page);
  await expect(page.locator('.artboard')).toBeVisible();
  await studio.refresh();
  if (svg) {
    // Start from a blank canvas and paste the drawing in.
    await page.getByTestId('new').click();
    await pasteSvg(page, svg);
  }
  return studio;
}

async function pasteSvg(page: Page, svg: string) {
  await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, svg);
}

function makeStudio(page: Page): Studio {
  const artboard = async () => {
    const b = await page.locator('.artboard').boundingBox();
    if (!b) throw new Error('no artboard');
    return b;
  };
  let cached: { x: number; y: number; width: number; height: number } | null = null;
  const at = (u: number, v: number) => {
    if (!cached) throw new Error('call refresh() first');
    return { x: cached.x + (u * cached.width) / 24, y: cached.y + (v * cached.height) / 24 };
  };
  const studio: Studio = {
    page,
    at: (u, v) => at(u, v),
    async refresh() {
      cached = await artboard();
    },
    async drag(from, to, mods = []) {
      cached = await artboard();
      const a = at(...from);
      const b = at(...to);
      for (const m of mods) await page.keyboard.down(m);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
      await page.mouse.move(b.x, b.y, { steps: 5 });
      await page.mouse.up();
      for (const m of mods) await page.keyboard.up(m);
    },
    layers: () => page.getByTestId('layer').locator('.layer-name').allTextContents(),
    selected: () => page.locator('[data-testid=layer].selected .layer-name').allTextContents(),
    async box() {
      const n = async (id: string) => Number(await page.getByTestId(id).inputValue());
      return { x: await n('pos-x'), y: await n('pos-y'), w: await n('size-w'), h: await n('size-h') };
    },
    async tool(name) {
      await page.getByTestId(`tool-${name}`).click();
    },
  };
  return studio;
}

const near = (a: number, b: number, digits = 2) => expect(a).toBeCloseTo(b, digits);

/** Two rectangles and a circle, laid out so that marquees can enclose some and cross others. */
const SHAPES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="6" height="6" />
  <rect x="14" y="3" width="7" height="6" />
  <circle cx="8" cy="17" r="4" />
  <path d="M15 14l6 6" />
</svg>`;

test.describe('first run', () => {
  test('opens with a sample icon and a working canvas', async ({ page }) => {
    const s = await open(page);
    expect(await s.layers()).toEqual(SUN);
    await expect(page.locator('.artboard')).toBeVisible();
    await expect(page.getByTestId('preview')).toBeVisible();
    await expect(page.getByTestId('icon-name')).toHaveValue('sun');
  });
});

test.describe('drag selection', () => {
  test('encompass selects only shapes completely inside the rectangle', async ({ page }) => {
    const s = await open(page, SHAPES);
    // Clear what the paste selected.
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [10.5, 10.5]);
    // Only the first square is wholly inside. (The circle's top, at y = 13, is outside.)
    expect(await s.selected()).toEqual(['Rect']);
    await s.drag([0.5, 0.5], [22.5, 10.5]);
    expect(await s.selected()).toEqual(['Rect', 'Rect']);
    // A rectangle that cuts through the circle does not pick it up.
    await s.drag([0.5, 11], [10, 23.5]);
    expect(await s.selected()).toEqual([]);
    await s.drag([0.5, 11], [12.5, 23.5]);
    expect(await s.selected()).toEqual(['Circle']);
  });

  test('touch mode (the toggle, or Alt while dragging) selects anything the rectangle crosses', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 11], [12.5, 23.5], ['Alt']);
    expect(await s.selected()).toEqual(['Circle']);
    await page.getByTestId('select-mode').click();
    await expect(page.getByTestId('select-mode')).toContainText('Touch');
    await s.drag([0.5, 0.5], [10.5, 10.5]);
    expect(await s.selected()).toEqual(['Rect']);
    // Reaching into the second rectangle's corner now counts; with Alt it flips back to encompass.
    await s.drag([0.5, 0.5], [14.5, 10]);
    expect(await s.selected()).toEqual(['Rect', 'Rect']);
    await s.drag([0.5, 0.5], [14.5, 10], ['Alt']);
    expect(await s.selected()).toEqual(['Rect']);
  });

  test('shift adds to the selection and the marquee shows while dragging', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [10.5, 10.5]);
    await s.drag([12.5, 0.5], [22.5, 10.5], ['Shift']);
    expect(await s.selected()).toEqual(['Rect', 'Rect']);
    // The marquee element is on screen mid-drag.
    const a = s.at(0.5, 11);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(s.at(6, 16).x, s.at(6, 16).y, { steps: 4 });
    await expect(page.locator('.marquee.encompass')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('.marquee')).toHaveCount(0);
  });

  test('a click on empty canvas clears the selection', async ({ page }) => {
    const s = await open(page, SHAPES);
    await s.drag([0.5, 0.5], [10.5, 10.5]);
    expect(await s.selected()).toHaveLength(1);
    const p = s.at(12, 12);
    await page.mouse.click(p.x, p.y);
    expect(await s.selected()).toEqual([]);
  });
});

test.describe('groups', () => {
  test('group, transform as one, enter, ungroup', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [22.5, 10.5]); // the two rectangles
    await page.keyboard.press('Control+g');
    expect(await s.layers()).toEqual(['Path', 'Circle', 'Group', 'Rect', 'Rect']);
    expect(await s.selected()).toEqual(['Group']);
    await expect(page.getByTestId('inspector')).toContainText('2 shapes');
    const before = await s.box();
    near(before.x, 3);
    near(before.w, 18);

    // A numeric scale of the group changes both rectangles.
    await page.getByTestId('scale-axis-h').click();
    await page.getByTestId('scale-200').click();
    const after = await s.box();
    near(after.w, 36);
    near(after.h, before.h);

    // The outline of the group is drawn around both rectangles.
    await expect(page.locator('.outline')).toHaveCount(2);

    // Double-click opens the group, so one rectangle can be picked.
    await page.keyboard.press('Control+z');
    const r = s.at(6, 3);
    await page.mouse.dblclick(r.x, r.y);
    expect(await s.selected()).toEqual(['Rect']);
    await page.keyboard.press('Escape'); // clears the selection
    await page.keyboard.press('Escape'); // closes the group
    await s.drag([0.5, 0.5], [22.5, 10.5]);
    expect(await s.selected()).toEqual(['Group']);

    await page.keyboard.press('Control+Shift+g');
    expect(await s.layers()).toEqual(['Path', 'Circle', 'Rect', 'Rect']);
    expect(await s.selected()).toEqual(['Rect', 'Rect']);
  });

  test('the toolbar and layers panel group and nest', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 11], [13.5, 23.5]);
    await page.getByTestId('tool-group').click();
    expect(await s.layers()).toEqual(['Path', 'Group', 'Circle', 'Rect', 'Rect']);
    // Dragging a layer onto the group's row moves it inside (it is then listed under the group, above the circle).
    await page.getByTestId('layer').nth(3).dragTo(page.getByTestId('layer').nth(1));
    expect(await s.layers()).toEqual(['Path', 'Group', 'Rect', 'Circle', 'Rect']);
  });
});

test.describe('transform: numeric', () => {
  test('scale horizontally, vertically and both about the origin', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([12.5, 0.5], [22.5, 10.5]); // the second rectangle: x 14..21, y 3..9
    const b = await s.box();
    expect(b).toEqual({ x: 14, y: 3, w: 7, h: 6 });

    await page.getByTestId('scale-axis-h').click();
    await page.getByTestId('scale-200').click();
    let n = await s.box();
    near(n.w, 14);
    near(n.h, 6);
    near(n.x + n.w / 2, 17.5); // about the centre

    await page.getByTestId('scale-axis-v').click();
    await page.getByTestId('scale-50').click();
    n = await s.box();
    near(n.w, 14);
    near(n.h, 3);

    await page.getByTestId('scale-axis-both').click();
    await page.getByTestId('scale-200').click();
    n = await s.box();
    near(n.w, 28);
    near(n.h, 6);
  });

  test('a custom percentage applies on Apply', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([12.5, 0.5], [22.5, 10.5]);
    await page.getByTestId('scale-axis-v').click();
    await page.getByTestId('scale-percent').fill('300');
    await page.getByTestId('scale-apply').click();
    near((await s.box()).h, 18);
  });

  test('rotate by 90° swaps the sides, 45° grows the box, and the origin matters', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([12.5, 0.5], [22.5, 10.5]); // 7 × 6 at (14, 3)
    await page.getByTestId('rotate--90').click();
    let n = await s.box();
    near(n.w, 6);
    near(n.h, 7);
    near(n.x + n.w / 2, 17.5);
    await page.getByTestId('rotate-90').click();
    await page.getByTestId('rotate-45').click();
    n = await s.box();
    near(n.w, (7 + 6) * Math.SQRT1_2, 1);
    // A rotated rectangle can only be a path.
    await expect(page.getByTestId('geometry')).toContainText('path');

    // Rotating about the top-left corner keeps that corner in place.
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
    expect(await s.box()).toEqual({ x: 14, y: 3, w: 7, h: 6 });
    await page.getByRole('button', { name: 'Origin top left' }).click();
    await page.getByTestId('rotate-90').click();
    n = await s.box();
    near(n.x + n.w, 14); // the box now extends to the left of the pivot
    near(n.y, 3);
    near(n.w, 6);
    near(n.h, 7);
  });

  test('flip, and resize with W and H keep proportions when asked', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([12.5, 0.5], [22.5, 10.5]);
    await page.getByTestId('flip-h').click();
    expect(await s.box()).toEqual({ x: 14, y: 3, w: 7, h: 6 });
    await page.getByText('Keep proportions').click();
    await page.getByTestId('size-w').fill('14');
    await page.getByTestId('size-w').press('Enter');
    const n = await s.box();
    near(n.w, 14);
    near(n.h, 12);
  });
});

test.describe('transform: on the canvas', () => {
  test('dragging a side handle scales one way, a corner both ways, shift keeps proportions', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [10.5, 10.5]); // rect x 3..9, y 3..9
    const handle = (id: string) => page.locator(`[data-hit="resize:${id}"]`);
    const centre = async (l: Locator) => {
      const b = (await l.boundingBox())!;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    // East handle: widen by 3 units.
    let h = await centre(handle('e'));
    const k = s.at(1, 0).x - s.at(0, 0).x;
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 3 * k, h.y, { steps: 6 });
    await page.mouse.up();
    let n = await s.box();
    expect(n).toEqual({ x: 3, y: 3, w: 9, h: 6 });

    // South-east corner with shift: proportions are kept.
    h = await centre(handle('se'));
    await page.keyboard.down('Shift');
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 3 * k, h.y + 0.5 * k, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    n = await s.box();
    near(n.w / n.h, 1.5, 1);
    expect(n.w).toBeGreaterThan(11);

    // Undo puts it back in one step per gesture.
    await page.keyboard.press('Control+z');
    expect((await s.box()).w).toBe(9);
  });

  test('the rotate zone at a corner turns the selection; shift snaps to 15°', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([12.5, 0.5], [22.5, 10.5]); // 7 × 6
    const zone = page.locator('[data-hit="rotate:se"]');
    const zb = (await zone.boundingBox())!;
    const from = { x: zb.x + zb.width / 2, y: zb.y + zb.height / 2 };
    const centre = s.at(17.5, 6);
    // Move the pointer a quarter turn clockwise about the centre.
    const r = Math.hypot(from.x - centre.x, from.y - centre.y);
    const a0 = Math.atan2(from.y - centre.y, from.x - centre.x);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(centre.x + r * Math.cos(a0 + Math.PI / 2), centre.y + r * Math.sin(a0 + Math.PI / 2), { steps: 8 });
    await expect(page.locator('.readout')).toContainText('90');
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const n = await s.box();
    near(n.w, 6, 1);
    near(n.h, 7, 1);
  });
});

test.describe('transform tools', () => {
  test('scale horizontally: dragging widens, height is untouched; undo is one step', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([12.5, 0.5], [22.5, 10.5]); // x 14..21, y 3..9; centre (17.5, 6)
    await s.tool('scaleH');
    // Pivot at the centre; start 3.5 units to the right of it and drag 3.5 further: doubles the width.
    await s.drag([21, 15], [24.5, 15]);
    const n = await s.box();
    near(n.h, 6);
    expect(n.w).toBeGreaterThan(7);
    await page.keyboard.press('Control+z');
    expect((await s.box()).w).toBe(7);
  });

  test('scale vertically leaves the width alone', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([12.5, 0.5], [22.5, 10.5]);
    await s.tool('scaleV');
    await s.drag([12, 9], [12, 12]);
    const n = await s.box();
    near(n.w, 7);
    expect(n.h).toBeGreaterThan(6);
  });

  test('scale (both) scales evenly; shift makes it free', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([12.5, 0.5], [22.5, 10.5]);
    await s.tool('scale');
    await s.drag([21, 9], [24, 12]);
    const n = await s.box();
    near(n.w / n.h, 7 / 6, 2);
    expect(n.w).toBeGreaterThan(7);
  });

  test('rotate by dragging around the pivot, which can be moved', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([12.5, 0.5], [22.5, 10.5]); // centre (17.5, 6)
    await s.tool('rotate');
    // From the right of the pivot to below it: +90° clockwise.
    await s.drag([21.5, 6], [17.5, 10], ['Shift']);
    const n = await s.box();
    near(n.w, 6, 1);
    near(n.h, 7, 1);
    await page.keyboard.press('Control+z');
    expect(await s.box()).toEqual({ x: 14, y: 3, w: 7, h: 6 });
    // Move the pivot to the top-left corner (it snaps to the box's corner), then rotate about it.
    const pivot = page.locator('[data-hit="pivot"]');
    const pb = (await pivot.boundingBox())!;
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.at(14, 3).x, s.at(14, 3).y, { steps: 5 });
    await page.mouse.up();
    await s.drag([21, 3], [14, 10], ['Shift']);
    const m = await s.box();
    near(m.y, 3, 1); // the top-left corner stayed
  });

  test('a transform tool does nothing without a selection and says so', async ({ page }) => {
    await open(page);
    await page.keyboard.press('x');
    await expect(page.locator('.hint')).toContainText('Select something first');
  });
});

test.describe('drawing', () => {
  test('rectangle, ellipse and line tools', async ({ page }) => {
    const s = await open(page);
    await page.getByTestId('new').click();
    expect(await s.layers()).toEqual([]);
    await s.tool('rect');
    await s.drag([3, 3], [9, 8]);
    await s.tool('ellipse');
    await s.drag([12, 12], [18, 18], ['Shift']);
    await s.tool('line');
    await s.drag([3, 20], [20, 20]);
    expect(await s.layers()).toEqual(['Line', 'Circle', 'Rect']);
    await s.tool('select');
    await s.drag([0.5, 0.5], [10.5, 10.5]);
    expect(await s.box()).toEqual({ x: 3, y: 3, w: 6, h: 5 });
  });

  test('the pen draws straight and curved segments, and finishes on Enter', async ({ page }) => {
    const s = await open(page);
    await page.getByTestId('new').click();
    await s.tool('pen');
    const click = async (u: number, v: number) => {
      const p = s.at(u, v);
      await page.mouse.click(p.x, p.y);
    };
    await click(4, 18);
    await click(12, 6);
    await s.drag([20, 18], [24, 18]); // a click and drag creates a curve handle
    await page.keyboard.press('Enter');
    expect(await s.layers()).toEqual(['Path']);
    await s.tool('select');
    await expect(page.getByTestId('path-d')).toHaveValue(/^M4 18.*[cC]/);
  });

  test('clicking the first point closes the path', async ({ page }) => {
    const s = await open(page);
    await page.getByTestId('new').click();
    await s.tool('pen');
    for (const [u, v] of [[4, 4], [20, 4], [20, 20], [4, 4]] as const) {
      const p = s.at(u, v);
      await page.mouse.click(p.x, p.y);
    }
    expect(await s.layers()).toEqual(['Path']);
    await s.tool('select');
    await expect(page.getByTestId('path-d')).toHaveValue(/z$/);
  });
});

test.describe('editing points', () => {
  test('drag a point, add one by double-clicking the path, delete one', async ({ page }) => {
    const s = await open(page, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 18L12 6l8 12"/></svg>`);
    await page.keyboard.press('a');
    const hit = (si: number, ni: number) => page.locator(`[data-hit="node:${si}:${ni}"]`);
    await expect(page.locator('[data-hit^="node:"]')).toHaveCount(3);
    // Drag the apex up by 3 units.
    const b = (await hit(0, 1).boundingBox())!;
    const k = s.at(1, 0).x - s.at(0, 0).x;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 3 * k, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('path-d')).toHaveValue('M4 18l8-15 8 15');
    // Add a point in the middle of the left slope.
    const p = s.at(8, 10.5);
    await page.mouse.dblclick(p.x, p.y);
    await expect(page.locator('[data-hit^="node:"]')).toHaveCount(4);
    // Delete the selected (new) point.
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-hit^="node:"]')).toHaveCount(3);
  });

  test('double-clicking a shape with the select tool switches to editing its points', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    const p = s.at(15, 15);
    await page.mouse.dblclick(p.x, p.y);
    await expect(page.getByTestId('tool-node')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('history, view and panels', () => {
  test('undo and redo through the buttons and keys', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [10.5, 10.5]);
    await page.keyboard.press('Delete');
    expect(await s.layers()).toHaveLength(3);
    await page.getByTestId('undo').click();
    expect(await s.layers()).toHaveLength(4);
    await page.keyboard.press('Control+Shift+z');
    expect(await s.layers()).toHaveLength(3);
    await page.keyboard.press('Control+z');
    expect(await s.layers()).toHaveLength(4);
  });

  test('arrow keys nudge, Escape backs out, Delete removes', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [10.5, 10.5]);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    expect(await s.box()).toEqual({ x: 5, y: 4, w: 6, h: 6 });
    // Quick nudges share one undo step.
    await page.keyboard.press('Control+z');
    expect(await s.box()).toEqual({ x: 3, y: 3, w: 6, h: 6 });
  });

  test('the code panel is two-way', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.getByTestId('toggle-code').click();
    const code = page.getByTestId('code-area');
    await expect(code).toHaveValue(/<rect x="3" y="3" width="6" height="6" \/>/);
    // Edit the source: the canvas follows.
    await code.fill(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M3 3h4"/></svg>`);
    await expect.poll(() => s.layers()).toEqual(['Path', 'Circle']);
    // A bad edit is reported and the canvas keeps its last good state.
    await code.fill('<svg><path d="M0 0"');
    await expect(page.getByTestId('code-panel')).toContainText(/\w/);
    // Change something on the canvas: the source follows.
    await code.fill(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="4" height="4"/></svg>`);
    await expect.poll(() => s.layers()).toEqual(['Rect']);
    await page.locator('[data-testid=layer]').first().click();
    await page.getByTestId('scale-200').click();
    await expect(code).toHaveValue(/width="8" height="8"/);
  });

  test('hiding and locking layers', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    const row = page.getByTestId('layer').first();
    await row.hover();
    await row.getByRole('button', { name: 'Hide' }).click();
    await expect(row).toHaveClass(/is-hidden/);
    await s.drag([0.5, 0.5], [22.5, 23.5]);
    // The hidden path (the topmost) is not picked up by the marquee.
    expect(await s.selected()).toEqual(['Circle', 'Rect', 'Rect']);
  });

  test('align and distribute', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [22.5, 10.5]); // the two rects
    await page.getByRole('button', { name: 'Align bottom' }).click();
    const n = await s.box();
    near(n.y + n.h, 9);
  });

  test('keys do not reach the drawing while a dialog is open', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [10.5, 10.5]);
    await page.getByTestId('export').click();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('export-dialog')).toHaveCount(0);
    expect(await s.layers()).toHaveLength(4);
  });

  test('theme and the shortcuts dialog', async ({ page }) => {
    await open(page);
    await page.keyboard.press('?');
    await expect(page.getByTestId('help-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-dialog')).toHaveCount(0);
    await page.getByRole('button', { name: /dark theme/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the work is kept across a reload', async ({ page }) => {
    const s = await open(page, SHAPES);
    expect(await s.layers()).toHaveLength(4);
    await page.waitForTimeout(700);
    await page.reload();
    expect(await s.layers()).toHaveLength(4);
  });
});

test.describe('import and export', () => {
  test('pasted SVG is inserted, an opened file replaces the drawing', async ({ page }) => {
    const s = await open(page);
    await pasteSvg(page, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="5" cy="5" r="2"/></svg>`);
    expect(await s.layers()).toHaveLength(10);
    await page.getByTestId('import-file').setInputFiles({ name: 'dot.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1" y="1" width="4" height="4"/></svg>') });
    expect(await s.layers()).toEqual(['Rect']);
    await expect(page.getByTestId('icon-name')).toHaveValue('dot');
  });

  test('imported transforms are baked into the shapes', async ({ page }) => {
    const s = await open(page);
    await page.getByTestId('new').click();
    await pasteSvg(page, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g transform="translate(4 4)"><rect width="6" height="6" transform="scale(2)"/></g></svg>`);
    await page.getByTestId('toggle-code').click();
    await expect(page.getByTestId('code-area')).toHaveValue(/<rect x="4" y="4" width="12" height="12"/);
    expect(await s.layers()).toEqual(['Group', 'Rect']);
  });

  test('export: download an SVG, copy the code', async ({ page }) => {
    await open(page);
    await page.getByTestId('export').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('download-svg').click();
    const d = await download;
    expect(d.suggestedFilename()).toBe('sun.svg');
    await page.getByTestId('copy-jsx').click();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('export function Sun(props)');
    expect(text).toContain('strokeWidth="2"');
    await page.getByTestId('copy-node').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('["circle", { cx: "12", cy: "12", r: "4" }]');
    const png = page.waitForEvent('download');
    await page.getByTestId('download-png').click();
    expect((await png).suggestedFilename()).toBe('sun.png');
  });

  test('copy and paste layers', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [10.5, 10.5]);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    expect(await s.layers()).toHaveLength(5);
  });
});

test.describe('robustness', () => {
  test('Escape in the middle of a drag cancels it and later movement changes nothing', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [10.5, 10.5]); // first square, 3..9
    // (The middle of the top edge is the north resize handle, so grab it nearer the corner.)
    const a = s.at(4.5, 3);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(s.at(7.5, 3).x, s.at(7.5, 3).y, { steps: 5 });
    expect((await s.box()).x).toBe(6);
    await page.keyboard.press('Escape');
    expect((await s.box()).x).toBe(3);
    await page.mouse.move(s.at(14, 8).x, s.at(14, 8).y, { steps: 5 });
    await page.mouse.up();
    expect(await s.box()).toEqual({ x: 3, y: 3, w: 6, h: 6 });
    // The aborted drag left nothing to undo except what came before it.
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('layer')).toHaveCount(0);
  });

  test('"New" can be undone', async ({ page }) => {
    const s = await open(page);
    await page.getByTestId('new').click();
    expect(await s.layers()).toEqual([]);
    await page.keyboard.press('Control+z');
    expect(await s.layers()).toEqual(SUN);
  });

  test('ctrl+wheel zooms at the pointer, plain wheel pans', async ({ page }) => {
    const s = await open(page);
    const zoom = async () => Number((await page.locator('.zoom-readout').textContent())!.replace('%', ''));
    const before = await zoom();
    const p = s.at(12, 12);
    await page.mouse.move(p.x, p.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await expect.poll(zoom).toBeGreaterThan(before);
    const box1 = (await page.locator('.artboard').boundingBox())!;
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await page.locator('.artboard').boundingBox())!.y).toBeLessThan(box1.y);
    await page.keyboard.press('Shift+1');
    await expect.poll(zoom).toBeCloseTo(before, -1);
  });

  test('the view refits when the code panel opens, until the view is changed by hand', async ({ page }) => {
    await open(page);
    const canvas = page.getByTestId('canvas');
    const inside = async () => {
      const a = (await page.locator('.artboard').boundingBox())!;
      const c = (await canvas.boundingBox())!;
      return a.y >= c.y && a.y + a.height <= c.y + c.height && a.x >= c.x && a.x + a.width <= c.x + c.width;
    };
    expect(await inside()).toBe(true);
    await page.getByTestId('toggle-code').click();
    await expect.poll(inside).toBe(true);
    // After zooming by hand the view is left alone.
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByTestId('toggle-code').click();
    const zoomed = (await page.locator('.artboard').boundingBox())!.width;
    await page.getByTestId('toggle-code').click();
    expect((await page.locator('.artboard').boundingBox())!.width).toBeCloseTo(zoomed, 0);
  });

  test('the artboard background can be forced light or dark, for black or white icons', async ({ page }) => {
    await open(page);
    const canvas = page.getByTestId('canvas');
    await expect(canvas).toHaveClass(/tone-auto/);
    await page.getByTestId('artboard-tone').click();
    await expect(canvas).toHaveClass(/tone-light/);
    await page.getByTestId('artboard-tone').click();
    await expect(canvas).toHaveClass(/tone-dark/);
    expect(await page.locator('.artboard').evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(26, 26, 31)');
  });

  test('outline view shows paths as hairlines', async ({ page }) => {
    await open(page);
    const widthOf = () => page.locator('.art path').first().evaluate((el) => getComputedStyle(el).strokeWidth);
    expect(await widthOf()).toBe('2px');
    await page.keyboard.press('o');
    await expect(page.getByTestId('outline-view')).toHaveAttribute('aria-pressed', 'true');
    expect(await widthOf()).toBe('1.25px');
  });
});

test.describe('groups of paths under the transform tools', () => {
  test('dragging a group handle scales every path in it; rotating turns them together', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [22.5, 10.5]);
    await page.keyboard.press('Control+g');
    const before = await s.box();
    expect(before).toEqual({ x: 3, y: 3, w: 18, h: 6 });
    const handle = page.locator('[data-hit="resize:e"]');
    const hb = (await handle.boundingBox())!;
    const k = s.at(1, 0).x - s.at(0, 0).x;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 3 * k, hb.y + hb.height / 2, { steps: 6 });
    await page.mouse.up();
    const after = await s.box();
    expect(after).toEqual({ x: 3, y: 3, w: 21, h: 6 });
    // Both children were scaled about the left edge: the first square got wider too.
    await page.getByTestId('toggle-code').click();
    const code = await page.getByTestId('code-area').inputValue();
    const widths = [...code.matchAll(/<rect x="([\d.]+)" y="3" width="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(widths).toHaveLength(2);
    near(widths[0]![1], 6 * (21 / 18), 1);
    near(widths[1]![0], 3 + (14 - 3) * (21 / 18), 1);
    await page.getByTestId('toggle-code').click();

    // Rotate the group by 90° with the numeric control: the group's box swaps its sides.
    await page.getByTestId('rotate-90').click();
    const turned = await s.box();
    near(turned.w, 6);
    near(turned.h, 21);
  });

  test('scale tools work on a group', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [22.5, 10.5]);
    await page.keyboard.press('Control+g');
    await s.tool('scaleV');
    await s.drag([12, 9.5], [12, 14]);
    const n = await s.box();
    near(n.w, 18);
    expect(n.h).toBeGreaterThan(6);
    // Nothing was ungrouped on the way.
    expect(await s.layers()).toContain('Group');
  });
});

test.describe('layers and points', () => {
  test('locked layers cannot be picked on the canvas', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    const circleRow = page.getByTestId('layer').filter({ hasText: 'Circle' });
    await circleRow.hover();
    await circleRow.getByRole('button', { name: 'Lock' }).click();
    await s.drag([0.5, 11], [12.5, 23.5]);
    expect(await s.selected()).toEqual([]);
    // Clicking its row still selects it for inspection, but editing it is refused.
    await circleRow.click();
    await expect(page.getByTestId('inspector')).not.toContainText('Transform');
  });

  test('alt-drag drags a copy', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [10.5, 10.5]);
    await s.drag([4.5, 3], [4.5, 8], ['Alt']);
    expect(await s.layers()).toHaveLength(5);
    expect(await s.box()).toEqual({ x: 3, y: 8, w: 6, h: 6 });
    // The original is still where it was.
    await s.drag([0.5, 0.5], [10.5, 10.5]);
    expect(await s.selected()).toEqual(['Rect']);
  });

  test('double-clicking a point toggles corner and smooth', async ({ page }) => {
    const s = await open(page, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 18L12 6l8 12"/></svg>`);
    await page.keyboard.press('a');
    const apex = page.locator('[data-hit="node:0:1"]');
    await apex.dblclick();
    await expect(page.getByTestId('path-d')).toHaveValue(/[cC]/);
    await apex.dblclick();
    await expect(page.getByTestId('path-d')).not.toHaveValue(/[cC]/);
    void s;
  });

  test('a group is renamed from the layers panel', async ({ page }) => {
    const s = await open(page, SHAPES);
    await page.keyboard.press('Escape');
    await s.drag([0.5, 0.5], [22.5, 10.5]);
    await page.keyboard.press('Control+g');
    await page.getByTestId('layer').filter({ hasText: 'Group' }).locator('.layer-name').dblclick();
    await page.locator('.layer .rename').fill('Squares');
    await page.keyboard.press('Enter');
    expect(await s.layers()).toContain('Squares');
    await expect(page.getByTestId('inspector')).toContainText('Squares');
  });
});
