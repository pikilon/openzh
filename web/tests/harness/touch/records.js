// Fake engine for the touch-controls spec (#187) and the zoom bar (#195). It
// gives the page a visible canvas, records the pointer, keyboard and wheel
// events the page synthesises, and records every analog camera-pan call. Raw
// touch events reach this engine only if the page fails to capture them, which
// is exactly what test 11 checks.

export default async function factory(options) {
  const canvas = options.canvas;
  canvas.width = 1024;
  canvas.height = 768;

  const probe = window;
  probe.__fakeEngineLoaded = "touch";
  probe.__touchPointer = [];
  probe.__touchKeys = [];
  probe.__panCalls = [];
  probe.__zoomCalls = [];
  probe.__wheelEvents = [];

  for (const type of ["pointerdown", "pointermove", "pointerup"]) {
    canvas.addEventListener(type, (event) => {
      probe.__touchPointer.push({
        type,
        pointerType: event.pointerType,
        button: event.button,
        buttons: event.buttons,
        x: event.clientX,
        y: event.clientY,
      });
    });
  }

  canvas.addEventListener("wheel", (event) => {
    probe.__wheelEvents.push({
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      defaultPrevented: event.defaultPrevented,
    });
  });

  for (const type of ["keydown", "keyup"]) {
    window.addEventListener(type, (event) => {
      probe.__touchKeys.push({ type, key: event.key, code: event.code });
    });
  }

  const engine = {
    _GeneralsXSetAudioMuted() {
      return 1;
    },
    _GeneralsXPanCamera(x, y) {
      probe.__panCalls.push([x, y]);
      return 1;
    },
    _GeneralsXIsCinematic() {
      return probe.__cinematic ? 1 : 0;
    },
  };
  if (!probe.__noZoomExport) {
    engine._GeneralsXZoomCamera = (notches) => {
      probe.__zoomCalls.push(notches);
      return 1;
    };
  }
  return engine;
}
