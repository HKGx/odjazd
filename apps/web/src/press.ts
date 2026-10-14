/** How long a press is held before it counts as a long-press, everywhere in the app. */
export const HOLD_MS = 450;
/** Pixels a finger may wander during the hold; further is a drag, not a press. */
const SLOP = 8;

/**
 * The hold itself, without any DOM: `start` where the press lands, `move` as it
 * wanders, `cancel` when it lifts. `fired` says whether the press that just
 * ended was a long one, so the click that follows can be ignored.
 */
export const holdTimer = () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | undefined;
  let fired = false;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    start = undefined;
  };
  return {
    start: (x: number, y: number, onLong: () => void) => {
      cancel();
      fired = false;
      start = { x, y };
      timer = setTimeout(() => {
        cancel();
        fired = true;
        onLong();
      }, HOLD_MS);
    },
    move: (x: number, y: number) => {
      if (start !== undefined && Math.hypot(x - start.x, y - start.y) > SLOP) cancel();
    },
    cancel,
    /** Long-press right now from elsewhere (a right-click), unless the hold already did. */
    fire: (onLong: () => void) => {
      cancel();
      if (fired) return;
      fired = true;
      onLong();
    },
    /** Whether the last press was a long one; reading it resets it. */
    take: () => {
      const was = fired;
      fired = false;
      return was;
    },
  };
};

/**
 * Long-press (touch, pen or a held mouse button) and right-click both run
 * `onLong`. Call `swallowClick` from the click handler: the click that ends a
 * long press shouldn't also toggle the element.
 */
export const longPress = (onLong: () => void) => {
  const hold = holdTimer();
  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0) return;
      hold.start(event.clientX, event.clientY, onLong);
    },
    // Scrolling the list isn't pressing.
    onPointerMove: (event: PointerEvent) => hold.move(event.clientX, event.clientY),
    onPointerUp: hold.cancel,
    onPointerCancel: hold.cancel,
    onPointerLeave: hold.cancel,
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      // After a touch hold the browser sends its context menu too: that's the same press.
      hold.fire(onLong);
    },
    swallowClick: hold.take,
  };
};
