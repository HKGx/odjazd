/**
 * Long-press (touch, pen or a held mouse button) and right-click both run
 * `onLong`. Call `swallowClick` from the click handler: the click that ends a
 * long press shouldn't also toggle the element.
 */
export const longPress = (onLong: () => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fired = false;
  let start: { x: number; y: number } | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
    start = undefined;
  };
  const fire = () => {
    clear();
    if (fired) return;
    fired = true;
    onLong();
  };
  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0) return;
      fired = false;
      clear();
      start = { x: event.clientX, y: event.clientY };
      timer = setTimeout(fire, 450);
    },
    // Scrolling the list isn't pressing.
    onPointerMove: (event: PointerEvent) => {
      if (start !== undefined && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
        clear();
      }
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      fire();
    },
    swallowClick: () => {
      const swallow = fired;
      fired = false;
      return swallow;
    },
  };
};
