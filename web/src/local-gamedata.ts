// Reads the game folder the development server exposes (docs/briefs/72-local-gamedata.md):
// a JSON index of the .big archives and their bytes, read-only. No DOM access
// here; main.ts owns the status text, the progress bar and OPFS.

export interface LocalArchive {
  path: string;
  size: number;
}

const INDEX_URL = "/gamedata/index.json";
const FILES_URL = "/gamedata/files/";

// The index of listed archives, or null when the server does not expose one
// (disabled, 404, network failure or an unexpected body): the launcher then
// behaves exactly as it did before #72.
export async function fetchLocalIndex(): Promise<LocalArchive[] | null> {
  let response: Response;
  try {
    response = await fetch(INDEX_URL, { cache: "no-store" });
  } catch {
    return null;
  }
  if (response.status !== 200) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  const files = (body as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return null;
  const archives: LocalArchive[] = [];
  for (const entry of files) {
    if (typeof entry !== "object" || entry === null) continue;
    const { path, size } = entry as { path?: unknown; size?: unknown };
    if (typeof path !== "string" || typeof size !== "number" || !Number.isFinite(size)) continue;
    archives.push({ path, size });
  }
  return archives;
}

// Fetches one archive the index listed, by its exact relative path. Each
// segment is encoded so spaces and separators stay part of the name.
export async function fetchLocalArchive(path: string): Promise<Blob> {
  const url = FILES_URL + path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(url, { cache: "no-store" });
  if (response.status !== 200) {
    throw new Error(`local game file ${path}: HTTP ${response.status}`);
  }
  return response.blob();
}
