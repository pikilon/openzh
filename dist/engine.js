// src/opfs-store.ts
var ROOT_DIR = "zhwp";
var KINDS = ["zh", "generals"];
async function kindDirectory(kind, create) {
  const root = await navigator.storage.getDirectory();
  let parent;
  try {
    parent = await root.getDirectoryHandle(ROOT_DIR, { create });
  } catch (error) {
    if (!create && error.name === "NotFoundError") return null;
    throw error;
  }
  try {
    return await parent.getDirectoryHandle(kind, { create });
  } catch (error) {
    if (!create && error.name === "NotFoundError") return null;
    throw error;
  }
}
async function listStored() {
  const stored = [];
  for (const kind of KINDS) {
    const dir = await kindDirectory(kind, false);
    if (dir === null) continue;
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "file") continue;
      const size = await handle.getFile().then((f) => f.size);
      stored.push({ kind, name, size });
    }
  }
  stored.sort(
    (a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.name.localeCompare(b.name)
  );
  return stored;
}

// src/bridge.ts
var REQ = 0;
var STATUS = 1;
var INDEX = 2;
var LENGTH = 3;
var ERROR = 4;
var CLOSE = 5;
var CONTROL_LEN = 6;
var BLOCK = 4 * 1024 * 1024;
var FileBridge = class _FileBridge {
  constructor(worker, shared, files, readTimeoutMs) {
    this.worker = worker;
    this.shared = shared;
    this.files = files;
    this.readTimeoutMs = readTimeoutMs;
  }
  worker;
  shared;
  files;
  readTimeoutMs;
  static DEFAULT_READ_TIMEOUT_MS = 1e4;
  dead = false;
  closeStarted = false;
  static async start(files, workerUrl, options) {
    const timeout = options?.readTimeoutMs;
    const readTimeoutMs = timeout === void 0 ? _FileBridge.DEFAULT_READ_TIMEOUT_MS : timeout;
    const url = workerUrl ?? new URL("./bridge-worker.js", import.meta.url);
    const worker = new Worker(url, { type: "module" });
    const controlBuffer = new SharedArrayBuffer(CONTROL_LEN * 4 + 8);
    const dataBuffer = new SharedArrayBuffer(BLOCK);
    const shared = {
      control: new Int32Array(controlBuffer),
      position: new Float64Array(controlBuffer, CONTROL_LEN * 4, 1),
      data: new Uint8Array(dataBuffer)
    };
    let failure = "";
    const ready = new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
        if (event.data.ready) resolve();
        else if (event.data.error) reject(new Error(event.data.error));
      };
      worker.onerror = (event) => {
        failure = String(event.message ?? event.error ?? "worker error");
        reject(new Error(failure));
      };
    });
    worker.postMessage(
      {
        files: files.map((file) => ({ kind: file.kind, name: file.name })),
        control: controlBuffer,
        data: dataBuffer
      },
      []
    );
    try {
      await ready;
    } catch (error) {
      worker.terminate();
      throw error;
    }
    return new _FileBridge(worker, shared, files, readTimeoutMs);
  }
  size(kind, name) {
    const index = this.index(kind, name);
    return this.files[index].size;
  }
  readSync(kind, name, position, target) {
    if (this.dead || this.closeStarted) throw new Error(`bridge closed: cannot read ${kind}/${name}`);
    const index = this.index(kind, name);
    const file = this.files[index];
    if (!Number.isFinite(position) || position < 0) throw new Error(`bad read position: ${position}`);
    if (position >= file.size) return 0;
    const wanted = Math.min(target.length, file.size - position);
    let readTotal = 0;
    while (readTotal < wanted) {
      const chunk = Math.min(BLOCK, wanted - readTotal);
      let read;
      try {
        read = this.request(index, position + readTotal, chunk);
      } catch (error) {
        this.giveUp();
        throw error;
      }
      if (read <= 0) break;
      target.set(this.shared.data.subarray(0, Math.min(read, chunk)), readTotal);
      readTotal += read;
      if (read < chunk) break;
    }
    return readTotal;
  }
  async close() {
    if (this.dead || this.closeStarted) return;
    this.closeStarted = true;
    const { control } = this.shared;
    Atomics.store(control, CLOSE, 1);
    Atomics.store(control, REQ, 1);
    Atomics.notify(control, REQ);
    if (this.spin(() => Atomics.load(control, CLOSE) === 0)) {
      this.dead = true;
      this.worker.terminate();
    } else {
      this.giveUp();
    }
  }
  index(kind, name) {
    const index = this.files.findIndex((file) => file.kind === kind && file.name === name);
    if (index < 0) throw new Error(`unknown file: ${kind}/${name}`);
    return index;
  }
  request(index, position, length) {
    const { control, data, position: positionView } = this.shared;
    positionView[0] = position;
    Atomics.store(control, INDEX, index);
    Atomics.store(control, LENGTH, length);
    Atomics.store(control, STATUS, 0);
    Atomics.store(control, REQ, 1);
    Atomics.notify(control, REQ);
    const file = this.files[index];
    if (!this.spin(() => Atomics.load(control, STATUS) === 1)) {
      throw new Error(`read timed out: ${file.kind}/${file.name} at ${position}`);
    }
    const read = Atomics.load(control, LENGTH);
    if (Atomics.load(control, ERROR) === 1) {
      throw new Error(`read failed: ${file.kind}/${file.name} at ${position}`);
    }
    return read;
  }
  // Marks the bridge unusable and kills the worker: the caller keeps running.
  giveUp() {
    this.dead = true;
    this.worker.terminate();
  }
  // Busy-wait: the worker answers in microseconds and cannot wake us. The
  // time limit is checked every 1024 iterations so a stalled worker cannot
  // block the main thread forever. Returns false on time-out.
  spin(done) {
    let iterations = 0;
    const deadline = performance.now() + this.readTimeoutMs;
    while (!done()) {
      if ((++iterations & 1023) === 0 && performance.now() >= deadline) return false;
    }
    return true;
  }
};

