// Fake engine module for tests/launcher-1080p.spec.ts (issue #173).
//
// It gives the canvas the drawing buffer a fresh web install now uses
// (1920x1080) and then resolves. The page must display the whole canvas below
// #topbar without scrolling the page: width-limited to 1280x720 at a 1280x800
// window, height-limited to 1024 px tall at a 1920x1080 window, always keeping
// the drawing buffer's 16:9 shape and never changing the buffer itself.
export default async function createFakeEngine(options) {
  const canvas = options.canvas;
  canvas.width = 1920;
  canvas.height = 1080;
  window.__fakeCanvasSize = { width: canvas.width, height: canvas.height };
}
