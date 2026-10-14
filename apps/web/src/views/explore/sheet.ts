/** Where the phone sheet rests: just its top above the dock, half the map, or nearly all of it. */
export type Snap = "peek" | "half" | "full";

/** Kept across views and cities: the sheet stays where you left it. */
let resting: Snap = "half";

/** Touches starting this close to the sheet's top edge drag it even over its content. */
const GRIP = 28;
/** Pixels per millisecond: faster than this is a flick. */
const FLICK = 0.4;
/** Pixels: dragged further than this, it goes on to the next height. */
const PULL = 56;
/** Content visible above the dock when the sheet is down. */
const PEEK_CONTENT = 64;

/**
 * Makes the mobile panel a sheet you drag between three heights. It is always as tall as
 * "full" and slides down by a transform, so moving it never shifts anything's layout;
 * `onInset` hears how much of the map it covers once it settles, `onSlide` on every frame.
 */
export const dragSheet = (options: {
  sheet: HTMLElement;
  container: HTMLElement;
  /** The plan bar: the sheet stops just under it. */
  top: () => HTMLElement | null;
  /** The dock: the peeking sheet shows a little more than it covers. */
  dock: () => HTMLElement | null;
  onSlide: (visible: number) => void;
  onInset: (visible: number) => void;
}) => {
  const { sheet, container } = options;
  const narrow = window.matchMedia("(max-width: 760px)");
  // The stylesheet's own height is "half": read it before taking over the height.
  let half = sheet.offsetHeight;
  let full = half;
  let peek = half;
  let visible = half;

  const measure = () => {
    sheet.style.height = "";
    half = sheet.offsetHeight;
    const box = container.getBoundingClientRect();
    const bar = options.top()?.getBoundingClientRect();
    full = Math.max(half, Math.round(box.bottom - (bar === undefined ? box.top : bar.bottom + 8)));
    const dock = options.dock()?.getBoundingClientRect();
    peek = Math.min(
      half,
      Math.round((dock === undefined ? 0 : box.bottom - dock.top) + PEEK_CONTENT),
    );
    sheet.style.height = `${full}px`;
  };
  const heightOf = (snap: Snap) => (snap === "full" ? full : snap === "half" ? half : peek);

  const place = (shown: number, settled: boolean) => {
    visible = shown;
    const hidden = full - shown;
    sheet.style.translate = `0 ${hidden}px`;
    options.onSlide(shown);
    if (settled) {
      // Room to scroll the last lines above the screen's bottom edge.
      sheet.style.setProperty("--hidden", `${hidden}px`);
      sheet.dataset["snap"] = resting;
      options.onInset(shown);
    }
  };
  const rest = (snap: Snap) => {
    resting = snap;
    if (snap !== "full") sheet.scrollTop = 0;
    place(heightOf(snap), true);
  };

  const setUp = () => {
    if (narrow.matches) {
      measure();
      rest(resting);
    } else {
      sheet.style.height = "";
      sheet.style.translate = "";
      sheet.style.removeProperty("--hidden");
      delete sheet.dataset["snap"];
      options.onSlide(0);
      options.onInset(0);
    }
  };

  // A drag: decided on the first few pixels whether it moves the sheet or scrolls its content.
  let drag:
    | {
        y: number;
        from: number;
        grip: boolean;
        mode?: "sheet" | "scroll";
        lastY: number;
        lastT: number;
        speed: number;
      }
    | undefined;
  let swallow = false;

  const begin = (y: number) => {
    if (!narrow.matches) return;
    const grip = y - sheet.getBoundingClientRect().top < GRIP;
    drag = { y, from: visible, grip, lastY: y, lastT: performance.now(), speed: 0 };
  };
  /** Returns whether the sheet took the move (so the page mustn't scroll). */
  const move = (y: number) => {
    if (drag === undefined) return false;
    const dy = y - drag.y;
    if (drag.mode === undefined) {
      if (Math.abs(dy) < 6) return false;
      const expanding = dy < 0 && visible < full - 1;
      const collapsing = dy > 0 && sheet.scrollTop <= 0;
      drag.mode = drag.grip || expanding || collapsing ? "sheet" : "scroll";
      if (drag.mode === "sheet") sheet.classList.add("dragging");
    }
    if (drag.mode !== "sheet") return false;
    const now = performance.now();
    // Pixels per millisecond, downwards positive; smoothed over the last moves.
    if (now > drag.lastT)
      drag.speed = 0.7 * ((y - drag.lastY) / (now - drag.lastT)) + 0.3 * drag.speed;
    drag.lastY = y;
    drag.lastT = now;
    // Past the ends it gives a little, then stops.
    const wanted = drag.from - dy;
    const shown =
      wanted > full
        ? full + (wanted - full) / 4
        : wanted < peek
          ? peek - (peek - wanted) / 4
          : wanted;
    place(Math.min(full + 24, Math.max(peek - 24, shown)), false);
    return true;
  };
  const end = () => {
    if (drag?.mode === "sheet") {
      sheet.classList.remove("dragging");
      swallow = true;
      setTimeout(() => (swallow = false), 0);
      // A flick, or a clear pull, goes on to the next height that way; anything else
      // settles at the nearest one.
      const pulled = visible - drag.from;
      const way =
        drag.speed < -FLICK || (Math.abs(drag.speed) <= FLICK && pulled > PULL)
          ? "up"
          : drag.speed > FLICK || (Math.abs(drag.speed) <= FLICK && pulled < -PULL)
            ? "down"
            : undefined;
      const snaps: ReadonlyArray<Snap> = ["peek", "half", "full"];
      const nearest =
        way === "up"
          ? (snaps.find((snap) => heightOf(snap) > visible) ?? "full")
          : way === "down"
            ? (snaps.findLast((snap) => heightOf(snap) < visible) ?? "peek")
            : snaps.reduce((best, snap) =>
                Math.abs(heightOf(snap) - visible) < Math.abs(heightOf(best) - visible)
                  ? snap
                  : best,
              );
      rest(nearest);
    }
    drag = undefined;
  };

  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (event.touches.length === 1 && touch !== undefined) begin(touch.clientY);
    else drag = undefined;
  };
  const onTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (touch !== undefined && move(touch.clientY)) event.preventDefault();
  };
  // Mice drag by the grip only; their wheel scrolls the content. Followed on the window, not
  // captured: a plain click still lands on the button under it.
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "mouse") move(event.clientY);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    end();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || !narrow.matches) return;
    if (event.clientY - sheet.getBoundingClientRect().top >= GRIP) return;
    begin(event.clientY);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };
  // A drag that ends over a button isn't a press of it.
  const onClick = (event: MouseEvent) => {
    if (!swallow) return;
    event.preventDefault();
    event.stopPropagation();
  };

  sheet.addEventListener("touchstart", onTouchStart, { passive: true });
  sheet.addEventListener("touchmove", onTouchMove, { passive: false });
  sheet.addEventListener("touchend", end);
  sheet.addEventListener("touchcancel", end);
  sheet.addEventListener("pointerdown", onPointerDown);
  sheet.addEventListener("click", onClick, true);
  const observer = new ResizeObserver(setUp);
  observer.observe(container);
  narrow.addEventListener("change", setUp);
  setUp();

  return {
    /** The grip's tap: up to full, or back to half. */
    toggle: () => narrow.matches && rest(resting === "full" ? "half" : "full"),
    /** New content in a sheet that's down: lift it so the content shows. */
    reveal: () => narrow.matches && resting === "peek" && rest("half"),
    dispose: () => {
      observer.disconnect();
      narrow.removeEventListener("change", setUp);
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", end);
      sheet.removeEventListener("touchcancel", end);
      sheet.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      sheet.removeEventListener("click", onClick, true);
    },
  };
};