// src/mount.ts
var MOUNT_POINTS = {
  zh: "/GeneralsZH",
  generals: "/Generals"
};
var ENOENT = 44;
var EPERM = 63;
var EINVAL = 22;
var S_IFDIR = 16384;
var S_IFREG = 32768;
var DIR_MODE = S_IFDIR | 365;
var FILE_MODE = S_IFREG | 292;
var SEEK_SET = 0;
var SEEK_CUR = 1;
var SEEK_END = 2;
function errno(FS, code) {
  return new FS.ErrnoError(code);
}
function createReadOnlyFS(FS, bridge, files) {
  const nodeOps = {
    getattr(node) {
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
        blocks: Math.ceil(node.size / 4096)
      };
    },
    setattr(node, attr) {
      for (const key of ["mode", "atime", "mtime", "ctime"]) {
        if (attr[key] != null) node[key] = attr[key];
      }
    },
    lookup(_parent, _name) {
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
    readdir(node) {
      return [".", "..", ...Object.keys(node.contents ?? {})];
    },
    symlink() {
      throw errno(FS, EPERM);
    }
  };
  const streamOps = {
    read(stream, buffer, offset, length, position) {
      const file = stream.node.contents;
      if (length === 0 || position >= file.size) return 0;
      const wanted = Math.min(length, file.size - position);
      return bridge.readSync(file.kind, file.name, position, buffer.subarray(offset, offset + wanted));
    },
    write() {
      throw errno(FS, EPERM);
    },
    llseek(stream, offset, whence) {
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
    }
  };
  function createNode(parent, name, mode, dev, file) {
    const node = FS.createNode(parent, name, mode, dev);
    node.node_ops = nodeOps;
    node.stream_ops = streamOps;
    node.atime = node.mtime = node.ctime = Date.now();
    if (file === void 0) {
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
    mount(mount) {
      const root = createNode(null, "/", DIR_MODE, 0);
      for (const file of mount.opts.files ?? []) {
        createNode(root, file.name, FILE_MODE, 0, file);
      }
      return root;
    }
  };
}
function mountArchives(FS, bridge, files) {
  for (const kind of ["zh", "generals"]) {
    const ofKind = files.filter((file) => file.kind === kind);
    if (ofKind.length === 0) continue;
    const point = MOUNT_POINTS[kind];
    if (FS.analyzePath(point, { follow_mount: false }).node === void 0) {
      FS.mkdir(point);
    }
    FS.mount({ mount: (mount) => createReadOnlyFS(FS, bridge, ofKind).mount(mount) }, { files: ofKind }, point);
  }
}

// src/user-data.ts
var USER_DATA_DIRS = [
  "/home/web_user/.local/share/GeneralsX",
  "/home/web_user/.config/GeneralsX"
];
var RUN_DEPENDENCY = "zhwp-user-data";
var SAVE_INTERVAL_MS = 1e4;
var EEXIST = 20;
function ensureDir(FS, dir) {
  const parts = dir.split("/").filter((part) => part.length > 0);
  let path = "";
  for (const part of parts) {
    path += `/${part}`;
    try {
      FS.mkdir(path);
    } catch (error) {
      if (error.errno !== EEXIST) throw error;
    }
  }
}
function mountUserData(module) {
  const { FS, IDBFS } = module;
  for (const dir of USER_DATA_DIRS) {
    ensureDir(FS, dir);
    FS.mount(IDBFS, {}, dir);
  }
  FS.syncfs(true, (error) => {
    if (error) {
      console.warn("[user-data] load failed:", error);
    }
    module.removeRunDependency(RUN_DEPENDENCY);
  });
}
var pending = null;
function syncToIDB(module) {
  return new Promise((resolve, reject) => {
    module.FS.syncfs(false, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
var suspended = false;
function save(module) {
  if (suspended) return Promise.resolve();
  if (pending === null) {
    pending = syncToIDB(module).finally(() => {
      pending = null;
    });
  }
  return pending;
}
var armed = /* @__PURE__ */ new WeakSet();
function armSaves(module) {
  if (armed.has(module)) return;
  armed.add(module);
  setInterval(() => {
    void save(module).catch(
      (error) => console.warn("[user-data] save failed:", error)
    );
  }, SAVE_INTERVAL_MS);
  window.addEventListener("pagehide", () => {
    void save(module).catch(
      (error) => console.warn("[user-data] save failed:", error)
    );
  });
}
function addUserDataPersistence(options) {
  const source = options;
  const existing = source.preRun ?? [];
  const preRun = typeof existing === "function" ? [existing] : [...existing];
  preRun.push((module) => {
    module.addRunDependency(RUN_DEPENDENCY);
    mountUserData(module);
    armSaves(module);
  });
  return { ...source, preRun };
}
function saveUserData(module) {
  return save(module);
}

// src/webgpu-keepalive.ts
var kept = [];
function keepWebGpuAlive() {
  const gpu = typeof navigator === "undefined" ? void 0 : navigator.gpu;
  if (gpu === void 0 || gpu.__zhwpKeepAlive === true) return;
  const requestAdapter = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = async (...args) => {
    const adapter = await requestAdapter(...args);
    if (adapter === null || adapter === void 0) return adapter;
    kept.push(adapter);
    const requestDevice = adapter.requestDevice.bind(adapter);
    adapter.requestDevice = async (...deviceArgs) => {
      const device = await requestDevice(...deviceArgs);
      kept.push(device);
      return device;
    };
    return adapter;
  };
  gpu.__zhwpKeepAlive = true;
  window.__zhwpWebGpuRefs = kept;
}

// src/transform-lighting.ts
function chooseTransformLighting() {
  const page = globalThis;
  if (page.zhwpCpuTnl !== void 0) return;
  page.zhwpCpuTnl = new URLSearchParams(location.search).get("cputnl") === "1";
}

// src/user-files.ts
var RUN_DEPENDENCY2 = "zhwp-user-files";
function validate(path) {
  const segments = path.split("/");
  if (path.length === 0 || path.startsWith("/") || segments.some(
    (segment) => segment === "" || segment === "." || segment === ".."
  )) {
    throw new Error(`invalid user file path: ${JSON.stringify(path)}`);
  }
}
function writeFile(module, file) {
  const fullPath = `${USER_DATA_DIRS[0]}/${file.path}`;
  module.FS.mkdirTree(fullPath.slice(0, fullPath.lastIndexOf("/")));
  module.FS.writeFile(fullPath, file.data);
}
function addUserFiles(options, files) {
  for (const file of files) validate(file.path);
  const source = options;
  const existing = source.preRun ?? [];
  const preRun = typeof existing === "function" ? [existing] : [...existing];
  preRun.push((module) => {
    const writeAll = () => {
      for (const file of files) writeFile(module, file);
    };
    if (module.FS.syncFSRequests === 0) {
      writeAll();
      return;
    }
    const removeRunDependency = module.removeRunDependency;
    module.addRunDependency(RUN_DEPENDENCY2);
    module.removeRunDependency = (id) => {
      if (module.FS.syncFSRequests > 0) {
        removeRunDependency.call(module, id);
        return;
      }
      module.removeRunDependency = removeRunDependency;
      try {
        writeAll();
      } finally {
        removeRunDependency.call(module, id);
        removeRunDependency.call(module, RUN_DEPENDENCY2);
      }
    };
  });
  return { ...source, preRun };
}

// src/engine.ts
async function prepareEngineOptions(options) {
  keepWebGpuAlive();
  chooseTransformLighting();
  const files = await listStored();
  const bridge = files.length > 0 ? await FileBridge.start(files) : void 0;
  if (bridge !== void 0) {
    window.addEventListener("pagehide", () => {
      void bridge.close();
    });
  }
  const source = options;
  const existing = source.preRun ?? [];
  const preRun = typeof existing === "function" ? [existing] : [...existing];
  preRun.push((module) => {
    if (bridge !== void 0) mountArchives(module.FS, bridge, files);
  });
  return addUserDataPersistence({ ...source, preRun });
}
export {
  addUserFiles,
  prepareEngineOptions,
  saveUserData
};
