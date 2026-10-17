// Fake engine module for tests/launcher-window-layout.spec.ts (issue #97).
//
// It gives the canvas the drawing buffer of a wide game image (1280x720) and
// then resolves. The page must display the whole canvas as the largest 16:9
// rectangle below its playing controls, without scrolling the page and without
// changing the drawing buffer.
export default async function createFakeEngine(options) {
  const canvas = options.canvas;
  canvas.width = 1280;
  canvas.height = 720;
  window.__fakeCanvasSize = { width: canvas.width, height: canvas.height };
}
