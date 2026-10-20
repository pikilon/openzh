// Touch controls (docs/specs/touch-controls.md): the toggle, the overlay with
// its three latch buttons and the mini joystick, and the translation of touches
// into the pointer and keyboard events the SDL3 engine already understands.
// Desktop input is untouched: only pointerType "touch" (and "pen") is captured,
// and only while the overlay is shown.

import { readJoystickOffset, readTouchControls, writeJoystickOffset, writeTouchControls } from "./prefs";

const LONG_PRESS_MS = 500;
const MOVE_SLOP_PX = 10;
const DEAD_ZONE = 0.15;

export interface TouchEngine {
  _GeneralsXPanCamera?: (x: number, y: number) => unknown;
}

export interface TouchControlsHost {
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  toggle: HTMLButtonElement;
  left: HTMLButtonElement;
  right: HTMLButtonElement;
  multi: HTMLButtonElement;
  dock: HTMLElement;
  grip: HTMLButtonElement;
  joystick: HTMLElement;
  knob: HTMLElement;
  engine: () => TouchEngine | null;
}

export interface TouchControls {
  // Called by the launcher when the engine starts or stops. The toggle and the
  // overlay are only reachable while the game is playing.
  setPlaying(playing: boolean): void;
  isEnabled(): boolean;
}

type MapMode = "idle" | "pending" | "drag" | "longPress" | "cancelled";

