import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BARS_HEIGHT, CARD_HEIGHT, CARD_SIDE, CARD_TOP, CARD_WIDTH, COMPACT_WIDTH, HUD_GAP, MIN_CARD_SCALE,
  RAIL_HEIGHT_ROW, RAIL_HEIGHT_STACKED, RAIL_TOP, boardScreenRect, hudLayout,
} from '../src/ui/hud-layout.js';

// The window area the cards take, as { left, right, top, bottom } boxes.
function cardBoxes(w, h, { compact, rail, railWidth, stacked, scale }) {
  if (rail) {
    const bottom = RAIL_TOP + (stacked ? RAIL_HEIGHT_STACKED : RAIL_HEIGHT_ROW);
    return [
      { left: 12, right: 12 + railWidth, top: RAIL_TOP, bottom },
      { left: w - 12 - railWidth, right: w - 12, top: RAIL_TOP, bottom },
    ];
  }
  if (compact) return [{ left: 12, right: w - 12, top: h - BARS_HEIGHT, bottom: h - 12 }];
  const side = CARD_SIDE * scale;
  const width = CARD_WIDTH * scale;
  const bottom = CARD_TOP + CARD_HEIGHT * scale;
  return [
    { left: side, right: side + width, top: CARD_TOP, bottom },
    { left: w - side - width, right: w - side, top: CARD_TOP, bottom },
  ];
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test('boardScreenRect: the plots sit in the middle of the 16:9 stage', () => {
  const board = boardScreenRect(1920, 1080);
  assert.ok(board.left > 400 && board.left < 520, `left ${board.left}`);
  assert.ok(Math.abs(board.left + board.right - 1920) < 1e-6, 'centred');
  assert.ok(board.top > 150 && board.bottom < 1000);
  // A wider window adds the letterbox bars to the left edge.
  assert.ok(Math.abs(boardScreenRect(2520, 1080).left - (board.left + 300)) < 1e-6);
});

test('hudLayout: full size cards at 1920x1080', () => {
  assert.deepEqual(hudLayout(1920, 1080), { compact: false, rail: false, railWidth: 0, stacked: false, scale: 1 });
});

test('hudLayout: smaller desktop windows shrink the cards beside the board', () => {
  for (const [w, h] of [[1280, 720], [1366, 768], [1440, 900], [1024, 768]]) {
    const layout = hudLayout(w, h);
    assert.equal(layout.compact, false, `${w}x${h}`);
    assert.ok(layout.scale < 1 && layout.scale >= MIN_CARD_SCALE, `${w}x${h} scale ${layout.scale}`);
    const board = boardScreenRect(w, h);
    assert.ok((CARD_SIDE + CARD_WIDTH) * layout.scale <= board.left - HUD_GAP + 1e-9, `${w}x${h}`);
  }
});

test('hudLayout: phones in portrait get the slim bars below the board', () => {
  for (const [w, h] of [[390, 844], [360, 740], [690, 1000]]) {
    const layout = hudLayout(w, h);
    assert.equal(layout.compact, true, `${w}x${h}`);
    assert.ok(h - BARS_HEIGHT >= boardScreenRect(w, h).bottom, `${w}x${h}`);
  }
});

test('hudLayout: cards never lie over the board plots', () => {
  for (let w = 320; w <= 2560; w += 40) {
    for (let h = 320; h <= 1600; h += 40) {
      const layout = hudLayout(w, h);
      const board = boardScreenRect(w, h);
      for (const box of cardBoxes(w, h, layout)) {
        // Only where neither the bottom bars nor the upright bars fit (tiny
        // windows) may the bars lie over the board; everything else stays clear.
        const barsFit = h - BARS_HEIGHT - HUD_GAP >= board.bottom;
        if (layout.compact && !layout.rail && !barsFit) continue;
        assert.ok(!overlaps(box, board), `${w}x${h} ${JSON.stringify(layout)}`);
      }
    }
  }
});

test('hudLayout: below 700 px wide the cards are always slim bars', () => {
  for (let w = 240; w < COMPACT_WIDTH; w += 20) {
    for (let h = 200; h <= 1400; h += 20) {
      assert.equal(hudLayout(w, h).compact, true, `${w}x${h}`);
    }
  }
});

test('hudLayout: full cards never shrink below the 44 px touch height', () => {
  for (let w = 240; w <= 2560; w += 20) {
    for (let h = 200; h <= 1600; h += 20) {
      const layout = hudLayout(w, h);
      if (!layout.compact) assert.ok(layout.scale >= MIN_CARD_SCALE, `${w}x${h} scale ${layout.scale}`);
    }
  }
});

test('hudLayout: small landscape windows stand the bars beside the board', () => {
  for (const [w, h] of [[667, 375], [640, 360], [800, 600]]) {
    const layout = hudLayout(w, h);
    assert.equal(layout.compact, true, `${w}x${h}`);
    assert.equal(layout.rail, true, `${w}x${h}`);
    assert.equal(layout.stacked, false, `${w}x${h}`);
    assert.ok(12 + layout.railWidth <= boardScreenRect(w, h).left - HUD_GAP + 1e-9, `${w}x${h}`);
  }
  // A narrower strip stacks the two skill buttons.
  const small = hudLayout(568, 320);
  assert.equal(small.rail, true);
  assert.equal(small.stacked, true);
});
