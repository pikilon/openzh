// Loaded on demand by remote-zips.ts. WebTorrent in the browser talks to peers
// over WebRTC (and to web seeds over HTTP); pieces are kept in IndexedDB so a
// multi-gigabyte torrent never sits in memory, and each ZIP is then streamed
// out to the scratch directory.

// @ts-expect-error the browser build ships without types
import WebTorrent from "webtorrent/dist/webtorrent.min.js";
// @ts-expect-error no types
import IDBChunkStore from "idb-chunk-store";
import { Buffer } from "buffer";
import type { DownloadOptions, writeScratch } from "./remote-zips";

// The chunk store reads the global Buffer, which browsers do not have.
(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;

interface TorrentFile {
  name: string;
  length: number;
  stream(): ReadableStream<Uint8Array>;
  select(): void;
  deselect(): void;
}
interface Torrent {
  files: TorrentFile[];
  numPeers: number;
  downloaded: number;
  downloadSpeed: number;
  on(event: string, listener: (...args: unknown[]) => void): void;
  destroy(options?: { destroyStore?: boolean }, callback?: () => void): void;
}
interface Client {
  add(id: string | Uint8Array, options: object, onTorrent: (torrent: Torrent) => void): Torrent;
  on(event: string, listener: (...args: unknown[]) => void): void;
  destroy(): void;
}

export async function downloadTorrentZips(
  id: string | Uint8Array,
  source: string,
  index: number,
  options: DownloadOptions,
  write: typeof writeScratch,
): Promise<File[]> {
  const client = new (WebTorrent as new () => Client)();
  let torrent: Torrent | null = null;
  const stop = () => {
    torrent?.destroy({ destroyStore: true });
    client.destroy();
  };
  try {
    const ready = await new Promise<Torrent>((resolve, reject) => {
      client.on("error", (error) => reject(error));
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      torrent = client.add(id, { store: IDBChunkStore, deselect: true }, resolve);
    });
    const zips = ready.files.filter((file) => file.name.toLowerCase().endsWith(".zip"));
    if (zips.length === 0) throw new Error("the torrent has no ZIP files");
    const totalBytes = zips.reduce((sum, file) => sum + file.length, 0);
    for (const file of zips) file.select();
    let before = 0;
    const files: File[] = [];
    for (const [n, zip] of zips.entries()) {
      const done = before;
      files.push(
        await write(
          `${index}-${n}-${zip.name.replace(/[^\w.\- ]/g, "_")}`,
          zip.stream(),
          (received) =>
            options.onProgress({
              source,
              receivedBytes: done + received,
              totalBytes,
              detail: `${ready.numPeers} peers`,
            }),
          options.signal,
        ),
      );
      before += zip.length;
    }
    return files;
  } finally {
    stop();
  }
}
