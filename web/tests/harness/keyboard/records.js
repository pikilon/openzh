// Fake engine module for tests/launcher-keyboard.spec.ts (issue #202).
//
// Its factory resolves to an engine object whose `_GeneralsXSetKeyMap` records
// every six-scancode call in window.__keyMapCalls. With `&export=missing` it
// resolves without that export, the shape of an older engine build.
export default async function createFakeEngine() {
  window.__fakeEngineLoaded = "keyboard";
  if (new URLSearchParams(window.location.search).get("export") === "missing") {
    return {};
  }
  window.__keyMapCalls = [];
  return {
    _GeneralsXSetKeyMap(up, down, left, right, selectAll, stop) {
      window.__keyMapCalls.push([up, down, left, right, selectAll, stop]);
      return 1;
    },
  };
}
