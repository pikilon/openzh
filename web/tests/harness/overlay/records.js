// Fake engine module for tests/launcher-debug-overlay.spec.ts (issue #159).
//
// Its factory resolves to an engine object whose `_GeneralsXSetDebugOverlay`
// records every value the page sends in window.__overlayCalls. With
// `&export=missing` added to the page URL it resolves without that export
// instead, the shape of a build that has no debug overlay yet. The launcher
// selects it with the `module` query parameter.
export default async function createFakeEngine() {
  window.__overlayCalls = [];
  window.__fakeEngineLoaded = "overlay";
  if (new URLSearchParams(window.location.search).get("export") === "missing") {
    return {};
  }
  return {
    _GeneralsXSetDebugOverlay(visible) {
      window.__overlayCalls.push(visible);
      return 1;
    },
  };
}
