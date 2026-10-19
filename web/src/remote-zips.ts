// Fetches the game ZIPs from links: plain https URLs, or a magnet link or
// .torrent over WebTorrent. Each ZIP is streamed into a scratch OPFS directory
// (never held in memory) and handed to the importer as a disk-backed File.

const SCRATCH_DIR = "zhwp-downloads";

export interface DownloadProgress {
  source: string;
  receivedBytes: number;
  totalBytes: number;
  detail?: string;
}

export interface DownloadOptions {
  signal: AbortSignal;
  onProgress: (progress: DownloadProgress) => void;
}

export class DownloadError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(message);
  }
}

export function isTorrentSource(source: string): boolean {
  return source.startsWith("magnet:") || /\.torrent(\?.*)?$/i.test(source);
}

/** One link per line (commas and spaces also separate); blanks are dropped. */
export function parseSources(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export function checkSource(source: string): string | null {
  if (source.startsWith("magnet:")) return /xt=urn:btih:/i.test(source) ? null : "that magnet link has no torrent id";
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return "that is not a link";
  }
  return url.protocol === "https:" || url.protocol === "http:" ? null : "only https links and magnet links work";
}

async function scratch(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(SCRATCH_DIR, { create: true });
}

export async function discardDownloads(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(SCRATCH_DIR, { recursive: true });
  } catch {
    // Nothing downloaded, or already gone.
  }
}

function fileName(source: string, index: number): string {
  let name = "";
  try {
    name = decodeURIComponent(new URL(source).pathname.split("/").pop() ?? "");
  } catch {
    // Keep the numbered fallback.
  }
  name = name.replace(/[^\w.\- ]/g, "_");
  return `${index}-${name === "" ? "download.zip" : name}`;
}

/** Streams `body` into a scratch file, reporting bytes as they land. */
export async function writeScratch(
  name: string,
  body: ReadableStream<Uint8Array>,
  onBytes: (received: number) => void,
  signal: AbortSignal,
): Promise<File> {
  const handle = await (await scratch()).getFileHandle(name, { create: true });
  const writable = await (
    handle as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }
  ).createWritable();
  let received = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      received += value.byteLength;
      onBytes(received);
    }
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return handle.getFile();
}

async function downloadUrl(source: string, index: number, options: DownloadOptions): Promise<File[]> {
  let response: Response;
  try {
    response = await fetch(source, { signal: options.signal });
  } catch (error) {
    if ((error as DOMException).name === "AbortError") throw error;
    throw new DownloadError(source, "could not be fetched (the server must allow cross-origin downloads, CORS)");
  }
  if (!response.ok || response.body === null) throw new DownloadError(source, `answered ${response.status}`);
  const totalBytes = Number(response.headers.get("content-length") ?? 0);
  const file = await writeScratch(
    fileName(source, index),
    response.body,
    (receivedBytes) => options.onProgress({ source, receivedBytes, totalBytes }),
    options.signal,
  );
  return [file];
}

async function downloadTorrent(source: string, index: number, options: DownloadOptions): Promise<File[]> {
  // The torrent client is a separate script, fetched only when a torrent is used.
  let id: string | Uint8Array = source;
  if (!source.startsWith("magnet:")) {
    let response: Response;
    try {
      response = await fetch(source, { signal: options.signal });
    } catch (error) {
      if ((error as DOMException).name === "AbortError") throw error;
      throw new DownloadError(source, "could not be fetched (the server must allow cross-origin downloads, CORS)");
    }
    if (!response.ok) throw new DownloadError(source, `answered ${response.status}`);
    id = new Uint8Array(await response.arrayBuffer());
  }
  const client = (await import(/* @vite-ignore */ new URL("./torrent-client.js", import.meta.url).href)) as {
    downloadTorrentZips(
      source: string | Uint8Array,
      label: string,
      index: number,
      options: DownloadOptions,
      write: typeof writeScratch,
    ): Promise<File[]>;
  };
  return client.downloadTorrentZips(id, source, index, options, writeScratch);
}

export async function downloadZips(sources: readonly string[], options: DownloadOptions): Promise<File[]> {
  await discardDownloads();
  const files: File[] = [];
  try {
    for (const [index, source] of sources.entries()) {
      const problem = checkSource(source);
      if (problem !== null) throw new DownloadError(source, problem);
      files.push(...(await (isTorrentSource(source) ? downloadTorrent : downloadUrl)(source, index, options)));
    }
  } catch (error) {
    await discardDownloads();
    throw error;
  }
  return files;
}
