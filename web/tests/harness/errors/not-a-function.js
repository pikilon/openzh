// Fake engine module for tests/launcher-errors.spec.ts.
//
// It has a default export, but not a factory function: the launcher must
// reject it instead of calling it.
export default 42;
