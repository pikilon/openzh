// Fake engine module for tests/launcher-canvas.spec.ts (issue #80).
//
// It gives the canvas the drawing-buffer size the real engine uses at
// start-up (1024x768) and then resolves. The page must display the whole
// canvas inside a 1280x800 viewport without changing the drawing buffer.
export default async function createFakeEngine(options) {
  const canvas = options.canvas;
  canvas.width = 1024;
  canvas.height = 768;
  window.__fakeCanvasSize = { width: canvas.width, height: canvas.height };
}
