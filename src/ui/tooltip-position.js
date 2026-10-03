// Where the HUD's shared skill tooltip goes (docs/art-direction-v3-1.md
// section 4.4). Pure (no DOM).

export const TOOLTIP_GAP = 12; // between the anchor and the tooltip
export const TOOLTIP_MARGIN = 12; // kept from every window edge
export const TOOLTIP_SHOW_MS = 120; // hover delay
export const TOOLTIP_LONG_PRESS_MS = 500; // touch: a press this long shows it and swallows the click

// anchorRect: { left, top, width, height } of the button (a DOMRect works),
// tooltipSize: { width, height }, viewport: { width, height }. Returns
// { left, top, placement }: below the anchor and centred on it, above it
// when it does not fit below, clamped TOOLTIP_MARGIN from every edge; a
// tooltip wider than the window minus the margins sits at the left margin.
export function tooltipPosition(anchorRect, tooltipSize, viewport) {
  const { width, height } = tooltipSize;
  const anchorBottom = anchorRect.top + anchorRect.height;
  const room = viewport.width - 2 * TOOLTIP_MARGIN;
  let left;
  if (width > room) {
    left = TOOLTIP_MARGIN;
  } else {
    left = anchorRect.left + anchorRect.width / 2 - width / 2;
    left = Math.min(Math.max(left, TOOLTIP_MARGIN), viewport.width - TOOLTIP_MARGIN - width);
  }

  const below = anchorBottom + TOOLTIP_GAP;
  const above = anchorRect.top - TOOLTIP_GAP - height;
  const maxTop = viewport.height - TOOLTIP_MARGIN - height;
  let placement;
  let top;
  if (below <= maxTop) {
    placement = 'below';
    top = below;
  } else if (above >= TOOLTIP_MARGIN) {
    placement = 'above';
    top = above;
  } else {
    // Fits neither way: the side with more room, kept inside the window.
    const roomBelow = viewport.height - anchorBottom;
    placement = roomBelow >= anchorRect.top ? 'below' : 'above';
    top = Math.max(TOOLTIP_MARGIN, Math.min(placement === 'below' ? below : above, maxTop));
  }
  return { left, top, placement };
}