function deviceHasTouch(): boolean {
  try {
    if (navigator.maxTouchPoints > 0) return true;
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

export function createTouchControls(host: TouchControlsHost): TouchControls {
  const { canvas, overlay, toggle, left, right, multi, dock, grip, joystick, knob } = host;

  const stored = readTouchControls();
  let enabled = stored ?? deviceHasTouch();
  let playing = false;

  let leftLock = false;
  let rightLock = false;
  let multiLock = false;

  // ----- synthetic input to the engine -----

  let mouseX = 0;
  let mouseY = 0;

  function mouse(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    button: number,
    buttons: number,
  ): void {
    const movementX = type === "pointermove" ? x - mouseX : 0;
    const movementY = type === "pointermove" ? y - mouseY : 0;
    mouseX = x;
    mouseY = y;
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button,
        buttons,
        clientX: x,
        clientY: y,
        movementX,
        movementY,
      }),
    );
  }

  let shiftHeld = false;

  function setShift(down: boolean): void {
    if (shiftHeld === down) return;
    shiftHeld = down;
    canvas.dispatchEvent(
      new KeyboardEvent(down ? "keydown" : "keyup", {
        key: "Shift",
        code: "ShiftLeft",
        keyCode: 16,
        which: 16,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  }

  function click(x: number, y: number, button: 0 | 2): void {
    if (multiLock) setShift(true);
    try {
      mouse("pointerdown", x, y, button, button === 0 ? 1 : 2);
      mouse("pointerup", x, y, button, 0);
    } finally {
      if (multiLock) setShift(false);
    }
  }

  // ----- map touch state machine -----

  let pointerId: number | null = null;
  let mode: MapMode = "idle";
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let longPressTimer = 0;
  let dragActive = false;

  function clearLongPress(): void {
    if (longPressTimer !== 0) {
      window.clearTimeout(longPressTimer);
      longPressTimer = 0;
    }
  }

  function releaseCapture(): void {
    if (pointerId === null) return;
    try {
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch {
      // A synthetic pointer in the tests has nothing captured.
    }
  }

  function endDrag(): void {
    if (!dragActive) return;
    mouse("pointerup", lastX, lastY, 0, 0);
    dragActive = false;
    setShift(false);
  }

  function resetMap(sendUp: boolean): void {
    clearLongPress();
    if (sendUp) endDrag();
    if (dragActive) {
      dragActive = false;
      setShift(false);
    }
    releaseCapture();
    pointerId = null;
    mode = "idle";
  }

  function fireLongPress(): void {
    if (mode !== "pending") return;
    mode = "longPress";
    click(startX, startY, 2);
  }

  function beginDrag(x: number, y: number): void {
    mode = "drag";
    dragActive = true;
    if (multiLock) setShift(true);
    mouseX = startX;
    mouseY = startY;
    mouse("pointerdown", startX, startY, 0, 1);
    mouse("pointermove", x, y, -1, 1);
  }

  function isTouch(event: PointerEvent): boolean {
    return event.pointerType === "touch" || event.pointerType === "pen";
  }

  function capture(event: PointerEvent): boolean {
    if (!playing || !enabled || !isTouch(event)) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  function onPointerDown(event: PointerEvent): void {
    if (!capture(event)) return;
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    startX = lastX = event.clientX;
    startY = lastY = event.clientY;
    mode = "pending";
    dragActive = false;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers (and browsers without capture) keep bubbling.
    }
    if (!leftLock && !rightLock) {
      longPressTimer = window.setTimeout(fireLongPress, LONG_PRESS_MS);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (!capture(event)) return;
    if (pointerId === null || event.pointerId !== pointerId) return;
    lastX = event.clientX;
    lastY = event.clientY;
    if (mode === "pending" || mode === "cancelled") {
      const moved = Math.hypot(lastX - startX, lastY - startY);
      if (moved > MOVE_SLOP_PX) {
        clearLongPress();
        if (leftLock) beginDrag(lastX, lastY);
        else mode = "cancelled";
      }
      return;
    }
    if (mode === "drag") {
      mouse("pointermove", lastX, lastY, -1, 1);
    }
  }

  function onPointerUp(event: PointerEvent): void {
    if (!capture(event)) return;
    if (pointerId === null || event.pointerId !== pointerId) return;
    clearLongPress();
    lastX = event.clientX;
    lastY = event.clientY;

    const wasDrag = mode === "drag";
    const wasLongPress = mode === "longPress";
    const wasCancelled = mode === "cancelled";
    const pointX = startX;
    const pointY = startY;
    resetMap(wasDrag);

    if (wasDrag || wasLongPress || wasCancelled) return;
    if (rightLock) {
      click(pointX, pointY, 2);
    } else {
      click(pointX, pointY, 0);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (!capture(event)) return;
    if (pointerId === null || event.pointerId !== pointerId) return;
    resetMap(true);
  }

  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const) {
    const handler =
      type === "pointerdown"
        ? onPointerDown
        : type === "pointermove"
          ? onPointerMove
          : type === "pointerup"
            ? onPointerUp
            : onPointerCancel;
    canvas.addEventListener(type, handler, { capture: true, passive: false });
  }

  // ----- locks and the overlay -----

  function setLock(which: "left" | "right" | "multi", on: boolean): void {
    if (which === "left") leftLock = on;
    else if (which === "right") rightLock = on;
    else multiLock = on;
    const button = which === "left" ? left : which === "right" ? right : multi;
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function clearLocks(): void {
    setLock("left", false);
    setLock("right", false);
    setLock("multi", false);
  }

  left.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setLock("left", !leftLock);
  });
  right.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setLock("right", !rightLock);
  });
  multi.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setLock("multi", !multiLock);
  });

  // A touch on the overlay must never reach the map, even if a future layout
  // puts it above the canvas instead of beside it.
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "contextmenu"]) {
    overlay.addEventListener(
      type,
      (event) => {
        event.stopPropagation();
        if (type === "contextmenu") event.preventDefault();
      },
      { passive: false },
    );
  }

  function showOverlay(show: boolean): void {
    overlay.hidden = !show;
    toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
    if (show) restoreDock();
    if (!show) {
      clearLocks();
      resetMap(true);
      resetJoystick();
    }
  }

  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    enabled = !enabled;
    writeTouchControls(enabled);
    showOverlay(playing && enabled);
  });

  // ----- joystick -----

  let joystickPointer: number | null = null;
  let joyX = 0;
  let joyY = 0;
  let panFrame = 0;

  function pan(x: number, y: number): void {
    const engine = host.engine();
    const fn = engine?._GeneralsXPanCamera;
    if (typeof fn === "function") {
      try {
        fn.call(engine, x, y);
      } catch {
        // A stopped engine is not a page error.
      }
    }
  }

  function panTick(): void {
    panFrame = 0;
    if (joystickPointer === null) return;
    pan(joyX, joyY);
    panFrame = window.requestAnimationFrame(panTick);
  }

  function startPan(): void {
    if (panFrame === 0) panFrame = window.requestAnimationFrame(panTick);
  }

  function resetJoystick(): void {
    const wasActive = joystickPointer !== null || panFrame !== 0;
    if (panFrame !== 0) {
      window.cancelAnimationFrame(panFrame);
      panFrame = 0;
    }
    if (joystickPointer !== null) {
      try {
        if (joystick.hasPointerCapture(joystickPointer)) {
          joystick.releasePointerCapture(joystickPointer);
        }
      } catch {
        // Nothing captured for a synthetic pointer.
      }
    }
    joystickPointer = null;
    joyX = 0;
    joyY = 0;
    joystick.classList.remove("is-active");
    knob.style.transform = "translate(0px, 0px)";
    // Only tell the engine to stop when the joystick was actually pushing.
    if (wasActive) pan(0, 0);
  }

  function updateJoystick(clientX: number, clientY: number): void {
    const rect = joystick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const knobRadius = knob.offsetWidth / 2 || 20;
    const limit = Math.max(1, Math.min(rect.width, rect.height) / 2 - knobRadius);

    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);
    if (distance > limit) {
      dx = (dx / distance) * limit;
      dy = (dy / distance) * limit;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;

    let nx = dx / limit;
    let ny = dy / limit;
    const magnitude = Math.hypot(nx, ny);
    if (magnitude < DEAD_ZONE) {
      joyX = 0;
      joyY = 0;
      return;
    }
    if (magnitude > 1) {
      nx /= magnitude;
      ny /= magnitude;
    }
    joyX = nx;
    joyY = ny;
  }

  function onJoystickDown(event: PointerEvent): void {
    if (!isTouch(event) || joystickPointer !== null) return;
    event.preventDefault();
    event.stopPropagation();
    joystickPointer = event.pointerId;
    joystick.classList.add("is-active");
    try {
      joystick.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer.
    }
    updateJoystick(event.clientX, event.clientY);
    startPan();
  }

  function onJoystickMove(event: PointerEvent): void {
    if (joystickPointer === null || event.pointerId !== joystickPointer) return;
    event.preventDefault();
    event.stopPropagation();
    updateJoystick(event.clientX, event.clientY);
  }

  function onJoystickUp(event: PointerEvent): void {
    if (joystickPointer === null || event.pointerId !== joystickPointer) return;
    event.preventDefault();
    event.stopPropagation();
    resetJoystick();
  }

  joystick.addEventListener("pointerdown", onJoystickDown, { passive: false });
  joystick.addEventListener("pointermove", onJoystickMove, { passive: false });
  joystick.addEventListener("pointerup", onJoystickUp, { passive: false });
  joystick.addEventListener("pointercancel", onJoystickUp, { passive: false });

  // A lost capture or a window blur must not leave a finger latched down.
  joystick.addEventListener("lostpointercapture", () => resetJoystick());
  window.addEventListener("blur", () => {
    resetMap(true);
    resetJoystick();
  });

  // ----- moving the joystick -----

  // The dock sits at a default spot and is shifted by (dx, dy) from there. The
  // shift is clamped so the dock always stays inside the overlay.
  let dockDx = 0;
  let dockDy = 0;
  let gripPointer: number | null = null;
  let gripStartX = 0;
  let gripStartY = 0;
  let gripBaseDx = 0;
  let gripBaseDy = 0;

  function applyDock(dx: number, dy: number): void {
    const area = overlay.getBoundingClientRect();
    const box = dock.getBoundingClientRect();
    if (area.width > 0 && area.height > 0 && box.width > 0) {
      // box already includes the current shift, so work from its default spot.
      const baseLeft = box.left - dockDx;
      const baseTop = box.top - dockDy;
      dx = Math.min(Math.max(dx, area.left - baseLeft), area.right - box.width - baseLeft);
      dy = Math.min(Math.max(dy, area.top - baseTop), area.bottom - box.height - baseTop);
    }
    dockDx = dx;
    dockDy = dy;
    dock.style.transform = dx === 0 && dy === 0 ? "" : `translate(${dx}px, ${dy}px)`;
  }

  grip.addEventListener("pointerdown", (event) => {
    if (gripPointer !== null) return;
    event.preventDefault();
    event.stopPropagation();
    gripPointer = event.pointerId;
    gripStartX = event.clientX;
    gripStartY = event.clientY;
    gripBaseDx = dockDx;
    gripBaseDy = dockDy;
    dock.classList.add("is-moving");
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer.
    }
  });
  grip.addEventListener("pointermove", (event) => {
    if (gripPointer === null || event.pointerId !== gripPointer) return;
    event.preventDefault();
    event.stopPropagation();
    applyDock(gripBaseDx + event.clientX - gripStartX, gripBaseDy + event.clientY - gripStartY);
  });
  function endGrip(event: PointerEvent): void {
    if (gripPointer === null || event.pointerId !== gripPointer) return;
    event.preventDefault();
    event.stopPropagation();
    gripPointer = null;
    dock.classList.remove("is-moving");
    writeJoystickOffset(dockDx === 0 && dockDy === 0 ? null : { dx: dockDx, dy: dockDy });
  }
  grip.addEventListener("pointerup", endGrip);
  grip.addEventListener("pointercancel", endGrip);

  // A stored spot from a bigger screen is pulled back inside this one.
  function restoreDock(): void {
    const stored = readJoystickOffset();
    applyDock(stored?.dx ?? 0, stored?.dy ?? 0);
  }
  window.addEventListener("resize", () => {
    if (!overlay.hidden) restoreDock();
  });

  // ----- public state -----

  function applyPlaying(next: boolean): void {
    playing = next;
    toggle.hidden = !next;
    if (!next) {
      showOverlay(false);
      return;
    }
    showOverlay(enabled);
  }

  // The initial markup has both elements hidden; the launcher only reveals the
  // toggle once the game is playing.
  showOverlay(false);

  return {
    setPlaying: applyPlaying,
    isEnabled: () => enabled,
  };
}
