// Builds a synthetic BIGF archive (C&C Generals .big layout) for tests.
// Layout: "BIGF", u32 LE archive size, u32 BE entry count, u32 BE header size,
// then per entry: u32 BE offset, u32 BE size, NUL-terminated path; then data.
export function buildBig(entries: { path: string; data: Uint8Array | string }[]): Uint8Array {
  const enc = new TextEncoder();
  const files = entries.map((e) => ({
    path: enc.encode(e.path),
    data: typeof e.data === "string" ? enc.encode(e.data) : e.data,
  }));
  const headerSize = 16 + files.reduce((n, f) => n + 8 + f.path.length + 1, 0);
  const total = headerSize + files.reduce((n, f) => n + f.data.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(enc.encode("BIGF"), 0);
  view.setUint32(4, total, true);
  view.setUint32(8, files.length, false);
  view.setUint32(12, headerSize, false);
  let pos = 16;
  let dataPos = headerSize;
  for (const f of files) {
    view.setUint32(pos, dataPos, false);
    view.setUint32(pos + 4, f.data.length, false);
    out.set(f.path, pos + 8);
    pos += 8 + f.path.length + 1;
    out.set(f.data, dataPos);
    dataPos += f.data.length;
  }
  return out;
}
