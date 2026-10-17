// Read-only file system mount for the stored archives (docs/decisions.md, D-03).
//
// The archives are several GB and live in OPFS behind the worker bridge, so
// they are never copied into the Emscripten heap: each mount lists exactly the
// stored files of one kind and every read goes through FileBridge.readSync.
// The file system type is shaped after Emscripten's WORKERFS
// (src/lib/libworkerfs.js): a flat root directory, files with the stored size,
// reads backed by a byte source, and every mutation refused.

import type { GameKind } from "./install";
import type { StoredFile } from "./opfs-store";
import type { FileBridge } from "./bridge";

export const MOUNT_POINTS: { zh: "/GeneralsZH"; generals: "/Generals" } = {
  zh: "/GeneralsZH",
  generals: "/Generals",
};

// Emscripten's errno numbering (the numbers the generated JS uses).
const ENOENT = 44;
const EPERM = 63;
const EINVAL = 22;

const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const DIR_MODE = S_IFDIR | 0o555;
const FILE_MODE = S_IFREG | 0o444;

const SEEK_SET = 0;
const SEEK_CUR = 1;
const SEEK_END = 2;

function errno(FS: any, code: number): Error {
  return new FS.ErrnoError(code);
}

// One file system type listing exactly one kind's stored files, as WORKERFS
// lists the File objects handed to it in `mount.opts`.
function createReadOnlyFS(FS: any, bridge: FileBridge, files: readonly StoredFile[]): any {
  const nodeOps = {
    getattr(node: any) {
      return {
        dev: 1,
        ino: node.id,
        mode: node.mode,
        nlink: 1,
        uid: 0,
        gid: 0,
        rdev: 0,
        size: node.size,
        atime: new Date(node.atime),
        mtime: new Date(node.mtime),
        ctime: new Date(node.ctime),
        blksize: 4096,
        blocks: Math.ceil(node.size / 4096),
      };
    },
    setattr(node: any, attr: any) {
      // Times may be touched (futimens); everything else is read-only.
      for (const key of ["mode", "atime", "mtime", "ctime"]) {
        if (attr[key] != null) node[key] = attr[key];
      }
    },
    lookup(_parent: any, _name: string) {
      // Files are hashed by FS.createNode, so an unknown name never reaches
      // here: FS.lookupNode throws ENOENT for it before calling lookup.
      throw errno(FS, ENOENT);
    },
    mknod() {
      throw errno(FS, EPERM);
    },
    rename() {
      throw errno(FS, EPERM);
    },
    unlink() {
      throw errno(FS, EPERM);
    },
    rmdir() {
      throw errno(FS, EPERM);
    },
    readdir(node: any) {
      return [".", "..", ...Object.keys(node.contents ?? {})];
    },
    symlink() {
      throw errno(FS, EPERM);
    },
  };

  const streamOps = {
    read(stream: any, buffer: Uint8Array, offset: number, length: number, position: number) {
      const file: StoredFile = stream.node.contents;
      if (length === 0 || position >= file.size) return 0;
      const wanted = Math.min(length, file.size - position);
      // The bridge reads straight into this slice; nothing is staged in between.
      return bridge.readSync(file.kind, file.name, position, buffer.subarray(offset, offset + wanted));
    },
    write() {
      throw errno(FS, EPERM);
    },
    llseek(stream: any, offset: number, whence: number) {
      let position = offset;
      if (whence === SEEK_CUR) {
        position += stream.position;
      } else if (whence === SEEK_END) {
        if (FS.isFile(stream.node.mode)) position += stream.node.size;
      } else if (whence !== SEEK_SET) {
        throw errno(FS, EINVAL);
      }
      if (position < 0) throw errno(FS, EINVAL);
      return position;
    },
  };

  function createNode(parent: any, name: string, mode: number, dev: number, file?: StoredFile): any {
    const node = FS.createNode(parent, name, mode, dev);
    node.node_ops = nodeOps;
    node.stream_ops = streamOps;
    node.atime = node.mtime = node.ctime = Date.now();
    if (file === undefined) {
      // Directories keep their children by name, as WORKERFS does: readdir
      // lists them from here.
      node.size = 4096;
      node.contents = {};
    } else {
      node.size = file.size;
      node.contents = file;
    }
    if (parent !== null) parent.contents[name] = node;
    return node;
  }

  return {
    mount(mount: any) {
      const root = createNode(null, "/", DIR_MODE, 0);
      for (const file of mount.opts.files ?? []) {
        createNode(root, file.name, FILE_MODE, 0, file);
      }
      return root;
    },
  };
}

export function mountArchives(FS: any, bridge: FileBridge, files: StoredFile[]): void {
  for (const kind of ["zh", "generals"] as const) {
    const ofKind = files.filter((file) => file.kind === kind);
    if (ofKind.length === 0) continue;
    const point = MOUNT_POINTS[kind];
    if (FS.analyzePath(point, { follow_mount: false }).node === undefined) {
      FS.mkdir(point);
    }
    FS.mount({ mount: (mount: any) => createReadOnlyFS(FS, bridge, ofKind).mount(mount) }, { files: ofKind }, point);
  }
}
