var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e2) {
    throw mod = 0, e2;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/idb/build/cjs/wrap-idb-value.js
var require_wrap_idb_value = __commonJS({
  "node_modules/idb/build/cjs/wrap-idb-value.js"(exports) {
    "use strict";
    var instanceOfAny = (object, constructors) => constructors.some((c2) => object instanceof c2);
    var idbProxyableTypes;
    var cursorAdvanceMethods;
    function getIdbProxyableTypes() {
      return idbProxyableTypes || (idbProxyableTypes = [
        IDBDatabase,
        IDBObjectStore,
        IDBIndex,
        IDBCursor,
        IDBTransaction
      ]);
    }
    function getCursorAdvanceMethods() {
      return cursorAdvanceMethods || (cursorAdvanceMethods = [
        IDBCursor.prototype.advance,
        IDBCursor.prototype.continue,
        IDBCursor.prototype.continuePrimaryKey
      ]);
    }
    var cursorRequestMap = /* @__PURE__ */ new WeakMap();
    var transactionDoneMap = /* @__PURE__ */ new WeakMap();
    var transactionStoreNamesMap = /* @__PURE__ */ new WeakMap();
    var transformCache = /* @__PURE__ */ new WeakMap();
    var reverseTransformCache = /* @__PURE__ */ new WeakMap();
    function promisifyRequest(request) {
      const promise = new Promise((resolve, reject) => {
        const unlisten = () => {
          request.removeEventListener("success", success);
          request.removeEventListener("error", error);
        };
        const success = () => {
          resolve(wrap(request.result));
          unlisten();
        };
        const error = () => {
          reject(request.error);
          unlisten();
        };
        request.addEventListener("success", success);
        request.addEventListener("error", error);
      });
      promise.then((value) => {
        if (value instanceof IDBCursor) {
          cursorRequestMap.set(value, request);
        }
      }).catch(() => {
      });
      reverseTransformCache.set(promise, request);
      return promise;
    }
    function cacheDonePromiseForTransaction(tx) {
      if (transactionDoneMap.has(tx))
        return;
      const done = new Promise((resolve, reject) => {
        const unlisten = () => {
          tx.removeEventListener("complete", complete);
          tx.removeEventListener("error", error);
          tx.removeEventListener("abort", error);
        };
        const complete = () => {
          resolve();
          unlisten();
        };
        const error = () => {
          reject(tx.error || new DOMException("AbortError", "AbortError"));
          unlisten();
        };
        tx.addEventListener("complete", complete);
        tx.addEventListener("error", error);
        tx.addEventListener("abort", error);
      });
      transactionDoneMap.set(tx, done);
    }
    var idbProxyTraps = {
      get(target, prop, receiver) {
        if (target instanceof IDBTransaction) {
          if (prop === "done")
            return transactionDoneMap.get(target);
          if (prop === "objectStoreNames") {
            return target.objectStoreNames || transactionStoreNamesMap.get(target);
          }
          if (prop === "store") {
            return receiver.objectStoreNames[1] ? void 0 : receiver.objectStore(receiver.objectStoreNames[0]);
          }
        }
        return wrap(target[prop]);
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
      has(target, prop) {
        if (target instanceof IDBTransaction && (prop === "done" || prop === "store")) {
          return true;
        }
        return prop in target;
      }
    };
    function replaceTraps(callback) {
      idbProxyTraps = callback(idbProxyTraps);
    }
    function wrapFunction(func) {
      if (func === IDBDatabase.prototype.transaction && !("objectStoreNames" in IDBTransaction.prototype)) {
        return function(storeNames, ...args) {
          const tx = func.call(unwrap(this), storeNames, ...args);
          transactionStoreNamesMap.set(tx, storeNames.sort ? storeNames.sort() : [storeNames]);
          return wrap(tx);
        };
      }
      if (getCursorAdvanceMethods().includes(func)) {
        return function(...args) {
          func.apply(unwrap(this), args);
          return wrap(cursorRequestMap.get(this));
        };
      }
      return function(...args) {
        return wrap(func.apply(unwrap(this), args));
      };
    }
    function transformCachableValue(value) {
      if (typeof value === "function")
        return wrapFunction(value);
      if (value instanceof IDBTransaction)
        cacheDonePromiseForTransaction(value);
      if (instanceOfAny(value, getIdbProxyableTypes()))
        return new Proxy(value, idbProxyTraps);
      return value;
    }
    function wrap(value) {
      if (value instanceof IDBRequest)
        return promisifyRequest(value);
      if (transformCache.has(value))
        return transformCache.get(value);
      const newValue = transformCachableValue(value);
      if (newValue !== value) {
        transformCache.set(value, newValue);
        reverseTransformCache.set(newValue, value);
      }
      return newValue;
    }
    var unwrap = (value) => reverseTransformCache.get(value);
    exports.instanceOfAny = instanceOfAny;
    exports.replaceTraps = replaceTraps;
    exports.reverseTransformCache = reverseTransformCache;
    exports.unwrap = unwrap;
    exports.wrap = wrap;
  }
});

// node_modules/idb/build/cjs/index.js
var require_cjs = __commonJS({
  "node_modules/idb/build/cjs/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var wrapIdbValue = require_wrap_idb_value();
    function openDB(name, version, { blocked, upgrade, blocking, terminated } = {}) {
      const request = indexedDB.open(name, version);
      const openPromise = wrapIdbValue.wrap(request);
      if (upgrade) {
        request.addEventListener("upgradeneeded", (event) => {
          upgrade(wrapIdbValue.wrap(request.result), event.oldVersion, event.newVersion, wrapIdbValue.wrap(request.transaction));
        });
      }
      if (blocked)
        request.addEventListener("blocked", () => blocked());
      openPromise.then((db) => {
        if (terminated)
          db.addEventListener("close", () => terminated());
        if (blocking)
          db.addEventListener("versionchange", () => blocking());
      }).catch(() => {
      });
      return openPromise;
    }
    function deleteDB(name, { blocked } = {}) {
      const request = indexedDB.deleteDatabase(name);
      if (blocked)
        request.addEventListener("blocked", () => blocked());
      return wrapIdbValue.wrap(request).then(() => void 0);
    }
    var readMethods = ["get", "getKey", "getAll", "getAllKeys", "count"];
    var writeMethods = ["put", "add", "delete", "clear"];
    var cachedMethods = /* @__PURE__ */ new Map();
    function getMethod(target, prop) {
      if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === "string")) {
        return;
      }
      if (cachedMethods.get(prop))
        return cachedMethods.get(prop);
      const targetFuncName = prop.replace(/FromIndex$/, "");
      const useIndex = prop !== targetFuncName;
      const isWrite = writeMethods.includes(targetFuncName);
      if (
        // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
        !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))
      ) {
        return;
      }
      const method = async function(storeName, ...args) {
        const tx = this.transaction(storeName, isWrite ? "readwrite" : "readonly");
        let target2 = tx.store;
        if (useIndex)
          target2 = target2.index(args.shift());
        return (await Promise.all([
          target2[targetFuncName](...args),
          isWrite && tx.done
        ]))[0];
      };
      cachedMethods.set(prop, method);
      return method;
    }
    wrapIdbValue.replaceTraps((oldTraps) => ({
      ...oldTraps,
      get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
      has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop)
    }));
    exports.unwrap = wrapIdbValue.unwrap;
    exports.wrap = wrapIdbValue.wrap;
    exports.deleteDB = deleteDB;
    exports.openDB = openDB;
  }
});

// node_modules/events/events.js
var require_events = __commonJS({
  "node_modules/events/events.js"(exports, module) {
    "use strict";
    var R2 = typeof Reflect === "object" ? Reflect : null;
    var ReflectApply = R2 && typeof R2.apply === "function" ? R2.apply : function ReflectApply2(target, receiver, args) {
      return Function.prototype.apply.call(target, receiver, args);
    };
    var ReflectOwnKeys;
    if (R2 && typeof R2.ownKeys === "function") {
      ReflectOwnKeys = R2.ownKeys;
    } else if (Object.getOwnPropertySymbols) {
      ReflectOwnKeys = function ReflectOwnKeys2(target) {
        return Object.getOwnPropertyNames(target).concat(Object.getOwnPropertySymbols(target));
      };
    } else {
      ReflectOwnKeys = function ReflectOwnKeys2(target) {
        return Object.getOwnPropertyNames(target);
      };
    }
    function ProcessEmitWarning(warning) {
      if (console && console.warn) console.warn(warning);
    }
    var NumberIsNaN = Number.isNaN || function NumberIsNaN2(value) {
      return value !== value;
    };
    function EventEmitter() {
      EventEmitter.init.call(this);
    }
    module.exports = EventEmitter;
    module.exports.once = once;
    EventEmitter.EventEmitter = EventEmitter;
    EventEmitter.prototype._events = void 0;
    EventEmitter.prototype._eventsCount = 0;
    EventEmitter.prototype._maxListeners = void 0;
    var defaultMaxListeners = 10;
    function checkListener(listener) {
      if (typeof listener !== "function") {
        throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
      }
    }
    Object.defineProperty(EventEmitter, "defaultMaxListeners", {
      enumerable: true,
      get: function() {
        return defaultMaxListeners;
      },
      set: function(arg) {
        if (typeof arg !== "number" || arg < 0 || NumberIsNaN(arg)) {
          throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + ".");
        }
        defaultMaxListeners = arg;
      }
    });
    EventEmitter.init = function() {
      if (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) {
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
      }
      this._maxListeners = this._maxListeners || void 0;
    };
    EventEmitter.prototype.setMaxListeners = function setMaxListeners(n2) {
      if (typeof n2 !== "number" || n2 < 0 || NumberIsNaN(n2)) {
        throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n2 + ".");
      }
      this._maxListeners = n2;
      return this;
    };
    function _getMaxListeners(that) {
      if (that._maxListeners === void 0)
        return EventEmitter.defaultMaxListeners;
      return that._maxListeners;
    }
    EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
      return _getMaxListeners(this);
    };
    EventEmitter.prototype.emit = function emit(type) {
      var args = [];
      for (var i2 = 1; i2 < arguments.length; i2++) args.push(arguments[i2]);
      var doError = type === "error";
      var events = this._events;
      if (events !== void 0)
        doError = doError && events.error === void 0;
      else if (!doError)
        return false;
      if (doError) {
        var er;
        if (args.length > 0)
          er = args[0];
        if (er instanceof Error) {
          throw er;
        }
        var err = new Error("Unhandled error." + (er ? " (" + er.message + ")" : ""));
        err.context = er;
        throw err;
      }
      var handler = events[type];
      if (handler === void 0)
        return false;
      if (typeof handler === "function") {
        ReflectApply(handler, this, args);
      } else {
        var len = handler.length;
        var listeners = arrayClone(handler, len);
        for (var i2 = 0; i2 < len; ++i2)
          ReflectApply(listeners[i2], this, args);
      }
      return true;
    };
    function _addListener(target, type, listener, prepend) {
      var m2;
      var events;
      var existing;
      checkListener(listener);
      events = target._events;
      if (events === void 0) {
        events = target._events = /* @__PURE__ */ Object.create(null);
        target._eventsCount = 0;
      } else {
        if (events.newListener !== void 0) {
          target.emit(
            "newListener",
            type,
            listener.listener ? listener.listener : listener
          );
          events = target._events;
        }
        existing = events[type];
      }
      if (existing === void 0) {
        existing = events[type] = listener;
        ++target._eventsCount;
      } else {
        if (typeof existing === "function") {
          existing = events[type] = prepend ? [listener, existing] : [existing, listener];
        } else if (prepend) {
          existing.unshift(listener);
        } else {
          existing.push(listener);
        }
        m2 = _getMaxListeners(target);
        if (m2 > 0 && existing.length > m2 && !existing.warned) {
          existing.warned = true;
          var w2 = new Error("Possible EventEmitter memory leak detected. " + existing.length + " " + String(type) + " listeners added. Use emitter.setMaxListeners() to increase limit");
          w2.name = "MaxListenersExceededWarning";
          w2.emitter = target;
          w2.type = type;
          w2.count = existing.length;
          ProcessEmitWarning(w2);
        }
      }
      return target;
    }
    EventEmitter.prototype.addListener = function addListener(type, listener) {
      return _addListener(this, type, listener, false);
    };
    EventEmitter.prototype.on = EventEmitter.prototype.addListener;
    EventEmitter.prototype.prependListener = function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };
    function onceWrapper() {
      if (!this.fired) {
        this.target.removeListener(this.type, this.wrapFn);
        this.fired = true;
        if (arguments.length === 0)
          return this.listener.call(this.target);
        return this.listener.apply(this.target, arguments);
      }
    }
    function _onceWrap(target, type, listener) {
      var state = { fired: false, wrapFn: void 0, target, type, listener };
      var wrapped = onceWrapper.bind(state);
      wrapped.listener = listener;
      state.wrapFn = wrapped;
      return wrapped;
    }
    EventEmitter.prototype.once = function once2(type, listener) {
      checkListener(listener);
      this.on(type, _onceWrap(this, type, listener));
      return this;
    };
    EventEmitter.prototype.prependOnceListener = function prependOnceListener(type, listener) {
      checkListener(listener);
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };
    EventEmitter.prototype.removeListener = function removeListener(type, listener) {
      var list, events, position, i2, originalListener;
      checkListener(listener);
      events = this._events;
      if (events === void 0)
        return this;
      list = events[type];
      if (list === void 0)
        return this;
      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = /* @__PURE__ */ Object.create(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit("removeListener", type, list.listener || listener);
        }
      } else if (typeof list !== "function") {
        position = -1;
        for (i2 = list.length - 1; i2 >= 0; i2--) {
          if (list[i2] === listener || list[i2].listener === listener) {
            originalListener = list[i2].listener;
            position = i2;
            break;
          }
        }
        if (position < 0)
          return this;
        if (position === 0)
          list.shift();
        else {
          spliceOne(list, position);
        }
        if (list.length === 1)
          events[type] = list[0];
        if (events.removeListener !== void 0)
          this.emit("removeListener", type, originalListener || listener);
      }
      return this;
    };
    EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
    EventEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
      var listeners, events, i2;
      events = this._events;
      if (events === void 0)
        return this;
      if (events.removeListener === void 0) {
        if (arguments.length === 0) {
          this._events = /* @__PURE__ */ Object.create(null);
          this._eventsCount = 0;
        } else if (events[type] !== void 0) {
          if (--this._eventsCount === 0)
            this._events = /* @__PURE__ */ Object.create(null);
          else
            delete events[type];
        }
        return this;
      }
      if (arguments.length === 0) {
        var keys = Object.keys(events);
        var key;
        for (i2 = 0; i2 < keys.length; ++i2) {
          key = keys[i2];
          if (key === "removeListener") continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners("removeListener");
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
        return this;
      }
      listeners = events[type];
      if (typeof listeners === "function") {
        this.removeListener(type, listeners);
      } else if (listeners !== void 0) {
        for (i2 = listeners.length - 1; i2 >= 0; i2--) {
          this.removeListener(type, listeners[i2]);
        }
      }
      return this;
    };
    function _listeners(target, type, unwrap) {
      var events = target._events;
      if (events === void 0)
        return [];
      var evlistener = events[type];
      if (evlistener === void 0)
        return [];
      if (typeof evlistener === "function")
        return unwrap ? [evlistener.listener || evlistener] : [evlistener];
      return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
    }
    EventEmitter.prototype.listeners = function listeners(type) {
      return _listeners(this, type, true);
    };
    EventEmitter.prototype.rawListeners = function rawListeners(type) {
      return _listeners(this, type, false);
    };
    EventEmitter.listenerCount = function(emitter, type) {
      if (typeof emitter.listenerCount === "function") {
        return emitter.listenerCount(type);
      } else {
        return listenerCount.call(emitter, type);
      }
    };
    EventEmitter.prototype.listenerCount = listenerCount;
    function listenerCount(type) {
      var events = this._events;
      if (events !== void 0) {
        var evlistener = events[type];
        if (typeof evlistener === "function") {
          return 1;
        } else if (evlistener !== void 0) {
          return evlistener.length;
        }
      }
      return 0;
    }
    EventEmitter.prototype.eventNames = function eventNames() {
      return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
    };
    function arrayClone(arr, n2) {
      var copy = new Array(n2);
      for (var i2 = 0; i2 < n2; ++i2)
        copy[i2] = arr[i2];
      return copy;
    }
    function spliceOne(list, index) {
      for (; index + 1 < list.length; index++)
        list[index] = list[index + 1];
      list.pop();
    }
    function unwrapListeners(arr) {
      var ret = new Array(arr.length);
      for (var i2 = 0; i2 < ret.length; ++i2) {
        ret[i2] = arr[i2].listener || arr[i2];
      }
      return ret;
    }
    function once(emitter, name) {
      return new Promise(function(resolve, reject) {
        function errorListener(err) {
          emitter.removeListener(name, resolver);
          reject(err);
        }
        function resolver() {
          if (typeof emitter.removeListener === "function") {
            emitter.removeListener("error", errorListener);
          }
          resolve([].slice.call(arguments));
        }
        ;
        eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
        if (name !== "error") {
          addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
        }
      });
    }
    function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
      if (typeof emitter.on === "function") {
        eventTargetAgnosticAddListener(emitter, "error", handler, flags);
      }
    }
    function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
      if (typeof emitter.on === "function") {
        if (flags.once) {
          emitter.once(name, listener);
        } else {
          emitter.on(name, listener);
        }
      } else if (typeof emitter.addEventListener === "function") {
        emitter.addEventListener(name, function wrapListener(arg) {
          if (flags.once) {
            emitter.removeEventListener(name, wrapListener);
          }
          listener(arg);
        });
      } else {
        throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
      }
    }
  }
});

// node_modules/queue-microtask/index.js
var require_queue_microtask = __commonJS({
  "node_modules/queue-microtask/index.js"(exports, module) {
    var promise;
    module.exports = typeof queueMicrotask === "function" ? queueMicrotask.bind(typeof window !== "undefined" ? window : global) : (cb) => (promise || (promise = Promise.resolve())).then(cb).catch((err) => setTimeout(() => {
      throw err;
    }, 0));
  }
});

// node_modules/idb-chunk-store/index.js
var require_idb_chunk_store = __commonJS({
  "node_modules/idb-chunk-store/index.js"(exports, module) {
    "use strict";
    var idb = require_cjs();
    var EventEmitter = require_events().EventEmitter;
    var queueMicrotask2 = require_queue_microtask();
    var Storage = class extends EventEmitter {
      constructor(chunkLength, opts) {
        if (!opts) opts = {};
        super();
        this.chunkLength = Number(chunkLength);
        if (!this.chunkLength) throw new Error("First argument must be a chunk length");
        this.closed = false;
        this.destroyed = false;
        this.length = Number(opts.length) || Infinity;
        this.name = opts.name || "idb-chunk-store";
        if (this.length !== Infinity) {
          this.lastChunkLength = this.length % this.chunkLength || this.chunkLength;
          this.lastChunkIndex = Math.ceil(this.length / this.chunkLength) - 1;
        }
        this.dbPromise = idb.openDB(this.name, void 0, {
          upgrade: (db) => {
            db.createObjectStore("chunks");
          },
          blocking: () => {
            this.close();
          },
          terminated: () => {
            this.closed = true;
            this.emit("error", new Error("Database unexpectedly closed"));
          }
        });
      }
      put(index, buf, cb = () => {
      }) {
        if (this.closed) return queueMicrotask2(() => cb(new Error("Storage is closed")));
        const isLastChunk = index === this.lastChunkIndex;
        if (isLastChunk && buf.length !== this.lastChunkLength) {
          return queueMicrotask2(() => cb(new Error("Last chunk length must be " + this.lastChunkLength)));
        }
        if (!isLastChunk && buf.length !== this.chunkLength) {
          return queueMicrotask2(() => cb(new Error("Chunk length must be " + this.chunkLength)));
        }
        buf = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        if (buf.byteOffset !== 0 || buf.byteLength !== buf.buffer.byteLength) {
          buf = buf.slice();
        }
        ;
        (async () => {
          try {
            const db = await this.dbPromise;
            await db.put("chunks", buf, index);
          } catch (err) {
            cb(err);
            return;
          }
          cb(null);
        })();
      }
      get(index, opts, cb = () => {
      }) {
        if (typeof opts === "function") return this.get(index, {}, opts);
        if (!opts) opts = {};
        if (this.closed) return queueMicrotask2(() => cb(new Error("Storage is closed")));
        (async () => {
          let rawResult;
          try {
            const db = await this.dbPromise;
            rawResult = await db.get("chunks", index);
          } catch (err) {
            cb(err);
            return;
          }
          if (rawResult == null) {
            const err = new Error("Chunk not found");
            err.notFound = true;
            cb(err);
            return;
          }
          let buf = Buffer.from(rawResult.buffer, rawResult.byteOffset, rawResult.byteLength);
          const offset = opts.offset || 0;
          const len = opts.length || buf.length - offset;
          if (offset !== 0 || len !== buf.length) {
            buf = buf.slice(offset, len + offset);
          }
          cb(null, buf);
        })();
      }
      close(cb = () => {
      }) {
        if (this.closed) return queueMicrotask2(() => cb(new Error("Storage is closed")));
        this.closed = true;
        (async () => {
          try {
            const db = await this.dbPromise;
            db.close();
          } catch (err) {
            cb(err);
            return;
          }
          cb(null);
        })();
      }
      destroy(cb = () => {
      }) {
        if (this.closed) return queueMicrotask2(() => cb(new Error("Storage is closed")));
        if (this.destroyed) return queueMicrotask2(() => cb(new Error("Storage is destroyed")));
        this.destroyed = true;
        this.close(async (err) => {
          if (err) {
            cb(err);
            return;
          }
          try {
            await idb.deleteDB(this.name);
          } catch (err2) {
            cb(err2);
            return;
          }
          cb(null);
        });
      }
    };
    module.exports = Storage;
  }
});

// node_modules/base64-js/index.js
var require_base64_js = __commonJS({
  "node_modules/base64-js/index.js"(exports) {
    "use strict";
    exports.byteLength = byteLength;
    exports.toByteArray = toByteArray;
    exports.fromByteArray = fromByteArray;
    var lookup = [];
    var revLookup = [];
    var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
    var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i2 = 0, len = code.length; i2 < len; ++i2) {
      lookup[i2] = code[i2];
      revLookup[code.charCodeAt(i2)] = i2;
    }
    var i2;
    var len;
    revLookup["-".charCodeAt(0)] = 62;
    revLookup["_".charCodeAt(0)] = 63;
    function getLens(b64) {
      var len2 = b64.length;
      if (len2 % 4 > 0) {
        throw new Error("Invalid string. Length must be a multiple of 4");
      }
      var validLen = b64.indexOf("=");
      if (validLen === -1) validLen = len2;
      var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
      return [validLen, placeHoldersLen];
    }
    function byteLength(b64) {
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function _byteLength(b64, validLen, placeHoldersLen) {
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function toByteArray(b64) {
      var tmp;
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
      var curByte = 0;
      var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
      var i3;
      for (i3 = 0; i3 < len2; i3 += 4) {
        tmp = revLookup[b64.charCodeAt(i3)] << 18 | revLookup[b64.charCodeAt(i3 + 1)] << 12 | revLookup[b64.charCodeAt(i3 + 2)] << 6 | revLookup[b64.charCodeAt(i3 + 3)];
        arr[curByte++] = tmp >> 16 & 255;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 2) {
        tmp = revLookup[b64.charCodeAt(i3)] << 2 | revLookup[b64.charCodeAt(i3 + 1)] >> 4;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 1) {
        tmp = revLookup[b64.charCodeAt(i3)] << 10 | revLookup[b64.charCodeAt(i3 + 1)] << 4 | revLookup[b64.charCodeAt(i3 + 2)] >> 2;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      return arr;
    }
    function tripletToBase64(num) {
      return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
    }
    function encodeChunk(uint8, start, end) {
      var tmp;
      var output = [];
      for (var i3 = start; i3 < end; i3 += 3) {
        tmp = (uint8[i3] << 16 & 16711680) + (uint8[i3 + 1] << 8 & 65280) + (uint8[i3 + 2] & 255);
        output.push(tripletToBase64(tmp));
      }
      return output.join("");
    }
    function fromByteArray(uint8) {
      var tmp;
      var len2 = uint8.length;
      var extraBytes = len2 % 3;
      var parts = [];
      var maxChunkLength = 16383;
      for (var i3 = 0, len22 = len2 - extraBytes; i3 < len22; i3 += maxChunkLength) {
        parts.push(encodeChunk(uint8, i3, i3 + maxChunkLength > len22 ? len22 : i3 + maxChunkLength));
      }
      if (extraBytes === 1) {
        tmp = uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
        );
      } else if (extraBytes === 2) {
        tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
        );
      }
      return parts.join("");
    }
  }
});

// node_modules/ieee754/index.js
var require_ieee754 = __commonJS({
  "node_modules/ieee754/index.js"(exports) {
    exports.read = function(buffer, offset, isLE, mLen, nBytes) {
      var e2, m2;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var nBits = -7;
      var i2 = isLE ? nBytes - 1 : 0;
      var d2 = isLE ? -1 : 1;
      var s2 = buffer[offset + i2];
      i2 += d2;
      e2 = s2 & (1 << -nBits) - 1;
      s2 >>= -nBits;
      nBits += eLen;
      for (; nBits > 0; e2 = e2 * 256 + buffer[offset + i2], i2 += d2, nBits -= 8) {
      }
      m2 = e2 & (1 << -nBits) - 1;
      e2 >>= -nBits;
      nBits += mLen;
      for (; nBits > 0; m2 = m2 * 256 + buffer[offset + i2], i2 += d2, nBits -= 8) {
      }
      if (e2 === 0) {
        e2 = 1 - eBias;
      } else if (e2 === eMax) {
        return m2 ? NaN : (s2 ? -1 : 1) * Infinity;
      } else {
        m2 = m2 + Math.pow(2, mLen);
        e2 = e2 - eBias;
      }
      return (s2 ? -1 : 1) * m2 * Math.pow(2, e2 - mLen);
    };
    exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
      var e2, m2, c2;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var rt2 = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
      var i2 = isLE ? 0 : nBytes - 1;
      var d2 = isLE ? 1 : -1;
      var s2 = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
      value = Math.abs(value);
      if (isNaN(value) || value === Infinity) {
        m2 = isNaN(value) ? 1 : 0;
        e2 = eMax;
      } else {
        e2 = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c2 = Math.pow(2, -e2)) < 1) {
          e2--;
          c2 *= 2;
        }
        if (e2 + eBias >= 1) {
          value += rt2 / c2;
        } else {
          value += rt2 * Math.pow(2, 1 - eBias);
        }
        if (value * c2 >= 2) {
          e2++;
          c2 /= 2;
        }
        if (e2 + eBias >= eMax) {
          m2 = 0;
          e2 = eMax;
        } else if (e2 + eBias >= 1) {
          m2 = (value * c2 - 1) * Math.pow(2, mLen);
          e2 = e2 + eBias;
        } else {
          m2 = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
          e2 = 0;
        }
      }
      for (; mLen >= 8; buffer[offset + i2] = m2 & 255, i2 += d2, m2 /= 256, mLen -= 8) {
      }
      e2 = e2 << mLen | m2;
      eLen += mLen;
      for (; eLen > 0; buffer[offset + i2] = e2 & 255, i2 += d2, e2 /= 256, eLen -= 8) {
      }
      buffer[offset + i2 - d2] |= s2 * 128;
    };
  }
});

// node_modules/buffer/index.js
var require_buffer = __commonJS({
  "node_modules/buffer/index.js"(exports) {
    "use strict";
    var base64 = require_base64_js();
    var ieee754 = require_ieee754();
    var customInspectSymbol = typeof Symbol === "function" && typeof Symbol["for"] === "function" ? Symbol["for"]("nodejs.util.inspect.custom") : null;
    exports.Buffer = Buffer3;
    exports.SlowBuffer = SlowBuffer;
    exports.INSPECT_MAX_BYTES = 50;
    var K_MAX_LENGTH = 2147483647;
    exports.kMaxLength = K_MAX_LENGTH;
    Buffer3.TYPED_ARRAY_SUPPORT = typedArraySupport();
    if (!Buffer3.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
      console.error(
        "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
      );
    }
    function typedArraySupport() {
      try {
        const arr = new Uint8Array(1);
        const proto = { foo: function() {
          return 42;
        } };
        Object.setPrototypeOf(proto, Uint8Array.prototype);
        Object.setPrototypeOf(arr, proto);
        return arr.foo() === 42;
      } catch (e2) {
        return false;
      }
    }
    Object.defineProperty(Buffer3.prototype, "parent", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.buffer;
      }
    });
    Object.defineProperty(Buffer3.prototype, "offset", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.byteOffset;
      }
    });
    function createBuffer(length) {
      if (length > K_MAX_LENGTH) {
        throw new RangeError('The value "' + length + '" is invalid for option "size"');
      }
      const buf = new Uint8Array(length);
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function Buffer3(arg, encodingOrOffset, length) {
      if (typeof arg === "number") {
        if (typeof encodingOrOffset === "string") {
          throw new TypeError(
            'The "string" argument must be of type string. Received type number'
          );
        }
        return allocUnsafe(arg);
      }
      return from(arg, encodingOrOffset, length);
    }
    Buffer3.poolSize = 8192;
    function from(value, encodingOrOffset, length) {
      if (typeof value === "string") {
        return fromString(value, encodingOrOffset);
      }
      if (ArrayBuffer.isView(value)) {
        return fromArrayView(value);
      }
      if (value == null) {
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
        );
      }
      if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer)) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof SharedArrayBuffer !== "undefined" && (isInstance(value, SharedArrayBuffer) || value && isInstance(value.buffer, SharedArrayBuffer))) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof value === "number") {
        throw new TypeError(
          'The "value" argument must not be of type number. Received type number'
        );
      }
      const valueOf = value.valueOf && value.valueOf();
      if (valueOf != null && valueOf !== value) {
        return Buffer3.from(valueOf, encodingOrOffset, length);
      }
      const b2 = fromObject(value);
      if (b2) return b2;
      if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] === "function") {
        return Buffer3.from(value[Symbol.toPrimitive]("string"), encodingOrOffset, length);
      }
      throw new TypeError(
        "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
      );
    }
    Buffer3.from = function(value, encodingOrOffset, length) {
      return from(value, encodingOrOffset, length);
    };
    Object.setPrototypeOf(Buffer3.prototype, Uint8Array.prototype);
    Object.setPrototypeOf(Buffer3, Uint8Array);
    function assertSize(size) {
      if (typeof size !== "number") {
        throw new TypeError('"size" argument must be of type number');
      } else if (size < 0) {
        throw new RangeError('The value "' + size + '" is invalid for option "size"');
      }
    }
    function alloc(size, fill, encoding) {
      assertSize(size);
      if (size <= 0) {
        return createBuffer(size);
      }
      if (fill !== void 0) {
        return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
      }
      return createBuffer(size);
    }
    Buffer3.alloc = function(size, fill, encoding) {
      return alloc(size, fill, encoding);
    };
    function allocUnsafe(size) {
      assertSize(size);
      return createBuffer(size < 0 ? 0 : checked(size) | 0);
    }
    Buffer3.allocUnsafe = function(size) {
      return allocUnsafe(size);
    };
    Buffer3.allocUnsafeSlow = function(size) {
      return allocUnsafe(size);
    };
    function fromString(string, encoding) {
      if (typeof encoding !== "string" || encoding === "") {
        encoding = "utf8";
      }
      if (!Buffer3.isEncoding(encoding)) {
        throw new TypeError("Unknown encoding: " + encoding);
      }
      const length = byteLength(string, encoding) | 0;
      let buf = createBuffer(length);
      const actual = buf.write(string, encoding);
      if (actual !== length) {
        buf = buf.slice(0, actual);
      }
      return buf;
    }
    function fromArrayLike(array) {
      const length = array.length < 0 ? 0 : checked(array.length) | 0;
      const buf = createBuffer(length);
      for (let i2 = 0; i2 < length; i2 += 1) {
        buf[i2] = array[i2] & 255;
      }
      return buf;
    }
    function fromArrayView(arrayView) {
      if (isInstance(arrayView, Uint8Array)) {
        const copy = new Uint8Array(arrayView);
        return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
      }
      return fromArrayLike(arrayView);
    }
    function fromArrayBuffer(array, byteOffset, length) {
      if (byteOffset < 0 || array.byteLength < byteOffset) {
        throw new RangeError('"offset" is outside of buffer bounds');
      }
      if (array.byteLength < byteOffset + (length || 0)) {
        throw new RangeError('"length" is outside of buffer bounds');
      }
      let buf;
      if (byteOffset === void 0 && length === void 0) {
        buf = new Uint8Array(array);
      } else if (length === void 0) {
        buf = new Uint8Array(array, byteOffset);
      } else {
        buf = new Uint8Array(array, byteOffset, length);
      }
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function fromObject(obj) {
      if (Buffer3.isBuffer(obj)) {
        const len = checked(obj.length) | 0;
        const buf = createBuffer(len);
        if (buf.length === 0) {
          return buf;
        }
        obj.copy(buf, 0, 0, len);
        return buf;
      }
      if (obj.length !== void 0) {
        if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
          return createBuffer(0);
        }
        return fromArrayLike(obj);
      }
      if (obj.type === "Buffer" && Array.isArray(obj.data)) {
        return fromArrayLike(obj.data);
      }
    }
    function checked(length) {
      if (length >= K_MAX_LENGTH) {
        throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
      }
      return length | 0;
    }
    function SlowBuffer(length) {
      if (+length != length) {
        length = 0;
      }
      return Buffer3.alloc(+length);
    }
    Buffer3.isBuffer = function isBuffer(b2) {
      return b2 != null && b2._isBuffer === true && b2 !== Buffer3.prototype;
    };
    Buffer3.compare = function compare(a2, b2) {
      if (isInstance(a2, Uint8Array)) a2 = Buffer3.from(a2, a2.offset, a2.byteLength);
      if (isInstance(b2, Uint8Array)) b2 = Buffer3.from(b2, b2.offset, b2.byteLength);
      if (!Buffer3.isBuffer(a2) || !Buffer3.isBuffer(b2)) {
        throw new TypeError(
          'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
        );
      }
      if (a2 === b2) return 0;
      let x2 = a2.length;
      let y2 = b2.length;
      for (let i2 = 0, len = Math.min(x2, y2); i2 < len; ++i2) {
        if (a2[i2] !== b2[i2]) {
          x2 = a2[i2];
          y2 = b2[i2];
          break;
        }
      }
      if (x2 < y2) return -1;
      if (y2 < x2) return 1;
      return 0;
    };
    Buffer3.isEncoding = function isEncoding(encoding) {
      switch (String(encoding).toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "latin1":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return true;
        default:
          return false;
      }
    };
    Buffer3.concat = function concat(list, length) {
      if (!Array.isArray(list)) {
        throw new TypeError('"list" argument must be an Array of Buffers');
      }
      if (list.length === 0) {
        return Buffer3.alloc(0);
      }
      let i2;
      if (length === void 0) {
        length = 0;
        for (i2 = 0; i2 < list.length; ++i2) {
          length += list[i2].length;
        }
      }
      const buffer = Buffer3.allocUnsafe(length);
      let pos = 0;
      for (i2 = 0; i2 < list.length; ++i2) {
        let buf = list[i2];
        if (isInstance(buf, Uint8Array)) {
          if (pos + buf.length > buffer.length) {
            if (!Buffer3.isBuffer(buf)) buf = Buffer3.from(buf);
            buf.copy(buffer, pos);
          } else {
            Uint8Array.prototype.set.call(
              buffer,
              buf,
              pos
            );
          }
        } else if (!Buffer3.isBuffer(buf)) {
          throw new TypeError('"list" argument must be an Array of Buffers');
        } else {
          buf.copy(buffer, pos);
        }
        pos += buf.length;
      }
      return buffer;
    };
    function byteLength(string, encoding) {
      if (Buffer3.isBuffer(string)) {
        return string.length;
      }
      if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
        return string.byteLength;
      }
      if (typeof string !== "string") {
        throw new TypeError(
          'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
        );
      }
      const len = string.length;
      const mustMatch = arguments.length > 2 && arguments[2] === true;
      if (!mustMatch && len === 0) return 0;
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "ascii":
          case "latin1":
          case "binary":
            return len;
          case "utf8":
          case "utf-8":
            return utf8ToBytes(string).length;
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return len * 2;
          case "hex":
            return len >>> 1;
          case "base64":
            return base64ToBytes(string).length;
          default:
            if (loweredCase) {
              return mustMatch ? -1 : utf8ToBytes(string).length;
            }
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.byteLength = byteLength;
    function slowToString(encoding, start, end) {
      let loweredCase = false;
      if (start === void 0 || start < 0) {
        start = 0;
      }
      if (start > this.length) {
        return "";
      }
      if (end === void 0 || end > this.length) {
        end = this.length;
      }
      if (end <= 0) {
        return "";
      }
      end >>>= 0;
      start >>>= 0;
      if (end <= start) {
        return "";
      }
      if (!encoding) encoding = "utf8";
      while (true) {
        switch (encoding) {
          case "hex":
            return hexSlice(this, start, end);
          case "utf8":
          case "utf-8":
            return utf8Slice(this, start, end);
          case "ascii":
            return asciiSlice(this, start, end);
          case "latin1":
          case "binary":
            return latin1Slice(this, start, end);
          case "base64":
            return base64Slice(this, start, end);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return utf16leSlice(this, start, end);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = (encoding + "").toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.prototype._isBuffer = true;
    function swap(b2, n2, m2) {
      const i2 = b2[n2];
      b2[n2] = b2[m2];
      b2[m2] = i2;
    }
    Buffer3.prototype.swap16 = function swap16() {
      const len = this.length;
      if (len % 2 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 16-bits");
      }
      for (let i2 = 0; i2 < len; i2 += 2) {
        swap(this, i2, i2 + 1);
      }
      return this;
    };
    Buffer3.prototype.swap32 = function swap32() {
      const len = this.length;
      if (len % 4 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 32-bits");
      }
      for (let i2 = 0; i2 < len; i2 += 4) {
        swap(this, i2, i2 + 3);
        swap(this, i2 + 1, i2 + 2);
      }
      return this;
    };
    Buffer3.prototype.swap64 = function swap64() {
      const len = this.length;
      if (len % 8 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 64-bits");
      }
      for (let i2 = 0; i2 < len; i2 += 8) {
        swap(this, i2, i2 + 7);
        swap(this, i2 + 1, i2 + 6);
        swap(this, i2 + 2, i2 + 5);
        swap(this, i2 + 3, i2 + 4);
      }
      return this;
    };
    Buffer3.prototype.toString = function toString() {
      const length = this.length;
      if (length === 0) return "";
      if (arguments.length === 0) return utf8Slice(this, 0, length);
      return slowToString.apply(this, arguments);
    };
    Buffer3.prototype.toLocaleString = Buffer3.prototype.toString;
    Buffer3.prototype.equals = function equals(b2) {
      if (!Buffer3.isBuffer(b2)) throw new TypeError("Argument must be a Buffer");
      if (this === b2) return true;
      return Buffer3.compare(this, b2) === 0;
    };
    Buffer3.prototype.inspect = function inspect() {
      let str = "";
      const max = exports.INSPECT_MAX_BYTES;
      str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
      if (this.length > max) str += " ... ";
      return "<Buffer " + str + ">";
    };
    if (customInspectSymbol) {
      Buffer3.prototype[customInspectSymbol] = Buffer3.prototype.inspect;
    }
    Buffer3.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
      if (isInstance(target, Uint8Array)) {
        target = Buffer3.from(target, target.offset, target.byteLength);
      }
      if (!Buffer3.isBuffer(target)) {
        throw new TypeError(
          'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
        );
      }
      if (start === void 0) {
        start = 0;
      }
      if (end === void 0) {
        end = target ? target.length : 0;
      }
      if (thisStart === void 0) {
        thisStart = 0;
      }
      if (thisEnd === void 0) {
        thisEnd = this.length;
      }
      if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
        throw new RangeError("out of range index");
      }
      if (thisStart >= thisEnd && start >= end) {
        return 0;
      }
      if (thisStart >= thisEnd) {
        return -1;
      }
      if (start >= end) {
        return 1;
      }
      start >>>= 0;
      end >>>= 0;
      thisStart >>>= 0;
      thisEnd >>>= 0;
      if (this === target) return 0;
      let x2 = thisEnd - thisStart;
      let y2 = end - start;
      const len = Math.min(x2, y2);
      const thisCopy = this.slice(thisStart, thisEnd);
      const targetCopy = target.slice(start, end);
      for (let i2 = 0; i2 < len; ++i2) {
        if (thisCopy[i2] !== targetCopy[i2]) {
          x2 = thisCopy[i2];
          y2 = targetCopy[i2];
          break;
        }
      }
      if (x2 < y2) return -1;
      if (y2 < x2) return 1;
      return 0;
    };
    function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
      if (buffer.length === 0) return -1;
      if (typeof byteOffset === "string") {
        encoding = byteOffset;
        byteOffset = 0;
      } else if (byteOffset > 2147483647) {
        byteOffset = 2147483647;
      } else if (byteOffset < -2147483648) {
        byteOffset = -2147483648;
      }
      byteOffset = +byteOffset;
      if (numberIsNaN(byteOffset)) {
        byteOffset = dir ? 0 : buffer.length - 1;
      }
      if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
      if (byteOffset >= buffer.length) {
        if (dir) return -1;
        else byteOffset = buffer.length - 1;
      } else if (byteOffset < 0) {
        if (dir) byteOffset = 0;
        else return -1;
      }
      if (typeof val === "string") {
        val = Buffer3.from(val, encoding);
      }
      if (Buffer3.isBuffer(val)) {
        if (val.length === 0) {
          return -1;
        }
        return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
      } else if (typeof val === "number") {
        val = val & 255;
        if (typeof Uint8Array.prototype.indexOf === "function") {
          if (dir) {
            return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
          } else {
            return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
          }
        }
        return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
      }
      throw new TypeError("val must be string, number or Buffer");
    }
    function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
      let indexSize = 1;
      let arrLength = arr.length;
      let valLength = val.length;
      if (encoding !== void 0) {
        encoding = String(encoding).toLowerCase();
        if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
          if (arr.length < 2 || val.length < 2) {
            return -1;
          }
          indexSize = 2;
          arrLength /= 2;
          valLength /= 2;
          byteOffset /= 2;
        }
      }
      function read(buf, i3) {
        if (indexSize === 1) {
          return buf[i3];
        } else {
          return buf.readUInt16BE(i3 * indexSize);
        }
      }
      let i2;
      if (dir) {
        let foundIndex = -1;
        for (i2 = byteOffset; i2 < arrLength; i2++) {
          if (read(arr, i2) === read(val, foundIndex === -1 ? 0 : i2 - foundIndex)) {
            if (foundIndex === -1) foundIndex = i2;
            if (i2 - foundIndex + 1 === valLength) return foundIndex * indexSize;
          } else {
            if (foundIndex !== -1) i2 -= i2 - foundIndex;
            foundIndex = -1;
          }
        }
      } else {
        if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
        for (i2 = byteOffset; i2 >= 0; i2--) {
          let found = true;
          for (let j2 = 0; j2 < valLength; j2++) {
            if (read(arr, i2 + j2) !== read(val, j2)) {
              found = false;
              break;
            }
          }
          if (found) return i2;
        }
      }
      return -1;
    }
    Buffer3.prototype.includes = function includes(val, byteOffset, encoding) {
      return this.indexOf(val, byteOffset, encoding) !== -1;
    };
    Buffer3.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
    };
    Buffer3.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
    };
    function hexWrite(buf, string, offset, length) {
      offset = Number(offset) || 0;
      const remaining = buf.length - offset;
      if (!length) {
        length = remaining;
      } else {
        length = Number(length);
        if (length > remaining) {
          length = remaining;
        }
      }
      const strLen = string.length;
      if (length > strLen / 2) {
        length = strLen / 2;
      }
      let i2;
      for (i2 = 0; i2 < length; ++i2) {
        const parsed = parseInt(string.substr(i2 * 2, 2), 16);
        if (numberIsNaN(parsed)) return i2;
        buf[offset + i2] = parsed;
      }
      return i2;
    }
    function utf8Write(buf, string, offset, length) {
      return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
    }
    function asciiWrite(buf, string, offset, length) {
      return blitBuffer(asciiToBytes(string), buf, offset, length);
    }
    function base64Write(buf, string, offset, length) {
      return blitBuffer(base64ToBytes(string), buf, offset, length);
    }
    function ucs2Write(buf, string, offset, length) {
      return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
    }
    Buffer3.prototype.write = function write(string, offset, length, encoding) {
      if (offset === void 0) {
        encoding = "utf8";
        length = this.length;
        offset = 0;
      } else if (length === void 0 && typeof offset === "string") {
        encoding = offset;
        length = this.length;
        offset = 0;
      } else if (isFinite(offset)) {
        offset = offset >>> 0;
        if (isFinite(length)) {
          length = length >>> 0;
          if (encoding === void 0) encoding = "utf8";
        } else {
          encoding = length;
          length = void 0;
        }
      } else {
        throw new Error(
          "Buffer.write(string, encoding, offset[, length]) is no longer supported"
        );
      }
      const remaining = this.length - offset;
      if (length === void 0 || length > remaining) length = remaining;
      if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
        throw new RangeError("Attempt to write outside buffer bounds");
      }
      if (!encoding) encoding = "utf8";
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "hex":
            return hexWrite(this, string, offset, length);
          case "utf8":
          case "utf-8":
            return utf8Write(this, string, offset, length);
          case "ascii":
          case "latin1":
          case "binary":
            return asciiWrite(this, string, offset, length);
          case "base64":
            return base64Write(this, string, offset, length);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return ucs2Write(this, string, offset, length);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    };
    Buffer3.prototype.toJSON = function toJSON() {
      return {
        type: "Buffer",
        data: Array.prototype.slice.call(this._arr || this, 0)
      };
    };
    function base64Slice(buf, start, end) {
      if (start === 0 && end === buf.length) {
        return base64.fromByteArray(buf);
      } else {
        return base64.fromByteArray(buf.slice(start, end));
      }
    }
    function utf8Slice(buf, start, end) {
      end = Math.min(buf.length, end);
      const res = [];
      let i2 = start;
      while (i2 < end) {
        const firstByte = buf[i2];
        let codePoint = null;
        let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
        if (i2 + bytesPerSequence <= end) {
          let secondByte, thirdByte, fourthByte, tempCodePoint;
          switch (bytesPerSequence) {
            case 1:
              if (firstByte < 128) {
                codePoint = firstByte;
              }
              break;
            case 2:
              secondByte = buf[i2 + 1];
              if ((secondByte & 192) === 128) {
                tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                if (tempCodePoint > 127) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 3:
              secondByte = buf[i2 + 1];
              thirdByte = buf[i2 + 2];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 4:
              secondByte = buf[i2 + 1];
              thirdByte = buf[i2 + 2];
              fourthByte = buf[i2 + 3];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                  codePoint = tempCodePoint;
                }
              }
          }
        }
        if (codePoint === null) {
          codePoint = 65533;
          bytesPerSequence = 1;
        } else if (codePoint > 65535) {
          codePoint -= 65536;
          res.push(codePoint >>> 10 & 1023 | 55296);
          codePoint = 56320 | codePoint & 1023;
        }
        res.push(codePoint);
        i2 += bytesPerSequence;
      }
      return decodeCodePointsArray(res);
    }
    var MAX_ARGUMENTS_LENGTH = 4096;
    function decodeCodePointsArray(codePoints) {
      const len = codePoints.length;
      if (len <= MAX_ARGUMENTS_LENGTH) {
        return String.fromCharCode.apply(String, codePoints);
      }
      let res = "";
      let i2 = 0;
      while (i2 < len) {
        res += String.fromCharCode.apply(
          String,
          codePoints.slice(i2, i2 += MAX_ARGUMENTS_LENGTH)
        );
      }
      return res;
    }
    function asciiSlice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i2 = start; i2 < end; ++i2) {
        ret += String.fromCharCode(buf[i2] & 127);
      }
      return ret;
    }
    function latin1Slice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i2 = start; i2 < end; ++i2) {
        ret += String.fromCharCode(buf[i2]);
      }
      return ret;
    }
    function hexSlice(buf, start, end) {
      const len = buf.length;
      if (!start || start < 0) start = 0;
      if (!end || end < 0 || end > len) end = len;
      let out = "";
      for (let i2 = start; i2 < end; ++i2) {
        out += hexSliceLookupTable[buf[i2]];
      }
      return out;
    }
    function utf16leSlice(buf, start, end) {
      const bytes = buf.slice(start, end);
      let res = "";
      for (let i2 = 0; i2 < bytes.length - 1; i2 += 2) {
        res += String.fromCharCode(bytes[i2] + bytes[i2 + 1] * 256);
      }
      return res;
    }
    Buffer3.prototype.slice = function slice(start, end) {
      const len = this.length;
      start = ~~start;
      end = end === void 0 ? len : ~~end;
      if (start < 0) {
        start += len;
        if (start < 0) start = 0;
      } else if (start > len) {
        start = len;
      }
      if (end < 0) {
        end += len;
        if (end < 0) end = 0;
      } else if (end > len) {
        end = len;
      }
      if (end < start) end = start;
      const newBuf = this.subarray(start, end);
      Object.setPrototypeOf(newBuf, Buffer3.prototype);
      return newBuf;
    };
    function checkOffset(offset, ext, length) {
      if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
      if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
    }
    Buffer3.prototype.readUintLE = Buffer3.prototype.readUIntLE = function readUIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i2 = 0;
      while (++i2 < byteLength2 && (mul *= 256)) {
        val += this[offset + i2] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUintBE = Buffer3.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        checkOffset(offset, byteLength2, this.length);
      }
      let val = this[offset + --byteLength2];
      let mul = 1;
      while (byteLength2 > 0 && (mul *= 256)) {
        val += this[offset + --byteLength2] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUint8 = Buffer3.prototype.readUInt8 = function readUInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      return this[offset];
    };
    Buffer3.prototype.readUint16LE = Buffer3.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] | this[offset + 1] << 8;
    };
    Buffer3.prototype.readUint16BE = Buffer3.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] << 8 | this[offset + 1];
    };
    Buffer3.prototype.readUint32LE = Buffer3.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
    };
    Buffer3.prototype.readUint32BE = Buffer3.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
    };
    Buffer3.prototype.readBigUInt64LE = defineBigIntMethod(function readBigUInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const lo = first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24;
      const hi = this[++offset] + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + last * 2 ** 24;
      return BigInt(lo) + (BigInt(hi) << BigInt(32));
    });
    Buffer3.prototype.readBigUInt64BE = defineBigIntMethod(function readBigUInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const hi = first * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      const lo = this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last;
      return (BigInt(hi) << BigInt(32)) + BigInt(lo);
    });
    Buffer3.prototype.readIntLE = function readIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i2 = 0;
      while (++i2 < byteLength2 && (mul *= 256)) {
        val += this[offset + i2] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let i2 = byteLength2;
      let mul = 1;
      let val = this[offset + --i2];
      while (i2 > 0 && (mul *= 256)) {
        val += this[offset + --i2] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readInt8 = function readInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      if (!(this[offset] & 128)) return this[offset];
      return (255 - this[offset] + 1) * -1;
    };
    Buffer3.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset] | this[offset + 1] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset + 1] | this[offset] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
    };
    Buffer3.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
    };
    Buffer3.prototype.readBigInt64LE = defineBigIntMethod(function readBigInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = this[offset + 4] + this[offset + 5] * 2 ** 8 + this[offset + 6] * 2 ** 16 + (last << 24);
      return (BigInt(val) << BigInt(32)) + BigInt(first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24);
    });
    Buffer3.prototype.readBigInt64BE = defineBigIntMethod(function readBigInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = (first << 24) + // Overflow
      this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      return (BigInt(val) << BigInt(32)) + BigInt(this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last);
    });
    Buffer3.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, true, 23, 4);
    };
    Buffer3.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, false, 23, 4);
    };
    Buffer3.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, true, 52, 8);
    };
    Buffer3.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, false, 52, 8);
    };
    function checkInt(buf, value, offset, ext, max, min) {
      if (!Buffer3.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
      if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
    }
    Buffer3.prototype.writeUintLE = Buffer3.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let mul = 1;
      let i2 = 0;
      this[offset] = value & 255;
      while (++i2 < byteLength2 && (mul *= 256)) {
        this[offset + i2] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUintBE = Buffer3.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let i2 = byteLength2 - 1;
      let mul = 1;
      this[offset + i2] = value & 255;
      while (--i2 >= 0 && (mul *= 256)) {
        this[offset + i2] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUint8 = Buffer3.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeUint16LE = Buffer3.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeUint16BE = Buffer3.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeUint32LE = Buffer3.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset + 3] = value >>> 24;
      this[offset + 2] = value >>> 16;
      this[offset + 1] = value >>> 8;
      this[offset] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeUint32BE = Buffer3.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    function wrtBigUInt64LE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      return offset;
    }
    function wrtBigUInt64BE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset + 7] = lo;
      lo = lo >> 8;
      buf[offset + 6] = lo;
      lo = lo >> 8;
      buf[offset + 5] = lo;
      lo = lo >> 8;
      buf[offset + 4] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset + 3] = hi;
      hi = hi >> 8;
      buf[offset + 2] = hi;
      hi = hi >> 8;
      buf[offset + 1] = hi;
      hi = hi >> 8;
      buf[offset] = hi;
      return offset + 8;
    }
    Buffer3.prototype.writeBigUInt64LE = defineBigIntMethod(function writeBigUInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeBigUInt64BE = defineBigIntMethod(function writeBigUInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeIntLE = function writeIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i2 = 0;
      let mul = 1;
      let sub = 0;
      this[offset] = value & 255;
      while (++i2 < byteLength2 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i2 - 1] !== 0) {
          sub = 1;
        }
        this[offset + i2] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeIntBE = function writeIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i2 = byteLength2 - 1;
      let mul = 1;
      let sub = 0;
      this[offset + i2] = value & 255;
      while (--i2 >= 0 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i2 + 1] !== 0) {
          sub = 1;
        }
        this[offset + i2] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
      if (value < 0) value = 255 + value + 1;
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      this[offset + 2] = value >>> 16;
      this[offset + 3] = value >>> 24;
      return offset + 4;
    };
    Buffer3.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      if (value < 0) value = 4294967295 + value + 1;
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeBigInt64LE = defineBigIntMethod(function writeBigInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    Buffer3.prototype.writeBigInt64BE = defineBigIntMethod(function writeBigInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    function checkIEEE754(buf, value, offset, ext, max, min) {
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
      if (offset < 0) throw new RangeError("Index out of range");
    }
    function writeFloat(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 4, 34028234663852886e22, -34028234663852886e22);
      }
      ieee754.write(buf, value, offset, littleEndian, 23, 4);
      return offset + 4;
    }
    Buffer3.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
      return writeFloat(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
      return writeFloat(this, value, offset, false, noAssert);
    };
    function writeDouble(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 8, 17976931348623157e292, -17976931348623157e292);
      }
      ieee754.write(buf, value, offset, littleEndian, 52, 8);
      return offset + 8;
    }
    Buffer3.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
      return writeDouble(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
      return writeDouble(this, value, offset, false, noAssert);
    };
    Buffer3.prototype.copy = function copy(target, targetStart, start, end) {
      if (!Buffer3.isBuffer(target)) throw new TypeError("argument should be a Buffer");
      if (!start) start = 0;
      if (!end && end !== 0) end = this.length;
      if (targetStart >= target.length) targetStart = target.length;
      if (!targetStart) targetStart = 0;
      if (end > 0 && end < start) end = start;
      if (end === start) return 0;
      if (target.length === 0 || this.length === 0) return 0;
      if (targetStart < 0) {
        throw new RangeError("targetStart out of bounds");
      }
      if (start < 0 || start >= this.length) throw new RangeError("Index out of range");
      if (end < 0) throw new RangeError("sourceEnd out of bounds");
      if (end > this.length) end = this.length;
      if (target.length - targetStart < end - start) {
        end = target.length - targetStart + start;
      }
      const len = end - start;
      if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
        this.copyWithin(targetStart, start, end);
      } else {
        Uint8Array.prototype.set.call(
          target,
          this.subarray(start, end),
          targetStart
        );
      }
      return len;
    };
    Buffer3.prototype.fill = function fill(val, start, end, encoding) {
      if (typeof val === "string") {
        if (typeof start === "string") {
          encoding = start;
          start = 0;
          end = this.length;
        } else if (typeof end === "string") {
          encoding = end;
          end = this.length;
        }
        if (encoding !== void 0 && typeof encoding !== "string") {
          throw new TypeError("encoding must be a string");
        }
        if (typeof encoding === "string" && !Buffer3.isEncoding(encoding)) {
          throw new TypeError("Unknown encoding: " + encoding);
        }
        if (val.length === 1) {
          const code = val.charCodeAt(0);
          if (encoding === "utf8" && code < 128 || encoding === "latin1") {
            val = code;
          }
        }
      } else if (typeof val === "number") {
        val = val & 255;
      } else if (typeof val === "boolean") {
        val = Number(val);
      }
      if (start < 0 || this.length < start || this.length < end) {
        throw new RangeError("Out of range index");
      }
      if (end <= start) {
        return this;
      }
      start = start >>> 0;
      end = end === void 0 ? this.length : end >>> 0;
      if (!val) val = 0;
      let i2;
      if (typeof val === "number") {
        for (i2 = start; i2 < end; ++i2) {
          this[i2] = val;
        }
      } else {
        const bytes = Buffer3.isBuffer(val) ? val : Buffer3.from(val, encoding);
        const len = bytes.length;
        if (len === 0) {
          throw new TypeError('The value "' + val + '" is invalid for argument "value"');
        }
        for (i2 = 0; i2 < end - start; ++i2) {
          this[i2 + start] = bytes[i2 % len];
        }
      }
      return this;
    };
    var errors = {};
    function E2(sym, getMessage, Base) {
      errors[sym] = class NodeError extends Base {
        constructor() {
          super();
          Object.defineProperty(this, "message", {
            value: getMessage.apply(this, arguments),
            writable: true,
            configurable: true
          });
          this.name = `${this.name} [${sym}]`;
          this.stack;
          delete this.name;
        }
        get code() {
          return sym;
        }
        set code(value) {
          Object.defineProperty(this, "code", {
            configurable: true,
            enumerable: true,
            value,
            writable: true
          });
        }
        toString() {
          return `${this.name} [${sym}]: ${this.message}`;
        }
      };
    }
    E2(
      "ERR_BUFFER_OUT_OF_BOUNDS",
      function(name) {
        if (name) {
          return `${name} is outside of buffer bounds`;
        }
        return "Attempt to access memory outside buffer bounds";
      },
      RangeError
    );
    E2(
      "ERR_INVALID_ARG_TYPE",
      function(name, actual) {
        return `The "${name}" argument must be of type number. Received type ${typeof actual}`;
      },
      TypeError
    );
    E2(
      "ERR_OUT_OF_RANGE",
      function(str, range, input) {
        let msg = `The value of "${str}" is out of range.`;
        let received = input;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
          received = addNumericalSeparator(String(input));
        } else if (typeof input === "bigint") {
          received = String(input);
          if (input > BigInt(2) ** BigInt(32) || input < -(BigInt(2) ** BigInt(32))) {
            received = addNumericalSeparator(received);
          }
          received += "n";
        }
        msg += ` It must be ${range}. Received ${received}`;
        return msg;
      },
      RangeError
    );
    function addNumericalSeparator(val) {
      let res = "";
      let i2 = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (; i2 >= start + 4; i2 -= 3) {
        res = `_${val.slice(i2 - 3, i2)}${res}`;
      }
      return `${val.slice(0, i2)}${res}`;
    }
    function checkBounds(buf, offset, byteLength2) {
      validateNumber(offset, "offset");
      if (buf[offset] === void 0 || buf[offset + byteLength2] === void 0) {
        boundsError(offset, buf.length - (byteLength2 + 1));
      }
    }
    function checkIntBI(value, min, max, buf, offset, byteLength2) {
      if (value > max || value < min) {
        const n2 = typeof min === "bigint" ? "n" : "";
        let range;
        if (byteLength2 > 3) {
          if (min === 0 || min === BigInt(0)) {
            range = `>= 0${n2} and < 2${n2} ** ${(byteLength2 + 1) * 8}${n2}`;
          } else {
            range = `>= -(2${n2} ** ${(byteLength2 + 1) * 8 - 1}${n2}) and < 2 ** ${(byteLength2 + 1) * 8 - 1}${n2}`;
          }
        } else {
          range = `>= ${min}${n2} and <= ${max}${n2}`;
        }
        throw new errors.ERR_OUT_OF_RANGE("value", range, value);
      }
      checkBounds(buf, offset, byteLength2);
    }
    function validateNumber(value, name) {
      if (typeof value !== "number") {
        throw new errors.ERR_INVALID_ARG_TYPE(name, "number", value);
      }
    }
    function boundsError(value, length, type) {
      if (Math.floor(value) !== value) {
        validateNumber(value, type);
        throw new errors.ERR_OUT_OF_RANGE(type || "offset", "an integer", value);
      }
      if (length < 0) {
        throw new errors.ERR_BUFFER_OUT_OF_BOUNDS();
      }
      throw new errors.ERR_OUT_OF_RANGE(
        type || "offset",
        `>= ${type ? 1 : 0} and <= ${length}`,
        value
      );
    }
    var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
    function base64clean(str) {
      str = str.split("=")[0];
      str = str.trim().replace(INVALID_BASE64_RE, "");
      if (str.length < 2) return "";
      while (str.length % 4 !== 0) {
        str = str + "=";
      }
      return str;
    }
    function utf8ToBytes(string, units) {
      units = units || Infinity;
      let codePoint;
      const length = string.length;
      let leadSurrogate = null;
      const bytes = [];
      for (let i2 = 0; i2 < length; ++i2) {
        codePoint = string.charCodeAt(i2);
        if (codePoint > 55295 && codePoint < 57344) {
          if (!leadSurrogate) {
            if (codePoint > 56319) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            } else if (i2 + 1 === length) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            }
            leadSurrogate = codePoint;
            continue;
          }
          if (codePoint < 56320) {
            if ((units -= 3) > -1) bytes.push(239, 191, 189);
            leadSurrogate = codePoint;
            continue;
          }
          codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
        } else if (leadSurrogate) {
          if ((units -= 3) > -1) bytes.push(239, 191, 189);
        }
        leadSurrogate = null;
        if (codePoint < 128) {
          if ((units -= 1) < 0) break;
          bytes.push(codePoint);
        } else if (codePoint < 2048) {
          if ((units -= 2) < 0) break;
          bytes.push(
            codePoint >> 6 | 192,
            codePoint & 63 | 128
          );
        } else if (codePoint < 65536) {
          if ((units -= 3) < 0) break;
          bytes.push(
            codePoint >> 12 | 224,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else if (codePoint < 1114112) {
          if ((units -= 4) < 0) break;
          bytes.push(
            codePoint >> 18 | 240,
            codePoint >> 12 & 63 | 128,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else {
          throw new Error("Invalid code point");
        }
      }
      return bytes;
    }
    function asciiToBytes(str) {
      const byteArray = [];
      for (let i2 = 0; i2 < str.length; ++i2) {
        byteArray.push(str.charCodeAt(i2) & 255);
      }
      return byteArray;
    }
    function utf16leToBytes(str, units) {
      let c2, hi, lo;
      const byteArray = [];
      for (let i2 = 0; i2 < str.length; ++i2) {
        if ((units -= 2) < 0) break;
        c2 = str.charCodeAt(i2);
        hi = c2 >> 8;
        lo = c2 % 256;
        byteArray.push(lo);
        byteArray.push(hi);
      }
      return byteArray;
    }
    function base64ToBytes(str) {
      return base64.toByteArray(base64clean(str));
    }
    function blitBuffer(src, dst, offset, length) {
      let i2;
      for (i2 = 0; i2 < length; ++i2) {
        if (i2 + offset >= dst.length || i2 >= src.length) break;
        dst[i2 + offset] = src[i2];
      }
      return i2;
    }
    function isInstance(obj, type) {
      return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
    }
    function numberIsNaN(obj) {
      return obj !== obj;
    }
    var hexSliceLookupTable = (function() {
      const alphabet = "0123456789abcdef";
      const table = new Array(256);
      for (let i2 = 0; i2 < 16; ++i2) {
        const i16 = i2 * 16;
        for (let j2 = 0; j2 < 16; ++j2) {
          table[i16 + j2] = alphabet[i2] + alphabet[j2];
        }
      }
      return table;
    })();
    function defineBigIntMethod(fn) {
      return typeof BigInt === "undefined" ? BufferBigIntNotDefined : fn;
    }
    function BufferBigIntNotDefined() {
      throw new Error("BigInt not supported");
    }
  }
});

// node_modules/webtorrent/dist/webtorrent.min.js
var e;
var t;
var i = { 61: () => {
}, 405: (e2) => {
  e2.exports = async function* (e3) {
    for (let t2 of e3) "function" == typeof t2 && (t2 = t2()), yield* t2;
  };
}, 580: (e2) => {
  var t2 = /["'&<>]/;
  e2.exports = function(e3) {
    var i2, s2 = "" + e3, n2 = t2.exec(s2);
    if (!n2) return s2;
    var r2 = "", o2 = 0, a2 = 0;
    for (o2 = n2.index; o2 < s2.length; o2++) {
      switch (s2.charCodeAt(o2)) {
        case 34:
          i2 = "&quot;";
          break;
        case 38:
          i2 = "&amp;";
          break;
        case 39:
          i2 = "&#39;";
          break;
        case 60:
          i2 = "&lt;";
          break;
        case 62:
          i2 = "&gt;";
          break;
        default:
          continue;
      }
      a2 !== o2 && (r2 += s2.substring(a2, o2)), a2 = o2 + 1, r2 += i2;
    }
    return a2 !== o2 ? r2 + s2.substring(a2, o2) : r2;
  };
}, 717: (e2, t2, i2) => {
  i2.r(t2), i2.d(t2, { addListener: () => u2, argv: () => a2, binding: () => S2, browser: () => r2, chdir: () => E2, cwd: () => k2, emit: () => g2, env: () => o2, listeners: () => v2, nextTick: () => b2, off: () => f2, on: () => d2, once: () => p2, prependListener: () => y2, prependOnceListener: () => w2, removeAllListeners: () => _2, removeListener: () => m2, title: () => n2, umask: () => x2, version: () => h2, versions: () => l2 });
  var s2 = i2(9596);
  const n2 = "browser", r2 = true, o2 = {}, a2 = [], h2 = "", l2 = {};
  function c2() {
  }
  const d2 = c2, u2 = c2, p2 = c2, f2 = c2, m2 = c2, _2 = c2, g2 = c2, y2 = c2, w2 = c2, b2 = (e3, ...t3) => s2(() => e3(...t3)), v2 = (e3) => [], k2 = () => "/", x2 = () => 0, S2 = (e3) => {
    throw new Error("process.binding is not supported");
  }, E2 = (e3) => {
    throw new Error("process.chdir is not supported");
  };
}, 736: (e2, t2, i2) => {
  e2.exports = function(e3) {
    function t3(e4) {
      let i3, n3, r2, o2 = null;
      function a2(...e5) {
        if (!a2.enabled) return;
        const s3 = a2, n4 = Number(/* @__PURE__ */ new Date()), r3 = n4 - (i3 || n4);
        s3.diff = r3, s3.prev = i3, s3.curr = n4, i3 = n4, e5[0] = t3.coerce(e5[0]), "string" != typeof e5[0] && e5.unshift("%O");
        let o3 = 0;
        e5[0] = e5[0].replace(/%([a-zA-Z%])/g, (i4, n5) => {
          if ("%%" === i4) return "%";
          o3++;
          const r4 = t3.formatters[n5];
          if ("function" == typeof r4) {
            const t4 = e5[o3];
            i4 = r4.call(s3, t4), e5.splice(o3, 1), o3--;
          }
          return i4;
        }), t3.formatArgs.call(s3, e5);
        (s3.log || t3.log).apply(s3, e5);
      }
      return a2.namespace = e4, a2.useColors = t3.useColors(), a2.color = t3.selectColor(e4), a2.extend = s2, a2.destroy = t3.destroy, Object.defineProperty(a2, "enabled", { enumerable: true, configurable: false, get: () => null !== o2 ? o2 : (n3 !== t3.namespaces && (n3 = t3.namespaces, r2 = t3.enabled(e4)), r2), set: (e5) => {
        o2 = e5;
      } }), "function" == typeof t3.init && t3.init(a2), a2;
    }
    function s2(e4, i3) {
      const s3 = t3(this.namespace + (void 0 === i3 ? ":" : i3) + e4);
      return s3.log = this.log, s3;
    }
    function n2(e4, t4) {
      let i3 = 0, s3 = 0, n3 = -1, r2 = 0;
      for (; i3 < e4.length; ) if (s3 < t4.length && (t4[s3] === e4[i3] || "*" === t4[s3])) "*" === t4[s3] ? (n3 = s3, r2 = i3, s3++) : (i3++, s3++);
      else {
        if (-1 === n3) return false;
        s3 = n3 + 1, r2++, i3 = r2;
      }
      for (; s3 < t4.length && "*" === t4[s3]; ) s3++;
      return s3 === t4.length;
    }
    return t3.debug = t3, t3.default = t3, t3.coerce = function(e4) {
      if (e4 instanceof Error) return e4.stack || e4.message;
      return e4;
    }, t3.disable = function() {
      const e4 = [...t3.names, ...t3.skips.map((e5) => "-" + e5)].join(",");
      return t3.enable(""), e4;
    }, t3.enable = function(e4) {
      t3.save(e4), t3.namespaces = e4, t3.names = [], t3.skips = [];
      const i3 = ("string" == typeof e4 ? e4 : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
      for (const e5 of i3) "-" === e5[0] ? t3.skips.push(e5.slice(1)) : t3.names.push(e5);
    }, t3.enabled = function(e4) {
      for (const i3 of t3.skips) if (n2(e4, i3)) return false;
      for (const i3 of t3.names) if (n2(e4, i3)) return true;
      return false;
    }, t3.humanize = i2(6585), t3.destroy = function() {
      console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
    }, Object.keys(e3).forEach((i3) => {
      t3[i3] = e3[i3];
    }), t3.names = [], t3.skips = [], t3.formatters = {}, t3.selectColor = function(e4) {
      let i3 = 0;
      for (let t4 = 0; t4 < e4.length; t4++) i3 = (i3 << 5) - i3 + e4.charCodeAt(t4), i3 |= 0;
      return t3.colors[Math.abs(i3) % t3.colors.length];
    }, t3.enable(t3.load()), t3;
  };
}, 815: (e2, t2, i2) => {
  var s2, n2 = i2(717), r2 = i2(3519), o2 = i2(6611);
  try {
    s2 = i2(2376);
  } catch (e3) {
  }
  var a2 = function() {
  }, h2 = void 0 !== n2 && /^v?\.0/.test(n2.version), l2 = function(e3) {
    return "function" == typeof e3;
  }, c2 = function(e3, t3, i3, n3) {
    n3 = r2(n3);
    var c3 = false;
    e3.on("close", function() {
      c3 = true;
    }), o2(e3, { readable: t3, writable: i3 }, function(e4) {
      if (e4) return n3(e4);
      c3 = true, n3();
    });
    var d3 = false;
    return function(t4) {
      if (!c3 && !d3) return d3 = true, (function(e4) {
        return !!h2 && !!s2 && (e4 instanceof (s2.ReadStream || a2) || e4 instanceof (s2.WriteStream || a2)) && l2(e4.close);
      })(e3) ? e3.close(a2) : (function(e4) {
        return e4.setHeader && l2(e4.abort);
      })(e3) ? e3.abort() : l2(e3.destroy) ? e3.destroy() : void n3(t4 || new Error("stream was destroyed"));
    };
  }, d2 = function(e3) {
    e3();
  }, u2 = function(e3, t3) {
    return e3.pipe(t3);
  };
  e2.exports = function() {
    var e3, t3 = Array.prototype.slice.call(arguments), i3 = l2(t3[t3.length - 1] || a2) && t3.pop() || a2;
    if (Array.isArray(t3[0]) && (t3 = t3[0]), t3.length < 2) throw new Error("pump requires two streams per minimum");
    var s3 = t3.map(function(n3, r3) {
      var o3 = r3 < t3.length - 1;
      return c2(n3, o3, r3 > 0, function(t4) {
        e3 || (e3 = t4), t4 && s3.forEach(d2), o3 || (s3.forEach(d2), i3(e3));
      });
    });
    return t3.reduce(u2);
  };
}, 826: () => {
}, 988: (e2, t2, i2) => {
  i2.d(t2, { A: () => f2 });
  var s2 = i2(9639);
  function n2(e3) {
    const t3 = e3 < 0 ? 1 : 0;
    return e3 = Math.abs(Number(e3 || 1)), Math.floor(Math.log10(e3)) + 1 + t3;
  }
  function r2(e3) {
    return ArrayBuffer.isView(e3) ? "arraybufferview" : Array.isArray(e3) ? "array" : e3 instanceof Number ? "number" : e3 instanceof Boolean ? "boolean" : e3 instanceof Set ? "set" : e3 instanceof Map ? "map" : e3 instanceof String ? "string" : e3 instanceof ArrayBuffer ? "arraybuffer" : typeof e3;
  }
  function o2(e3, t3, i3) {
    const n3 = [];
    let r3 = null;
    return o2._encode(n3, e3), r3 = (0, s2.xW)(n3), o2.bytes = r3.length, ArrayBuffer.isView(t3) ? (t3.set(r3, i3), t3) : r3;
  }
  o2.bytes = -1, o2._floatConversionDetected = false, o2._encode = function(e3, t3) {
    if (null != t3) switch (r2(t3)) {
      case "object":
        o2.dict(e3, t3);
        break;
      case "map":
        o2.dictMap(e3, t3);
        break;
      case "array":
        o2.list(e3, t3);
        break;
      case "set":
        o2.listSet(e3, t3);
        break;
      case "string":
        o2.string(e3, t3);
        break;
      case "number":
      case "boolean":
        o2.number(e3, t3);
        break;
      case "arraybufferview":
        o2.buffer(e3, new Uint8Array(t3.buffer, t3.byteOffset, t3.byteLength));
        break;
      case "arraybuffer":
        o2.buffer(e3, new Uint8Array(t3));
    }
  };
  const a2 = new Uint8Array([101]), h2 = new Uint8Array([100]), l2 = new Uint8Array([108]);
  o2.buffer = function(e3, t3) {
    e3.push((0, s2.L0)(t3.length + ":"), t3);
  }, o2.string = function(e3, t3) {
    e3.push((0, s2.L0)((0, s2.L0)(t3).byteLength + ":" + t3));
  }, o2.number = function(e3, t3) {
    if (Number.isInteger(t3)) return e3.push((0, s2.L0)("i" + BigInt(t3) + "e"));
    const i3 = 2147483648, n3 = (t3 / i3 | 0) * i3 + (t3 % i3 | 0);
    e3.push((0, s2.L0)("i" + n3 + "e")), n3 === t3 || o2._floatConversionDetected || (o2._floatConversionDetected = true, console.warn('WARNING: Possible data corruption detected with value "' + t3 + '":', 'Bencoding only defines support for integers, value was converted to "' + n3 + '"'), console.trace());
  }, o2.dict = function(e3, t3) {
    e3.push(h2);
    let i3, s3 = 0;
    const n3 = Object.keys(t3).sort(), r3 = n3.length;
    for (; s3 < r3; s3++) i3 = n3[s3], null != t3[i3] && (o2.string(e3, i3), o2._encode(e3, t3[i3]));
    e3.push(a2);
  }, o2.dictMap = function(e3, t3) {
    e3.push(h2);
    const i3 = Array.from(t3.keys()).sort();
    for (const s3 of i3) null != t3.get(s3) && (ArrayBuffer.isView(s3) ? o2._encode(e3, s3) : o2.string(e3, String(s3)), o2._encode(e3, t3.get(s3)));
    e3.push(a2);
  }, o2.list = function(e3, t3) {
    let i3 = 0;
    const s3 = t3.length;
    for (e3.push(l2); i3 < s3; i3++) null != t3[i3] && o2._encode(e3, t3[i3]);
    e3.push(a2);
  }, o2.listSet = function(e3, t3) {
    e3.push(l2);
    for (const i3 of t3) null != i3 && o2._encode(e3, i3);
    e3.push(a2);
  };
  const c2 = o2;
  function d2(e3, t3, i3) {
    let s3 = 0, n3 = 1;
    for (let r3 = t3; r3 < i3; r3++) {
      const i4 = e3[r3];
      if (i4 < 58 && i4 >= 48) s3 = 10 * s3 + (i4 - 48);
      else if (r3 !== t3 || 43 !== i4) {
        if (r3 !== t3 || 45 !== i4) {
          if (46 === i4) break;
          throw new Error("not a number: buffer[" + r3 + "] = " + i4);
        }
        n3 = -1;
      }
    }
    return s3 * n3;
  }
  function u2(e3, t3, i3, n3) {
    return null == e3 || 0 === e3.length ? null : ("number" != typeof t3 && null == n3 && (n3 = t3, t3 = void 0), "number" != typeof i3 && null == n3 && (n3 = i3, i3 = void 0), u2.position = 0, u2.encoding = n3 || null, u2.data = ArrayBuffer.isView(e3) ? new Uint8Array(e3.slice(t3, i3)) : (0, s2.L0)(e3), u2.bytes = u2.data.length, u2.next());
  }
  u2.bytes = 0, u2.position = 0, u2.data = null, u2.encoding = null, u2.next = function() {
    switch (u2.data[u2.position]) {
      case 100:
        return u2.dictionary();
      case 108:
        return u2.list();
      case 105:
        return u2.integer();
      default:
        return u2.buffer();
    }
  }, u2.find = function(e3) {
    let t3 = u2.position;
    const i3 = u2.data.length, s3 = u2.data;
    for (; t3 < i3; ) {
      if (s3[t3] === e3) return t3;
      t3++;
    }
    throw new Error('Invalid data: Missing delimiter "' + String.fromCharCode(e3) + '" [0x' + e3.toString(16) + "]");
  }, u2.dictionary = function() {
    u2.position++;
    const e3 = {};
    for (; 101 !== u2.data[u2.position]; ) {
      const t3 = u2.buffer();
      let i3 = (0, s2.dU)(t3);
      i3.includes("\uFFFD") && (i3 = (0, s2.V5)(t3)), e3[i3] = u2.next();
    }
    return u2.position++, e3;
  }, u2.list = function() {
    u2.position++;
    const e3 = [];
    for (; 101 !== u2.data[u2.position]; ) e3.push(u2.next());
    return u2.position++, e3;
  }, u2.integer = function() {
    const e3 = u2.find(101), t3 = d2(u2.data, u2.position + 1, e3);
    return u2.position += e3 + 1 - u2.position, t3;
  }, u2.buffer = function() {
    let e3 = u2.find(58);
    const t3 = d2(u2.data, u2.position, e3), i3 = ++e3 + t3;
    return u2.position = i3, u2.encoding ? (0, s2.dU)(u2.data.slice(e3, i3)) : u2.data.slice(e3, i3);
  };
  function p2(e3) {
    if (null == e3) return 0;
    const t3 = r2(e3);
    switch (t3) {
      case "arraybufferview":
        return (function(e4) {
          const t4 = e4.byteLength - e4.byteOffset;
          return n2(t4) + 1 + t4;
        })(e3);
      case "string":
        return (function(e4) {
          const t4 = (0, s2.L0)(e4).byteLength;
          return n2(t4) + 1 + t4;
        })(e3);
      case "array":
      case "set":
        return (function(e4) {
          let t4 = 2;
          for (const i3 of e4) t4 += p2(i3);
          return t4;
        })(e3);
      case "number":
        return 1 + n2(Math.floor(e3)) + 1;
      case "bigint":
        return 1 + e3.toString().length + 1;
      case "object":
        return (function(e4) {
          let t4 = 2;
          const i3 = Object.keys(e4);
          for (let r3 = 0; r3 < i3.length; r3++) {
            const o3 = (0, s2.L0)(i3[r3]).byteLength;
            t4 += n2(o3) + 1 + o3, t4 += p2(e4[i3[r3]]);
          }
          return t4;
        })(e3);
      case "map":
        return (function(e4) {
          let t4 = 2;
          for (const [i3, r3] of e4) {
            const e5 = (0, s2.L0)(i3).byteLength;
            t4 += n2(e5) + 1 + e5, t4 += p2(r3);
          }
          return t4;
        })(e3);
      default:
        throw new TypeError(`Unsupported value of type "${t3}"`);
    }
  }
  const f2 = { encode: c2, decode: u2, byteLength: p2, encodingLength: p2 };
}, 1035: (e2, t2, i2) => {
  var s2 = i2(717);
  const n2 = void 0 !== s2 && !!s2.hrtime, r2 = 65535, o2 = n2 ? 1e8 : 100, a2 = n2 ? () => {
    const [e3, t3] = s2.hrtime();
    return 1e9 * e3 + t3;
  } : () => performance.now();
  function h2(e3) {
    return (a2() - e3) / o2 & r2;
  }
  e2.exports = function(e3) {
    const t3 = a2(), i3 = 10 * (e3 || 5), s3 = [0];
    let n3 = 1, o3 = h2(t3) - 1 & r2;
    return function(e4) {
      const a3 = h2(t3);
      let l2 = a3 - o3 & r2;
      for (l2 > i3 && (l2 = i3), o3 = a3; l2--; ) n3 === i3 && (n3 = 0), s3[n3] = s3[0 === n3 ? i3 - 1 : n3 - 1], n3++;
      e4 && (s3[n3 - 1] += e4);
      const c2 = s3[n3 - 1], d2 = s3.length < i3 ? 0 : s3[n3 === i3 ? 0 : n3];
      return s3.length < 10 ? c2 : 10 * (c2 - d2) / s3.length;
    };
  };
}, 1133: (e2, t2, i2) => {
  let s2 = i2(8673);
  e2.exports = new s2(i2(8446));
}, 1314: (e2) => {
  e2.exports = function(e3, t2) {
    if (t2 >= e3.length || t2 < 0) return;
    var i2 = e3.pop();
    if (t2 < e3.length) {
      var s2 = e3[t2];
      return e3[t2] = i2, s2;
    }
    return i2;
  };
}, 1467: (e2) => {
  function t2(e3, t3) {
    if ("string" == typeof e3[0]) return e3.join("");
    if ("number" == typeof e3[0]) return new Uint8Array(e3);
    const i2 = new Uint8Array(t3);
    let s2 = 0;
    for (let t4 = 0, n2 = e3.length; t4 < n2; t4++) {
      const n3 = e3[t4];
      i2.set(n3, s2), s2 += n3.byteLength || n3.length;
    }
    return i2;
  }
  e2.exports = async function* (e3, i2 = 512, s2 = {}) {
    "object" == typeof i2 && (i2 = (s2 = i2).size);
    let { nopad: n2, zeroPadding: r2 = true } = s2;
    n2 && (r2 = false);
    let o2 = [], a2 = 0;
    for await (const s3 of e3) if (a2 += s3.byteLength || s3.length || 1, o2.push(s3), a2 >= i2) {
      const e4 = t2(o2, a2);
      let s4 = 0;
      for (; a2 >= i2; ) yield e4.slice(s4, s4 + i2), a2 -= i2, s4 += i2;
      o2 = [e4.slice(s4, e4.length)];
    }
    a2 && (yield t2(o2, r2 ? i2 : a2));
  };
}, 1551: () => {
}, 1827: () => {
}, 2072: (e2) => {
  e2.exports = { wait: function(e3) {
    return new Promise((t2) => setTimeout(t2, e3));
  } };
}, 2123: () => {
}, 2376: () => {
}, 2532: () => {
}, 2701: () => {
}, 2799: () => {
}, 2878: (e2) => {
  function t2(e3, t3) {
    return { start: e3.start, end: e3.end, index: t3 };
  }
  function i2(e3) {
    return { start: e3.start, end: e3.end };
  }
  function s2(e3, t3) {
    return e3.index - t3.index;
  }
  function n2(e3, t3) {
    return e3.start - t3.start;
  }
  e2.exports = function(e3, r2, o2) {
    if ("string" != typeof r2) throw new TypeError("argument str must be a string");
    var a2 = r2.indexOf("=");
    if (-1 === a2) return -2;
    var h2 = r2.slice(a2 + 1).split(","), l2 = [];
    l2.type = r2.slice(0, a2);
    for (var c2 = 0; c2 < h2.length; c2++) {
      var d2 = h2[c2].split("-"), u2 = parseInt(d2[0], 10), p2 = parseInt(d2[1], 10);
      isNaN(u2) ? (u2 = e3 - p2, p2 = e3 - 1) : isNaN(p2) && (p2 = e3 - 1), p2 > e3 - 1 && (p2 = e3 - 1), isNaN(u2) || isNaN(p2) || u2 > p2 || u2 < 0 || l2.push({ start: u2, end: p2 });
    }
    if (l2.length < 1) return -1;
    return o2 && o2.combine ? (function(e4) {
      for (var r3 = e4.map(t2).sort(n2), o3 = 0, a3 = 1; a3 < r3.length; a3++) {
        var h3 = r3[a3], l3 = r3[o3];
        h3.start > l3.end + 1 ? r3[++o3] = h3 : h3.end > l3.end && (l3.end = h3.end, l3.index = Math.min(l3.index, h3.index));
      }
      r3.length = o3 + 1;
      var c3 = r3.sort(s2).map(i2);
      return c3.type = e4.type, c3;
    })(l2) : l2;
  };
}, 3033: (e2, t2, i2) => {
  function s2(e3) {
    return (e3 >> 3) + Number(e3 % 8 != 0);
  }
  i2.d(t2, { A: () => n2 });
  class n2 {
    get length() {
      return this.buffer.length << 3;
    }
    constructor(e3 = 0, t3) {
      const i3 = null == t3 ? void 0 : t3.grow;
      this.grow = i3 ? Number.isFinite(i3) ? s2(i3) : i3 : 0, this.buffer = "number" == typeof e3 ? new Uint8Array(s2(e3)) : e3;
    }
    get(e3) {
      const t3 = e3 >> 3;
      return t3 < this.buffer.length && !!(this.buffer[t3] & 128 >> e3 % 8);
    }
    set(e3, t3 = true) {
      const i3 = e3 >> 3;
      if (t3) {
        if (i3 >= this.buffer.length) {
          const e4 = Math.max(i3 + 1, Math.min(2 * this.buffer.length, this.grow));
          if (e4 <= this.grow) {
            const t4 = new Uint8Array(e4);
            t4.set(this.buffer), this.buffer = t4;
          }
        }
        this.buffer[i3] |= 128 >> e3 % 8;
      } else i3 < this.buffer.length && (this.buffer[i3] &= ~(128 >> e3 % 8));
    }
    setAll(e3, t3 = 0) {
      const i3 = Math.min(s2(t3 + e3.length), this.grow);
      if (this.buffer.length < i3) {
        const e4 = new Uint8Array(i3);
        e4.set(this.buffer), this.buffer = e4;
      }
      let n3 = t3 >> 3, r2 = 128 >> t3 % 8;
      for (let t4 = 0; t4 < e3.length; t4++) if (e3[t4] ? this.buffer[n3] |= r2 : this.buffer[n3] &= ~r2, 1 === r2) {
        if (n3 += 1, n3 >= this.buffer.length) break;
        r2 = 128;
      } else r2 >>= 1;
    }
    forEach(e3, t3 = 0, i3 = 8 * this.buffer.length) {
      let s3 = t3 >> 3, n3 = 128 >> t3 % 8;
      for (let r2 = t3; r2 < i3; r2++) e3(!!(this.buffer[s3] & n3), r2), 1 === n3 ? (s3 += 1, n3 = 128) : n3 >>= 1;
    }
    isEmpty() {
      for (let e3 = 0; e3 < this.buffer.length; e3++) if (0 !== this.buffer[e3]) return false;
      return true;
    }
  }
}, 3065: (e2, t2, i2) => {
  var s2 = i2(717), n2 = i2(5472), r2 = i2(3085), o2 = function(e3, t3, i3) {
    this.tokenBucket = new n2(e3, e3, t3, null), this.tokenBucket.content = e3, this.curIntervalStart = r2(), this.tokensThisInterval = 0, this.fireImmediately = i3;
  };
  o2.prototype = { tokenBucket: null, curIntervalStart: 0, tokensThisInterval: 0, fireImmediately: false, removeTokens: function(e3, t3) {
    if (e3 > this.tokenBucket.bucketSize) return s2.nextTick(t3.bind(null, "Requested tokens " + e3 + " exceeds maximum tokens per interval " + this.tokenBucket.bucketSize, null)), false;
    var i3 = this, n3 = r2();
    if ((n3 < this.curIntervalStart || n3 - this.curIntervalStart >= this.tokenBucket.interval) && (this.curIntervalStart = n3, this.tokensThisInterval = 0), e3 > this.tokenBucket.tokensPerInterval - this.tokensThisInterval) {
      if (this.fireImmediately) s2.nextTick(t3.bind(null, null, -1));
      else {
        var o3 = Math.ceil(this.curIntervalStart + this.tokenBucket.interval - n3);
        setTimeout(function() {
          i3.tokenBucket.removeTokens(e3, a2);
        }, o3);
      }
      return false;
    }
    return this.tokenBucket.removeTokens(e3, a2);
    function a2(s3, n4) {
      if (s3) return t3(s3, null);
      i3.tokensThisInterval += e3, t3(null, n4);
    }
  }, tryRemoveTokens: function(e3) {
    if (e3 > this.tokenBucket.bucketSize) return false;
    var t3 = r2();
    if ((t3 < this.curIntervalStart || t3 - this.curIntervalStart >= this.tokenBucket.interval) && (this.curIntervalStart = t3, this.tokensThisInterval = 0), e3 > this.tokenBucket.tokensPerInterval - this.tokensThisInterval) return false;
    var i3 = this.tokenBucket.tryRemoveTokens(e3);
    return i3 && (this.tokensThisInterval += e3), i3;
  }, getTokensRemaining: function() {
    return this.tokenBucket.drip(), this.tokenBucket.content;
  } }, e2.exports = o2;
}, 3085: (e2, t2, i2) => {
  var s2 = i2(717);
  e2.exports = function() {
    if (void 0 !== s2 && s2.hrtime) {
      var e3 = s2.hrtime(), t3 = e3[0], i3 = e3[1];
      return 1e3 * t3 + Math.floor(i3 / 1e6);
    }
    return (/* @__PURE__ */ new Date()).getTime();
  };
}, 3198: (e2) => {
  e2.exports = class {
    constructor(e3) {
      this.decoder = new TextDecoder("utf16le" === e3 ? "utf16-le" : e3);
    }
    get remaining() {
      return -1;
    }
    decode(e3) {
      return this.decoder.decode(e3, { stream: true });
    }
    flush() {
      return this.decoder.decode(new Uint8Array(0));
    }
  };
}, 3208: () => {
}, 3278: () => {
}, 3468: () => {
  "undefined" != typeof ReadableStream && (ReadableStream.prototype[Symbol.asyncIterator] || (ReadableStream.prototype[Symbol.asyncIterator] = function({ preventCancel: e2 } = {}) {
    const t2 = this.getReader(), i2 = this;
    let s2 = t2.read();
    return { next() {
      const e3 = s2;
      return s2 = t2.read(), e3;
    }, return: async (n2) => (await s2, t2.releaseLock(), e2 || i2.cancel(), { done: true, value: n2 }), async throw(e3) {
      throw await this.return(), e3;
    }, [Symbol.asyncIterator]() {
      return this;
    } };
  }), ReadableStream.prototype.getIterator || (ReadableStream.prototype.getIterator = function({ preventCancel: e2 } = {}) {
    return this[Symbol.asyncIterator]({ preventCancel: e2 });
  }));
}, 3519: (e2, t2, i2) => {
  var s2 = i2(6587);
  function n2(e3) {
    var t3 = function() {
      return t3.called ? t3.value : (t3.called = true, t3.value = e3.apply(this, arguments));
    };
    return t3.called = false, t3;
  }
  function r2(e3) {
    var t3 = function() {
      if (t3.called) throw new Error(t3.onceError);
      return t3.called = true, t3.value = e3.apply(this, arguments);
    }, i3 = e3.name || "Function wrapped with `once`";
    return t3.onceError = i3 + " shouldn't be called more than once", t3.called = false, t3;
  }
  e2.exports = s2(n2), e2.exports.strict = s2(r2), n2.proto = n2(function() {
    Object.defineProperty(Function.prototype, "once", { value: function() {
      return n2(this);
    }, configurable: true }), Object.defineProperty(Function.prototype, "onceStrict", { value: function() {
      return r2(this);
    }, configurable: true });
  });
}, 3714: (e2, t2, i2) => {
  const s2 = i2(9596);
  e2.exports = class {
    constructor(e3) {
      if (this.store = e3, this.chunkLength = e3.chunkLength, !this.store || !this.store.get || !this.store.put) throw new Error("First argument must be abstract-chunk-store compliant");
      this.mem = [];
    }
    put(e3, t3, i3 = () => {
    }) {
      this.mem[e3] = t3, this.store.put(e3, t3, (t4) => {
        this.mem[e3] = null, i3(t4);
      });
    }
    get(e3, t3, i3 = () => {
    }) {
      if ("function" == typeof t3) return this.get(e3, null, t3);
      let n2 = this.mem[e3];
      if (!n2) return this.store.get(e3, t3, i3);
      t3 || (t3 = {});
      const r2 = t3.offset || 0, o2 = t3.length || n2.length - r2;
      0 === r2 && o2 === n2.length || (n2 = n2.slice(r2, o2 + r2)), s2(() => i3(null, n2));
    }
    close(e3 = () => {
    }) {
      this.store.close(e3);
    }
    destroy(e3 = () => {
    }) {
      this.store.destroy(e3);
    }
  };
}, 3970: () => {
}, 4018: (e2) => {
  e2.exports = function() {
    for (var e3 = navigator.hardwareConcurrency || 1, t2 = [], i2 = 0; i2 < e3; i2++) t2.push({ model: "", speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } });
    return t2;
  };
}, 4043: () => {
}, 4343: () => {
}, 4497: (e2, t2, i2) => {
  const s2 = i2(8454), n2 = i2(9596);
  e2.exports = class {
    constructor(e3, t3) {
      if (this.store = e3, this.chunkLength = e3.chunkLength, this.inProgressGets = /* @__PURE__ */ new Map(), !this.store || !this.store.get || !this.store.put) throw new Error("First argument must be abstract-chunk-store compliant");
      this.cache = new s2(t3);
    }
    put(e3, t3, i3 = () => {
    }) {
      if (!this.cache) return n2(() => i3(new Error("CacheStore closed")));
      this.cache.remove(e3), this.store.put(e3, t3, i3);
    }
    get(e3, t3, i3 = () => {
    }) {
      if ("function" == typeof t3) return this.get(e3, null, t3);
      if (!this.cache) return n2(() => i3(new Error("CacheStore closed")));
      t3 || (t3 = {});
      let s3 = this.cache.get(e3);
      if (s3) {
        const e4 = t3.offset || 0, r3 = t3.length || s3.length - e4;
        return 0 === e4 && r3 === s3.length || (s3 = s3.slice(e4, r3 + e4)), n2(() => i3(null, s3));
      }
      let r2 = this.inProgressGets.get(e3);
      const o2 = !!r2;
      r2 || (r2 = [], this.inProgressGets.set(e3, r2)), r2.push({ opts: t3, cb: i3 }), o2 || this.store.get(e3, (t4, i4) => {
        t4 || null == this.cache || this.cache.set(e3, i4);
        const s4 = this.inProgressGets.get(e3);
        this.inProgressGets.delete(e3);
        for (const { opts: e4, cb: n3 } of s4) if (t4) n3(t4);
        else {
          const t5 = e4.offset || 0, s5 = e4.length || i4.length - t5;
          let r3 = i4;
          0 === t5 && s5 === i4.length || (r3 = i4.slice(t5, s5 + t5)), n3(null, r3);
        }
      });
    }
    close(e3 = () => {
    }) {
      if (!this.cache) return n2(() => e3(new Error("CacheStore closed")));
      this.cache = null, this.store.close(e3);
    }
    destroy(e3 = () => {
    }) {
      if (!this.cache) return n2(() => e3(new Error("CacheStore closed")));
      this.cache = null, this.store.destroy(e3);
    }
  };
}, 4862: (e2, t2, i2) => {
  e2.exports = n2;
  const s2 = i2(9596);
  function n2(e3, t3) {
    if (!(this instanceof n2)) return new n2(e3, t3);
    if (t3 || (t3 = {}), this.chunkLength = Number(e3), !this.chunkLength) throw new Error("First argument must be a chunk length");
    this.chunks = [], this.closed = false, this.length = Number(t3.length) || 1 / 0, this.length !== 1 / 0 && (this.lastChunkLength = this.length % this.chunkLength || this.chunkLength, this.lastChunkIndex = Math.ceil(this.length / this.chunkLength) - 1);
  }
  n2.prototype.put = function(e3, t3, i3 = () => {
  }) {
    if (this.closed) return s2(() => i3(new Error("Storage is closed")));
    const n3 = e3 === this.lastChunkIndex;
    return n3 && t3.length !== this.lastChunkLength ? s2(() => i3(new Error("Last chunk length must be " + this.lastChunkLength))) : n3 || t3.length === this.chunkLength ? (this.chunks[e3] = t3, void s2(() => i3(null))) : s2(() => i3(new Error("Chunk length must be " + this.chunkLength)));
  }, n2.prototype.get = function(e3, t3, i3 = () => {
  }) {
    if ("function" == typeof t3) return this.get(e3, null, t3);
    if (this.closed) return s2(() => i3(new Error("Storage is closed")));
    let n3 = this.chunks[e3];
    if (!n3) {
      const e4 = new Error("Chunk not found");
      return e4.notFound = true, s2(() => i3(e4));
    }
    t3 || (t3 = {});
    const r2 = t3.offset || 0, o2 = t3.length || n3.length - r2;
    0 === r2 && o2 === n3.length || (n3 = n3.slice(r2, o2 + r2)), s2(() => i3(null, n3));
  }, n2.prototype.close = n2.prototype.destroy = function(e3 = () => {
  }) {
    if (this.closed) return s2(() => e3(new Error("Storage is closed")));
    this.closed = true, this.chunks = null, s2(() => e3(null));
  };
}, 5335: (e2, t2, i2) => {
  const s2 = i2(3198), n2 = i2(3198);
  e2.exports = class {
    constructor(e3 = "utf8") {
      switch (this.encoding = (function(e4) {
        switch (e4 = e4.toLowerCase()) {
          case "utf8":
          case "utf-8":
            return "utf8";
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return "utf16le";
          case "latin1":
          case "binary":
            return "latin1";
          case "base64":
          case "ascii":
          case "hex":
            return e4;
          default:
            throw new Error("Unknown encoding: " + e4);
        }
      })(e3), this.encoding) {
        case "utf8":
          this.decoder = new n2();
          break;
        case "utf16le":
        case "base64":
          throw new Error("Unsupported encoding: " + this.encoding);
        default:
          this.decoder = new s2(this.encoding);
      }
    }
    get remaining() {
      return this.decoder.remaining;
    }
    push(e3) {
      return "string" == typeof e3 ? e3 : this.decoder.decode(e3);
    }
    write(e3) {
      return this.push(e3);
    }
    end(e3) {
      let t3 = "";
      return e3 && (t3 = this.push(e3)), t3 += this.decoder.flush(), t3;
    }
  };
}, 5372: (e2, t2, i2) => {
  e2.exports = function(e3, t3, i3) {
    if ("number" != typeof t3) throw new Error("second argument must be a Number");
    let n2, r2, o2, a2, h2, l2, c2 = true;
    Array.isArray(e3) ? (n2 = [], o2 = r2 = e3.length) : (a2 = Object.keys(e3), n2 = {}, o2 = r2 = a2.length);
    function d2(e4) {
      function t4() {
        i3 && i3(e4, n2), i3 = null;
      }
      c2 ? s2(t4) : t4();
    }
    function u2(t4, i4, s3) {
      if (n2[t4] = s3, i4 && (h2 = true), 0 === --o2 || i4) d2(i4);
      else if (!h2 && l2 < r2) {
        let t5;
        a2 ? (t5 = a2[l2], l2 += 1, e3[t5](function(e4, i5) {
          u2(t5, e4, i5);
        })) : (t5 = l2, l2 += 1, e3[t5](function(e4, i5) {
          u2(t5, e4, i5);
        }));
      }
    }
    l2 = t3, o2 ? a2 ? a2.some(function(i4, s3) {
      return e3[i4](function(e4, t4) {
        u2(i4, e4, t4);
      }), s3 === t3 - 1;
    }) : e3.some(function(e4, i4) {
      return e4(function(e5, t4) {
        u2(i4, e5, t4);
      }), i4 === t3 - 1;
    }) : d2(null);
    c2 = false;
  };
  const s2 = i2(9596);
}, 5472: (e2, t2, i2) => {
  var s2 = i2(717), n2 = function(e3, t3, i3, s3) {
    if (this.bucketSize = e3, this.tokensPerInterval = t3, "string" == typeof i3) switch (i3) {
      case "sec":
      case "second":
        this.interval = 1e3;
        break;
      case "min":
      case "minute":
        this.interval = 6e4;
        break;
      case "hr":
      case "hour":
        this.interval = 36e5;
        break;
      case "day":
        this.interval = 864e5;
        break;
      default:
        throw new Error("Invaid interval " + i3);
    }
    else this.interval = i3;
    this.parentBucket = s3, this.content = 0, this.lastDrip = +/* @__PURE__ */ new Date();
  };
  n2.prototype = { bucketSize: 1, tokensPerInterval: 1, interval: 1e3, parentBucket: null, content: 0, lastDrip: 0, removeTokens: function(e3, t3) {
    var i3 = this;
    return this.bucketSize ? e3 > this.bucketSize ? (s2.nextTick(t3.bind(null, "Requested tokens " + e3 + " exceeds bucket size " + this.bucketSize, null)), false) : (this.drip(), e3 > this.content ? n3() : this.parentBucket ? this.parentBucket.removeTokens(e3, function(s3, r2) {
      return s3 ? t3(s3, null) : e3 > i3.content ? n3() : (i3.content -= e3, void t3(null, Math.min(r2, i3.content)));
    }) : (this.content -= e3, s2.nextTick(t3.bind(null, null, this.content)), true)) : (s2.nextTick(t3.bind(null, null, e3, Number.POSITIVE_INFINITY)), true);
    function n3() {
      var s3 = Math.ceil((e3 - i3.content) * (i3.interval / i3.tokensPerInterval));
      return setTimeout(function() {
        i3.removeTokens(e3, t3);
      }, s3), false;
    }
  }, tryRemoveTokens: function(e3) {
    return !this.bucketSize || !(e3 > this.bucketSize) && (this.drip(), !(e3 > this.content) && (!(this.parentBucket && !this.parentBucket.tryRemoveTokens(e3)) && (this.content -= e3, true)));
  }, drip: function() {
    if (this.tokensPerInterval) {
      var e3 = +/* @__PURE__ */ new Date(), t3 = Math.max(e3 - this.lastDrip, 0);
      this.lastDrip = e3;
      var i3 = t3 * (this.tokensPerInterval / this.interval);
      this.content = Math.min(this.content + i3, this.bucketSize);
    } else this.content = this.bucketSize;
  } }, e2.exports = n2;
}, 5658: (e2, t2, i2) => {
  i2.r(t2), i2.d(t2, { default: () => _2, enableSecure: () => m2 });
  var s2 = i2(7007), n2 = i2(8179), r2 = i2(1314), o2 = i2(7833), a2 = i2(6458);
  const h2 = "tcpIncoming", l2 = "tcpOutgoing", c2 = "utpIncoming", d2 = "utpOutgoing", u2 = "webSeed", p2 = o2("webtorrent:peer");
  let f2 = false;
  const m2 = () => {
    f2 = true;
  };
  class _2 extends s2 {
    constructor(e3, t3) {
      super(), this.id = e3, this.type = t3, p2("new %s Peer %s", t3, e3), this.addr = null, this.conn = null, this.swarm = null, this.wire = null, this.source = null, this.connected = false, this.destroyed = false, this.timeout = null, this.retries = 0, this.sentPe1 = false, this.sentPe2 = false, this.sentPe3 = false, this.sentPe4 = false, this.sentHandshake = false;
    }
    onConnect() {
      if (this.destroyed) return;
      this.connected = true, this.emit("connect"), p2("Peer %s connected", this.id), clearTimeout(this.connectTimeout);
      const e3 = this.conn;
      e3.once("end", () => {
        this.destroy();
      }), e3.once("close", () => {
        this.destroy();
      }), e3.once("finish", () => {
        this.destroy();
      }), e3.once("error", (e4) => {
        this.destroy(e4);
      });
      const t3 = this.wire = new a2.A(this.type, this.retries, f2);
      t3.once("end", () => {
        this.destroy();
      }), t3.once("close", () => {
        this.destroy();
      }), t3.once("finish", () => {
        this.destroy();
      }), t3.once("error", (e4) => {
        this.destroy(e4);
      }), t3.once("pe1", () => {
        this.onPe1();
      }), t3.once("pe2", () => {
        this.onPe2();
      }), t3.once("pe3", () => {
        this.onPe3();
      }), t3.once("pe4", () => {
        this.onPe4();
      }), t3.once("handshake", (e4, t4) => {
        this.onHandshake(e4, t4);
      }), this.startHandshakeTimeout(), this.setThrottlePipes(), this.swarm && ("tcpOutgoing" === this.type ? f2 && 0 === this.retries && !this.sentPe1 ? this.sendPe1() : this.sentHandshake || this.handshake() : "tcpIncoming" === this.type || this.sentHandshake || this.handshake());
    }
    sendPe1() {
      this.wire.sendPe1(), this.sentPe1 = true;
    }
    onPe1() {
      this.sendPe2();
    }
    sendPe2() {
      this.wire.sendPe2(), this.sentPe2 = true;
    }
    onPe2() {
      this.sendPe3();
    }
    sendPe3() {
      this.wire.sendPe3(this.swarm.infoHash), this.sentPe3 = true;
    }
    onPe3(e3) {
      this.swarm && (this.swarm.infoHashHash !== e3 && this.destroy(new Error("unexpected crypto handshake info hash for this swarm")), this.sendPe4());
    }
    sendPe4() {
      this.wire.sendPe4(this.swarm.infoHash), this.sentPe4 = true;
    }
    onPe4() {
      this.sentHandshake || this.handshake();
    }
    clearPipes() {
      this.conn.unpipe(), this.wire.unpipe();
    }
    setThrottlePipes() {
      const e3 = this;
      (0, n2.pipeline)(this.conn, this.throttleGroups.down.throttle(), new n2.Transform({ transform(t3, i3) {
        e3.emit("download", t3.length), e3.destroyed || i3(null, t3);
      } }), this.wire, this.throttleGroups.up.throttle(), new n2.Transform({ transform(t3, i3) {
        e3.emit("upload", t3.length), e3.destroyed || i3(null, t3);
      } }), this.conn);
    }
    onHandshake(e3, t3) {
      if (!this.swarm) return;
      if (this.destroyed) return;
      if (this.swarm.destroyed) return this.destroy(new Error("swarm already destroyed"));
      if (e3 !== this.swarm.infoHash) return this.destroy(new Error("unexpected handshake info hash for this swarm"));
      if (t3 === this.swarm.peerId) return this.destroy(new Error("refusing to connect to ourselves"));
      p2("Peer %s got handshake %s", this.id, e3), clearTimeout(this.handshakeTimeout), this.retries = 0;
      let i3 = this.addr;
      !i3 && this.conn.remoteAddress && this.conn.remotePort && (i3 = `${this.conn.remoteAddress}:${this.conn.remotePort}`), this.swarm._onWire(this.wire, i3), this.swarm && !this.swarm.destroyed && (this.sentHandshake || this.handshake());
    }
    handshake() {
      const e3 = { dht: !this.swarm.private && !!this.swarm.client.dht, fast: true };
      this.wire.handshake(this.swarm.infoHash, this.swarm.client.peerId, e3), this.sentHandshake = true;
    }
    startConnectTimeout() {
      clearTimeout(this.connectTimeout);
      const e3 = { webrtc: 25e3, tcpOutgoing: 5e3, utpOutgoing: 5e3 };
      this.connectTimeout = setTimeout(() => {
        this.destroy(new Error("connect timeout"));
      }, e3[this.type]), this.connectTimeout.unref && this.connectTimeout.unref();
    }
    startHandshakeTimeout() {
      clearTimeout(this.handshakeTimeout), this.handshakeTimeout = setTimeout(() => {
        this.destroy(new Error("handshake timeout"));
      }, 25e3), this.handshakeTimeout.unref && this.handshakeTimeout.unref();
    }
    destroy(e3) {
      if (this.destroyed) return;
      this.destroyed = true, this.connected && this.emit("disconnect", e3), this.connected = false, p2("destroy %s %s (error: %s)", this.type, this.id, e3 && (e3.message || e3)), clearTimeout(this.connectTimeout), clearTimeout(this.handshakeTimeout);
      const t3 = this.swarm, i3 = this.conn, s3 = this.wire;
      this.swarm = null, this.conn = null, this.wire = null, t3 && s3 && r2(t3.wires, t3.wires.indexOf(s3)), i3 && (i3.on("error", () => {
      }), i3.destroy()), s3 && s3.destroy(), t3 && t3.removePeer(this.id);
    }
  }
  _2.TYPE_TCP_INCOMING = h2, _2.TYPE_TCP_OUTGOING = l2, _2.TYPE_UTP_INCOMING = c2, _2.TYPE_UTP_OUTGOING = d2, _2.TYPE_WEBRTC = "webrtc", _2.TYPE_WEBSEED = u2, _2.SOURCE_MANUAL = "manual", _2.SOURCE_TRACKER = "tracker", _2.SOURCE_DHT = "dht", _2.SOURCE_LSD = "lsd", _2.SOURCE_UT_PEX = "ut_pex", _2.createWebRTCPeer = (e3, t3, i3, s3 = null) => {
    const n3 = new _2(e3.id, "webrtc");
    if (n3.conn = e3, n3.swarm = t3, n3.throttleGroups = i3, n3.source = s3, n3.conn.connected) n3.onConnect();
    else {
      const e4 = () => {
        n3.conn.removeListener("connect", t4), n3.conn.removeListener("error", i4);
      }, t4 = () => {
        e4(), n3.onConnect();
      }, i4 = (t5) => {
        e4(), n3.destroy(t5);
      };
      n3.conn.once("connect", t4), n3.conn.once("error", i4), n3.startConnectTimeout();
    }
    return n3;
  }, _2.createTCPIncomingPeer = (e3, t3) => _2._createIncomingPeer(e3, h2, t3), _2.createUTPIncomingPeer = (e3, t3) => _2._createIncomingPeer(e3, c2, t3), _2.createTCPOutgoingPeer = (e3, t3, i3, s3) => _2._createOutgoingPeer(e3, t3, l2, i3, s3), _2.createUTPOutgoingPeer = (e3, t3, i3, s3) => _2._createOutgoingPeer(e3, t3, d2, i3, s3), _2._createIncomingPeer = (e3, t3, i3) => {
    const s3 = `${e3.remoteAddress}:${e3.remotePort}`, n3 = new _2(s3, t3);
    return n3.conn = e3, n3.addr = s3, n3.throttleGroups = i3, n3.onConnect(), n3;
  }, _2._createOutgoingPeer = (e3, t3, i3, s3, n3 = null) => {
    const r3 = new _2(e3, i3);
    return r3.addr = e3, r3.swarm = t3, r3.throttleGroups = s3, r3.source = n3, r3;
  }, _2.createWebSeedPeer = (e3, t3, i3, s3) => {
    const n3 = new _2(t3, u2);
    return n3.swarm = i3, n3.conn = e3, n3.throttleGroups = s3, n3.onConnect(), n3;
  };
}, 5809: (e2) => {
  e2.exports = class {
    constructor(e3) {
      if (!(e3 > 0) || e3 - 1 & e3) throw new Error("Max size for a FixedFIFO should be a power of two");
      this.buffer = new Array(e3), this.mask = e3 - 1, this.top = 0, this.btm = 0, this.next = null;
    }
    clear() {
      this.top = this.btm = 0, this.next = null, this.buffer.fill(void 0);
    }
    push(e3) {
      return void 0 === this.buffer[this.top] && (this.buffer[this.top] = e3, this.top = this.top + 1 & this.mask, true);
    }
    shift() {
      const e3 = this.buffer[this.btm];
      if (void 0 !== e3) return this.buffer[this.btm] = void 0, this.btm = this.btm + 1 & this.mask, e3;
    }
    peek() {
      return this.buffer[this.btm];
    }
    isEmpty() {
      return void 0 === this.buffer[this.btm];
    }
  };
}, 6080: (e2, t2, i2) => {
  const s2 = i2(5809);
  e2.exports = class {
    constructor(e3) {
      this.hwm = e3 || 16, this.head = new s2(this.hwm), this.tail = this.head, this.length = 0;
    }
    clear() {
      this.head = this.tail, this.head.clear(), this.length = 0;
    }
    push(e3) {
      if (this.length++, !this.head.push(e3)) {
        const t3 = this.head;
        this.head = t3.next = new s2(2 * this.head.buffer.length), this.head.push(e3);
      }
    }
    shift() {
      0 !== this.length && this.length--;
      const e3 = this.tail.shift();
      if (void 0 === e3 && this.tail.next) {
        const e4 = this.tail.next;
        return this.tail.next = null, this.tail = e4, this.tail.shift();
      }
      return e3;
    }
    peek() {
      const e3 = this.tail.peek();
      return void 0 === e3 && this.tail.next ? this.tail.next.peek() : e3;
    }
    isEmpty() {
      return 0 === this.length;
    }
  };
}, 6310: (e2) => {
  function t2(e3, t3) {
    for (const i2 in t3) Object.defineProperty(e3, i2, { value: t3[i2], enumerable: true, configurable: true });
    return e3;
  }
  e2.exports = function(e3, i2, s2) {
    if (!e3 || "string" == typeof e3) throw new TypeError("Please pass an Error to err-code");
    s2 || (s2 = {}), "object" == typeof i2 && (s2 = i2, i2 = ""), i2 && (s2.code = i2);
    try {
      return t2(e3, s2);
    } catch (i3) {
      s2.message = e3.message, s2.stack = e3.stack;
      const n2 = function() {
      };
      n2.prototype = Object.create(Object.getPrototypeOf(e3));
      return t2(new n2(), s2);
    }
  };
}, 6458: (e2, t2, i2) => {
  i2.d(t2, { A: () => O2 });
  var s2 = i2(988), n2 = i2(3033), r2 = i2(7264), o2 = i2(7833), a2 = i2(8727), h2 = i2(8179), l2 = i2(9639), c2 = i2(1035), d2 = i2(1314);
  const u2 = o2("bittorrent-protocol"), p2 = (0, l2.L0)("BitTorrent protocol"), f2 = new Uint8Array([0, 0, 0, 0]), m2 = new Uint8Array([0, 0, 0, 1, 0]), _2 = new Uint8Array([0, 0, 0, 1, 1]), g2 = new Uint8Array([0, 0, 0, 1, 2]), y2 = new Uint8Array([0, 0, 0, 1, 3]), w2 = [0, 0, 0, 0, 0, 0, 0, 0], b2 = [0, 0, 0, 3, 9, 0, 0], v2 = new Uint8Array([0, 0, 0, 1, 14]), k2 = new Uint8Array([0, 0, 0, 1, 15]), x2 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]), S2 = new Uint8Array([0, 0, 1, 2]), E2 = new Uint8Array([0, 0, 0, 2]);
  function C2(e3, t3) {
    for (let i3 = e3.length; i3--; ) e3[i3] ^= t3[i3];
    return e3;
  }
  function P2(e3, t3 = 0) {
    return e3[t3] << 24 | e3[t3 + 1] << 16 | e3[t3 + 2] << 8 | e3[t3 + 3];
  }
  function A2(e3, t3, i3) {
    e3[t3] = i3 >>> 24 & 255, e3[t3 + 1] = i3 >>> 16 & 255, e3[t3 + 2] = i3 >>> 8 & 255, e3[t3 + 3] = 255 & i3;
  }
  class T2 {
    constructor(e3, t3, i3, s3) {
      this.piece = e3, this.offset = t3, this.length = i3, this.callback = s3;
    }
  }
  class I2 {
    constructor() {
      this.buffer = new Uint8Array();
    }
    get(e3) {
      return true;
    }
    set(e3) {
    }
  }
  class L2 extends h2.Duplex {
    constructor(e3 = null, t3 = 0, i3 = false) {
      super(), this._debugId = (0, l2.V5)((0, l2.po)(4)), this._debug("new wire"), this.peerId = null, this.peerIdBuffer = null, this.type = e3, this.amChoking = true, this.amInterested = false, this.peerChoking = true, this.peerInterested = false, this.peerPieces = new n2.A(0, { grow: 4e5 }), this.extensions = {}, this.peerExtensions = {}, this.requests = [], this.peerRequests = [], this.extendedMapping = {}, this.peerExtendedMapping = {}, this.extendedHandshake = {}, this.peerExtendedHandshake = {}, this.hasFast = false, this.allowedFastSet = [], this.peerAllowedFastSet = [], this._ext = {}, this._nextExt = 1, this.uploaded = 0, this.downloaded = 0, this.uploadSpeed = c2(), this.downloadSpeed = c2(), this._keepAliveInterval = null, this._timeout = null, this._timeoutMs = 0, this._timeoutExpiresAt = null, this._finished = false, this._parserSize = 0, this._parser = null, this._buffer = [], this._bufferSize = 0, this._peEnabled = i3, i3 ? (this._dh = r2.createDiffieHellman("ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a63a36210000000000090563", "hex", 2), this._myPubKey = this._dh.generateKeys("hex")) : this._myPubKey = null, this._peerPubKey = null, this._sharedSecret = null, this._peerCryptoProvide = [], this._cryptoHandshakeDone = false, this._cryptoSyncPattern = null, this._waitMaxBytes = null, this._encryptionMethod = null, this._encryptGenerator = null, this._decryptGenerator = null, this._setGenerators = false, this.once("finish", () => this._onFinish()), this.on("finish", this._onFinish), this._debug("type:", this.type), "tcpIncoming" === this.type && this._peEnabled ? this._determineHandshakeType() : "tcpOutgoing" === this.type && this._peEnabled && 0 === t3 ? this._parsePe2() : this._parseHandshake(null);
    }
    setKeepAlive(e3) {
      this._debug("setKeepAlive %s", e3), clearInterval(this._keepAliveInterval), false !== e3 && (this._keepAliveInterval = setInterval(() => {
        this.keepAlive();
      }, 55e3));
    }
    setTimeout(e3, t3) {
      this._debug("setTimeout ms=%d unref=%s", e3, t3), this._timeoutMs = e3, this._timeoutUnref = !!t3, this._resetTimeout(true);
    }
    destroy() {
      if (!this.destroyed) return this._debug("destroy"), this.end(), this;
    }
    end(e3) {
      if (!this.destroyed && !this.destroying) return this._debug("end"), this._onUninterested(), this._onChoke(), super.end(e3);
    }
    use(e3) {
      const t3 = e3.prototype.name;
      if (!t3) throw new Error('Extension class requires a "name" property on the prototype');
      this._debug("use extension.name=%s", t3);
      const i3 = this._nextExt, s3 = new e3(this);
      function n3() {
      }
      "function" != typeof s3.onHandshake && (s3.onHandshake = n3), "function" != typeof s3.onExtendedHandshake && (s3.onExtendedHandshake = n3), "function" != typeof s3.onMessage && (s3.onMessage = n3), this.extendedMapping[i3] = t3, this._ext[t3] = s3, this[t3] = s3, this._nextExt += 1;
    }
    keepAlive() {
      this._debug("keep-alive"), this._push(f2);
    }
    sendPe1() {
      if (this._peEnabled) {
        const e3 = Math.floor(513 * Math.random()), t3 = (0, l2.po)(e3);
        this._push((0, l2.xW)([(0, l2.fk)(this._myPubKey), t3]));
      }
    }
    sendPe2() {
      const e3 = Math.floor(513 * Math.random()), t3 = (0, l2.po)(e3);
      this._push((0, l2.xW)([(0, l2.fk)(this._myPubKey), t3]));
    }
    async sendPe3(e3) {
      await this.setEncrypt(this._sharedSecret, e3);
      const t3 = await (0, l2.tW)((0, l2.fk)(this._utfToHex("req1") + this._sharedSecret)), i3 = C2(await (0, l2.tW)((0, l2.fk)(this._utfToHex("req2") + e3)), await (0, l2.tW)((0, l2.fk)(this._utfToHex("req3") + this._sharedSecret))), s3 = new DataView((0, l2.po)(2).buffer).getUint16(0) % 512, n3 = (0, l2.po)(s3);
      let r3 = new Uint8Array(14 + s3 + 2);
      r3.set(x2), r3.set(S2, 8);
      const o3 = new DataView(r3.buffer);
      o3.setInt16(12, s3), n3.copy(r3, 14), o3.setInt16(14 + s3, 0), r3 = this._encryptHandshake(r3), this._push((0, l2.xW)([t3, i3, r3]));
    }
    async sendPe4(e3) {
      await this.setEncrypt(this._sharedSecret, e3);
      const t3 = new DataView((0, l2.po)(2).buffer).getUint16(0) % 512, i3 = (0, l2.po)(t3);
      let s3 = new Uint8Array(14 + t3);
      const n3 = new DataView(s3.buffer);
      s3.set(x2), s3.set(E2, 8), n3.setInt16(12, t3), s3.set(i3, 14), s3 = this._encryptHandshake(s3), this._push(s3), this._cryptoHandshakeDone = true, this._debug("completed crypto handshake");
    }
    handshake(e3, t3, i3) {
      let s3, n3;
      if ("string" == typeof e3 ? (e3 = e3.toLowerCase(), s3 = (0, l2.fk)(e3)) : (s3 = e3, e3 = (0, l2.V5)(s3)), "string" == typeof t3 ? n3 = (0, l2.fk)(t3) : (n3 = t3, t3 = (0, l2.V5)(n3)), this._infoHash = s3, 20 !== s3.length || 20 !== n3.length) throw new Error("infoHash and peerId MUST have length 20");
      this._debug("handshake i=%s p=%s exts=%o", e3, t3, i3);
      const r3 = new Uint8Array(w2);
      this.extensions = { extended: true, dht: !(!i3 || !i3.dht), fast: !(!i3 || !i3.fast) }, r3[5] |= 16, this.extensions.dht && (r3[7] |= 1), this.extensions.fast && (r3[7] |= 4), this.extensions.fast && this.peerExtensions.fast && (this._debug("fast extension is enabled"), this.hasFast = true), this._push((0, l2.xW)([p2, r3, s3, n3])), this._handshakeSent = true, this.peerExtensions.extended && !this._extendedHandshakeSent && this._sendExtendedHandshake();
    }
    _sendExtendedHandshake() {
      const e3 = Object.assign({}, this.extendedHandshake);
      e3.m = {};
      for (const t3 in this.extendedMapping) {
        const i3 = this.extendedMapping[t3];
        e3.m[i3] = Number(t3);
      }
      this.extended(0, s2.A.encode(e3)), this._extendedHandshakeSent = true;
    }
    choke() {
      if (!this.amChoking) if (this.amChoking = true, this._debug("choke"), this._push(m2), this.hasFast) {
        let e3 = 0;
        for (; this.peerRequests.length > e3; ) {
          const t3 = this.peerRequests[e3];
          this.allowedFastSet.includes(t3.piece) ? ++e3 : this.reject(t3.piece, t3.offset, t3.length);
        }
      } else for (; this.peerRequests.length; ) this.peerRequests.pop();
    }
    unchoke() {
      this.amChoking && (this.amChoking = false, this._debug("unchoke"), this._push(_2));
    }
    interested() {
      this.amInterested || (this.amInterested = true, this._debug("interested"), this._push(g2));
    }
    uninterested() {
      this.amInterested && (this.amInterested = false, this._debug("uninterested"), this._push(y2));
    }
    have(e3) {
      this._debug("have %d", e3), this._message(4, [e3], null);
    }
    bitfield(e3) {
      this._debug("bitfield"), ArrayBuffer.isView(e3) || (e3 = e3.buffer), this._message(5, [], e3);
    }
    request(e3, t3, i3, s3) {
      return s3 || (s3 = () => {
      }), this._finished ? s3(new Error("wire is closed")) : !this.peerChoking || this.hasFast && this.peerAllowedFastSet.includes(e3) ? (this._debug("request index=%d offset=%d length=%d", e3, t3, i3), this.requests.push(new T2(e3, t3, i3, s3)), this._timeout || this._resetTimeout(true), void this._message(6, [e3, t3, i3], null)) : s3(new Error("peer is choking"));
    }
    piece(e3, t3, i3) {
      this._debug("piece index=%d offset=%d", e3, t3), this._message(7, [e3, t3], i3), this.uploaded += i3.length, this.uploadSpeed(i3.length), this.emit("upload", i3.length);
    }
    cancel(e3, t3, i3) {
      this._debug("cancel index=%d offset=%d length=%d", e3, t3, i3), this._callback(this._pull(this.requests, e3, t3, i3), new Error("request was cancelled"), null), this._message(8, [e3, t3, i3], null);
    }
    port(e3) {
      this._debug("port %d", e3);
      const t3 = new Uint8Array(b2);
      new DataView(t3.buffer).setUint16(5, e3), this._push(t3);
    }
    suggest(e3) {
      if (!this.hasFast) throw Error("fast extension is disabled");
      this._debug("suggest %d", e3), this._message(13, [e3], null);
    }
    haveAll() {
      if (!this.hasFast) throw Error("fast extension is disabled");
      this._debug("have-all"), this._push(v2);
    }
    haveNone() {
      if (!this.hasFast) throw Error("fast extension is disabled");
      this._debug("have-none"), this._push(k2);
    }
    reject(e3, t3, i3) {
      if (!this.hasFast) throw Error("fast extension is disabled");
      this._debug("reject index=%d offset=%d length=%d", e3, t3, i3), this._pull(this.peerRequests, e3, t3, i3), this._message(16, [e3, t3, i3], null);
    }
    allowedFast(e3) {
      if (!this.hasFast) throw Error("fast extension is disabled");
      this._debug("allowed-fast %d", e3), this.allowedFastSet.includes(e3) || this.allowedFastSet.push(e3), this._message(17, [e3], null);
    }
    extended(e3, t3) {
      if (this._debug("extended ext=%s", e3), "string" == typeof e3 && this.peerExtendedMapping[e3] && (e3 = this.peerExtendedMapping[e3]), "number" != typeof e3) throw new Error(`Unrecognized extension: ${e3}`);
      {
        const i3 = new Uint8Array([e3]), n3 = ArrayBuffer.isView(t3) ? t3 : s2.A.encode(t3);
        this._message(20, [], (0, l2.xW)([i3, n3]));
      }
    }
    async setEncrypt(e3, t3) {
      if (!this.type.startsWith("tcp")) return false;
      const i3 = "tcpOutgoing" === this.type, s3 = new a2([...await (0, l2.tW)((0, l2.fk)(this._utfToHex("keyA") + e3 + t3))]), n3 = new a2([...await (0, l2.tW)((0, l2.fk)(this._utfToHex("keyB") + e3 + t3))]);
      this._encryptGenerator = i3 ? s3 : n3, this._decryptGenerator = i3 ? n3 : s3;
      for (let e4 = 0; e4 < 1024; e4++) this._encryptGenerator.randomByte(), this._decryptGenerator.randomByte();
      return this._setGenerators = true, this.emit("_generators"), true;
    }
    _message(e3, t3, i3) {
      const s3 = i3 ? i3.length : 0, n3 = new Uint8Array(5 + 4 * t3.length);
      A2(n3, 0, n3.length + s3 - 4), n3[4] = e3;
      for (let e4 = 0; e4 < t3.length; e4++) A2(n3, 5 + 4 * e4, t3[e4]);
      this._push(n3), i3 && this._push(i3);
    }
    _push(e3) {
      if (!this._finished) return 2 === this._encryptionMethod && this._cryptoHandshakeDone && (e3 = this._encrypt(e3)), this.push(e3);
    }
    _onKeepAlive() {
      this._debug("got keep-alive"), this.emit("keep-alive");
    }
    _onPe1(e3) {
      this._peerPubKey = (0, l2.V5)(e3), this._sharedSecret = this._dh.computeSecret(this._peerPubKey, "hex", "hex"), this.emit("pe1");
    }
    _onPe2(e3) {
      this._peerPubKey = (0, l2.V5)(e3), this._sharedSecret = this._dh.computeSecret(this._peerPubKey, "hex", "hex"), this.emit("pe2");
    }
    async _onPe3(e3) {
      const t3 = await (0, l2.tW)((0, l2.fk)(this._utfToHex("req3") + this._sharedSecret)), i3 = (0, l2.V5)(C2(t3, e3));
      this.emit("pe3", i3);
    }
    _onPe3Encrypted(e3, t3) {
      if (!(0, l2.LC)(e3, x2)) return this._debug("Error: verification constant did not match"), void this.destroy();
      for (const e4 of t3.values()) 0 !== e4 && this._peerCryptoProvide.push(e4);
      this._peerCryptoProvide.includes(2) ? this._encryptionMethod = 2 : (this._debug("Error: RC4 encryption method not provided by peer"), this.destroy());
    }
    _onPe4(e3) {
      this._encryptionMethod = e3[3], S2.includes(this._encryptionMethod) || (this._debug("Error: peer selected invalid crypto method"), this.destroy()), this._cryptoHandshakeDone = true, this._debug("crypto handshake done"), this.emit("pe4");
    }
    _onHandshake(e3, t3, i3) {
      const s3 = (0, l2.V5)(e3), n3 = (0, l2.V5)(t3);
      this._debug("got handshake i=%s p=%s exts=%o", s3, n3, i3), this.peerId = n3, this.peerIdBuffer = t3, this.peerExtensions = i3, this.extensions.fast && this.peerExtensions.fast && (this._debug("fast extension is enabled"), this.hasFast = true), this.emit("handshake", s3, n3, i3);
      for (const e4 in this._ext) this._ext[e4].onHandshake(s3, n3, i3);
      i3.extended && this._handshakeSent && !this._extendedHandshakeSent && this._sendExtendedHandshake();
    }
    _onChoke() {
      if (this.peerChoking = true, this._debug("got choke"), this.emit("choke"), !this.hasFast) for (; this.requests.length; ) this._callback(this.requests.pop(), new Error("peer is choking"), null);
    }
    _onUnchoke() {
      this.peerChoking = false, this._debug("got unchoke"), this.emit("unchoke");
    }
    _onInterested() {
      this.peerInterested = true, this._debug("got interested"), this.emit("interested");
    }
    _onUninterested() {
      this.peerInterested = false, this._debug("got uninterested"), this.emit("uninterested");
    }
    _onHave(e3) {
      this.peerPieces.get(e3) || (this._debug("got have %d", e3), this.peerPieces.set(e3, true), this.emit("have", e3));
    }
    _onBitField(e3) {
      this.peerPieces = new n2.A(e3), this._debug("got bitfield"), this.emit("bitfield", this.peerPieces);
    }
    _onRequest(e3, t3, i3) {
      if (this.amChoking && (!this.hasFast || !this.allowedFastSet.includes(e3))) return void (this.hasFast && this.reject(e3, t3, i3));
      this._debug("got request index=%d offset=%d length=%d", e3, t3, i3);
      const s3 = (s4, r3) => {
        if (n3 === this._pull(this.peerRequests, e3, t3, i3)) return s4 ? (this._debug("error satisfying request index=%d offset=%d length=%d (%s)", e3, t3, i3, s4.message), void (this.hasFast && this.reject(e3, t3, i3))) : void this.piece(e3, t3, r3);
      }, n3 = new T2(e3, t3, i3, s3);
      this.peerRequests.push(n3), this.emit("request", e3, t3, i3, s3);
    }
    _onPiece(e3, t3, i3) {
      this._debug("got piece index=%d offset=%d", e3, t3), this._callback(this._pull(this.requests, e3, t3, i3.length), null, i3), this.downloaded += i3.length, this.downloadSpeed(i3.length), this.emit("download", i3.length), this.emit("piece", e3, t3, i3);
    }
    _onCancel(e3, t3, i3) {
      this._debug("got cancel index=%d offset=%d length=%d", e3, t3, i3), this._pull(this.peerRequests, e3, t3, i3), this.emit("cancel", e3, t3, i3);
    }
    _onPort(e3) {
      this._debug("got port %d", e3), this.emit("port", e3);
    }
    _onSuggest(e3) {
      if (!this.hasFast) return this._debug("Error: got suggest whereas fast extension is disabled"), void this.destroy();
      this._debug("got suggest %d", e3), this.emit("suggest", e3);
    }
    _onHaveAll() {
      if (!this.hasFast) return this._debug("Error: got have-all whereas fast extension is disabled"), void this.destroy();
      this._debug("got have-all"), this.peerPieces = new I2(), this.emit("have-all");
    }
    _onHaveNone() {
      if (!this.hasFast) return this._debug("Error: got have-none whereas fast extension is disabled"), void this.destroy();
      this._debug("got have-none"), this.emit("have-none");
    }
    _onReject(e3, t3, i3) {
      if (!this.hasFast) return this._debug("Error: got reject whereas fast extension is disabled"), void this.destroy();
      this._debug("got reject index=%d offset=%d length=%d", e3, t3, i3), this._callback(this._pull(this.requests, e3, t3, i3), new Error("request was rejected"), null), this.emit("reject", e3, t3, i3);
    }
    _onAllowedFast(e3) {
      if (!this.hasFast) return this._debug("Error: got allowed-fast whereas fast extension is disabled"), void this.destroy();
      this._debug("got allowed-fast %d", e3), this.peerAllowedFastSet.includes(e3) || this.peerAllowedFastSet.push(e3), this.peerAllowedFastSet.length > 100 && this.peerAllowedFastSet.shift(), this.emit("allowed-fast", e3);
    }
    _onExtended(e3, t3) {
      if (0 === e3) {
        let e4;
        try {
          e4 = s2.A.decode(t3);
        } catch (e5) {
          this._debug("ignoring invalid extended handshake: %s", e5.message || e5);
        }
        if (!e4) return;
        if (this.peerExtendedHandshake = e4, "object" == typeof e4.m) for (const t4 in e4.m) this.peerExtendedMapping[t4] = Number(e4.m[t4].toString());
        for (const e5 in this._ext) this.peerExtendedMapping[e5] && this._ext[e5].onExtendedHandshake(this.peerExtendedHandshake);
        this._debug("got extended handshake"), this.emit("extended", "handshake", this.peerExtendedHandshake);
      } else this.extendedMapping[e3] && (e3 = this.extendedMapping[e3], this._ext[e3] && this._ext[e3].onMessage(t3)), this._debug("got extended message ext=%s", e3), this.emit("extended", e3, t3);
    }
    _onTimeout() {
      this._debug("request timed out"), this._callback(this.requests.shift(), new Error("request has timed out"), null), this.emit("timeout");
    }
    _write(e3, t3) {
      if (2 === this._encryptionMethod && this._cryptoHandshakeDone && (e3 = this._decrypt(e3)), this._bufferSize += e3.length, this._buffer.push(e3), this._buffer.length > 1 && (this._buffer = [(0, l2.xW)(this._buffer, this._bufferSize)]), this._cryptoSyncPattern) {
        const t4 = this._buffer[0].indexOf(this._cryptoSyncPattern);
        if (-1 !== t4) this._buffer[0] = this._buffer[0].slice(t4 + this._cryptoSyncPattern.length), this._bufferSize -= t4 + this._cryptoSyncPattern.length, this._cryptoSyncPattern = null;
        else if (this._bufferSize + e3.length > this._waitMaxBytes + this._cryptoSyncPattern.length) return this._debug("Error: could not resynchronize"), void this.destroy();
      }
      for (; this._bufferSize >= this._parserSize && !this._cryptoSyncPattern; ) if (0 === this._parserSize) this._parser(new Uint8Array());
      else {
        const e4 = this._buffer[0];
        this._bufferSize -= this._parserSize, this._buffer = this._bufferSize ? [e4.subarray(this._parserSize)] : [], this._parser(e4.subarray(0, this._parserSize));
      }
      t3(null);
    }
    _callback(e3, t3, i3) {
      e3 && (this._resetTimeout(!this.peerChoking && !this._finished), e3.callback(t3, i3));
    }
    _resetTimeout(e3) {
      if (!e3 || !this._timeoutMs || !this.requests.length) return clearTimeout(this._timeout), this._timeout = null, void (this._timeoutExpiresAt = null);
      const t3 = Date.now() + this._timeoutMs;
      if (this._timeout) {
        if (t3 - this._timeoutExpiresAt < 0.05 * this._timeoutMs) return;
        clearTimeout(this._timeout);
      }
      this._timeoutExpiresAt = t3, this._timeout = setTimeout(() => this._onTimeout(), this._timeoutMs), this._timeoutUnref && this._timeout.unref && this._timeout.unref();
    }
    _parse(e3, t3) {
      this._parserSize = e3, this._parser = t3;
    }
    _parseUntil(e3, t3) {
      this._cryptoSyncPattern = e3, this._waitMaxBytes = t3;
    }
    _onMessageLength(e3) {
      const t3 = P2(e3);
      t3 > 0 ? this._parse(t3, this._onMessage) : (this._onKeepAlive(), this._parse(4, this._onMessageLength));
    }
    _onMessage(e3) {
      switch (this._parse(4, this._onMessageLength), e3[0]) {
        case 0:
          return this._onChoke();
        case 1:
          return this._onUnchoke();
        case 2:
          return this._onInterested();
        case 3:
          return this._onUninterested();
        case 4:
          return this._onHave(P2(e3, 1));
        case 5:
          return this._onBitField(e3.subarray(1));
        case 6:
          return this._onRequest(P2(e3, 1), P2(e3, 5), P2(e3, 9));
        case 7:
          return this._onPiece(P2(e3, 1), P2(e3, 5), e3.subarray(9));
        case 8:
          return this._onCancel(P2(e3, 1), P2(e3, 5), P2(e3, 9));
        case 9:
          return this._onPort(e3[1] << 8 | e3[2]);
        case 13:
          return this._onSuggest(P2(e3, 1));
        case 14:
          return this._onHaveAll();
        case 15:
          return this._onHaveNone();
        case 16:
          return this._onReject(P2(e3, 1), P2(e3, 5), P2(e3, 9));
        case 17:
          return this._onAllowedFast(P2(e3, 1));
        case 20:
          return this._onExtended(e3[1], e3.subarray(2));
        default:
          return this._debug("got unknown message"), this.emit("unknownmessage", e3);
      }
    }
    _determineHandshakeType() {
      this._parse(1, (e3) => {
        const t3 = e3[0];
        19 === t3 ? this._parse(t3 + 48, this._onHandshakeBuffer) : this._parsePe1(e3);
      });
    }
    _parsePe1(e3) {
      this._parse(95, (t3) => {
        this._onPe1((0, l2.xW)([e3, t3])), this._parsePe3();
      });
    }
    _parsePe2() {
      this._parse(96, async (e3) => {
        this._onPe2(e3), this._setGenerators || await new Promise((e4) => this.once("_generators", e4)), this._parsePe4();
      });
    }
    async _parsePe3() {
      const e3 = await (0, l2.tW)((0, l2.fk)(this._utfToHex("req1") + this._sharedSecret));
      this._parseUntil(e3, 512), this._parse(20, async (e4) => {
        this._onPe3(e4), this._setGenerators || await new Promise((e5) => this.once("_generators", e5)), this._parsePe3Encrypted();
      });
    }
    _parsePe3Encrypted() {
      this._parse(14, (e3) => {
        const t3 = this._decryptHandshake(e3.slice(0, 8)), i3 = this._decryptHandshake(e3.slice(8, 12)), s3 = new DataView(this._decryptHandshake(e3.slice(12, 14)).buffer).getUint16(0);
        this._parse(s3, (e4) => {
          e4 = this._decryptHandshake(e4), this._parse(2, (s4) => {
            const n3 = new DataView(this._decryptHandshake(s4).buffer).getUint16(0);
            this._parse(n3, (s5) => {
              s5 = this._decryptHandshake(s5), this._onPe3Encrypted(t3, i3, e4, s5);
              const r3 = n3 ? s5[0] : null, o3 = n3 ? s5.slice(1, 20) : null;
              19 === r3 && "BitTorrent protocol" === (0, l2.dU)(o3) ? this._onHandshakeBuffer(s5.slice(1)) : this._parseHandshake();
            });
          });
        });
      });
    }
    _parsePe4() {
      const e3 = this._decryptHandshake(x2);
      this._parseUntil(e3, 512), this._parse(6, (e4) => {
        const t3 = this._decryptHandshake(e4.slice(0, 4)), i3 = new DataView(this._decryptHandshake(e4.slice(4, 6)).buffer).getUint16(0);
        this._parse(i3, (e5) => {
          this._decryptHandshake(e5), this._onPe4(t3), this._parseHandshake(null);
        });
      });
    }
    _parseHandshake() {
      this._parse(1, (e3) => {
        const t3 = e3[0];
        if (19 !== t3) return this._debug("Error: wire not speaking BitTorrent protocol (%s)", t3.toString()), void this.end();
        this._parse(t3 + 48, this._onHandshakeBuffer);
      });
    }
    _onHandshakeBuffer(e3) {
      const t3 = e3.slice(0, 19);
      if ("BitTorrent protocol" !== (0, l2.dU)(t3)) return this._debug("Error: wire not speaking BitTorrent protocol (%s)", (0, l2.dU)(t3)), void this.end();
      e3 = e3.slice(19), this._onHandshake(e3.slice(8, 28), e3.slice(28, 48), { dht: !!(1 & e3[7]), fast: !!(4 & e3[7]), extended: !!(16 & e3[5]) }), this._parse(4, this._onMessageLength);
    }
    _onFinish() {
      for (this._finished = true, this.push(null); this.read(); ) ;
      for (clearInterval(this._keepAliveInterval), this._parse(Number.MAX_VALUE, () => {
      }); this.peerRequests.length; ) this.peerRequests.pop();
      for (; this.requests.length; ) this._callback(this.requests.pop(), new Error("wire was closed"), null);
    }
    _debug(...e3) {
      e3[0] = `[${this._debugId}] ${e3[0]}`, u2(...e3);
    }
    _pull(e3, t3, i3, s3) {
      for (let n3 = 0; n3 < e3.length; n3++) {
        const r3 = e3[n3];
        if (r3.piece === t3 && r3.offset === i3 && r3.length === s3) return d2(e3, n3), r3;
      }
      return null;
    }
    _encryptHandshake(e3) {
      const t3 = new Uint8Array(e3);
      if (!this._encryptGenerator) return this._debug("Warning: Encrypting without any generator"), t3;
      for (let i3 = 0; i3 < e3.length; i3++) {
        const e4 = this._encryptGenerator.randomByte();
        t3[i3] = t3[i3] ^ e4;
      }
      return t3;
    }
    _encrypt(e3) {
      const t3 = new Uint8Array(e3);
      if (!this._encryptGenerator || 2 !== this._encryptionMethod) return t3;
      for (let i3 = 0; i3 < e3.length; i3++) {
        const e4 = this._encryptGenerator.randomByte();
        t3[i3] = t3[i3] ^ e4;
      }
      return t3;
    }
    _decryptHandshake(e3) {
      const t3 = new Uint8Array(e3);
      if (!this._decryptGenerator) return this._debug("Warning: Decrypting without any generator"), t3;
      for (let i3 = 0; i3 < e3.length; i3++) {
        const e4 = this._decryptGenerator.randomByte();
        t3[i3] = t3[i3] ^ e4;
      }
      return t3;
    }
    _decrypt(e3) {
      const t3 = new Uint8Array(e3);
      if (!this._decryptGenerator || 2 !== this._encryptionMethod) return t3;
      for (let i3 = 0; i3 < e3.length; i3++) {
        const e4 = this._decryptGenerator.randomByte();
        t3[i3] = t3[i3] ^ e4;
      }
      return t3;
    }
    _utfToHex(e3) {
      return (0, l2.V5)((0, l2.L0)(e3));
    }
  }
  const O2 = L2;
}, 6585: (e2) => {
  var t2 = 1e3, i2 = 60 * t2, s2 = 60 * i2, n2 = 24 * s2, r2 = 7 * n2, o2 = 365.25 * n2;
  function a2(e3, t3, i3, s3) {
    var n3 = t3 >= 1.5 * i3;
    return Math.round(e3 / i3) + " " + s3 + (n3 ? "s" : "");
  }
  e2.exports = function(e3, h2) {
    h2 = h2 || {};
    var l2 = typeof e3;
    if ("string" === l2 && e3.length > 0) return (function(e4) {
      if ((e4 = String(e4)).length > 100) return;
      var a3 = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(e4);
      if (!a3) return;
      var h3 = parseFloat(a3[1]);
      switch ((a3[2] || "ms").toLowerCase()) {
        case "years":
        case "year":
        case "yrs":
        case "yr":
        case "y":
          return h3 * o2;
        case "weeks":
        case "week":
        case "w":
          return h3 * r2;
        case "days":
        case "day":
        case "d":
          return h3 * n2;
        case "hours":
        case "hour":
        case "hrs":
        case "hr":
        case "h":
          return h3 * s2;
        case "minutes":
        case "minute":
        case "mins":
        case "min":
        case "m":
          return h3 * i2;
        case "seconds":
        case "second":
        case "secs":
        case "sec":
        case "s":
          return h3 * t2;
        case "milliseconds":
        case "millisecond":
        case "msecs":
        case "msec":
        case "ms":
          return h3;
        default:
          return;
      }
    })(e3);
    if ("number" === l2 && isFinite(e3)) return h2.long ? (function(e4) {
      var r3 = Math.abs(e4);
      if (r3 >= n2) return a2(e4, r3, n2, "day");
      if (r3 >= s2) return a2(e4, r3, s2, "hour");
      if (r3 >= i2) return a2(e4, r3, i2, "minute");
      if (r3 >= t2) return a2(e4, r3, t2, "second");
      return e4 + " ms";
    })(e3) : (function(e4) {
      var r3 = Math.abs(e4);
      if (r3 >= n2) return Math.round(e4 / n2) + "d";
      if (r3 >= s2) return Math.round(e4 / s2) + "h";
      if (r3 >= i2) return Math.round(e4 / i2) + "m";
      if (r3 >= t2) return Math.round(e4 / t2) + "s";
      return e4 + "ms";
    })(e3);
    throw new Error("val is not a non-empty string or a valid number. val=" + JSON.stringify(e3));
  };
}, 6587: (e2) => {
  e2.exports = function e3(t2, i2) {
    if (t2 && i2) return e3(t2)(i2);
    if ("function" != typeof t2) throw new TypeError("need wrapper function");
    return Object.keys(t2).forEach(function(e4) {
      s2[e4] = t2[e4];
    }), s2;
    function s2() {
      for (var e4 = new Array(arguments.length), i3 = 0; i3 < e4.length; i3++) e4[i3] = arguments[i3];
      var s3 = t2.apply(this, e4), n2 = e4[e4.length - 1];
      return "function" == typeof s3 && s3 !== n2 && Object.keys(n2).forEach(function(e5) {
        s3[e5] = n2[e5];
      }), s3;
    }
  };
}, 6611: (e2, t2, i2) => {
  var s2 = i2(717), n2 = i2(3519), r2 = function() {
  }, o2 = globalThis.Bare ? queueMicrotask : s2.nextTick.bind(s2), a2 = function(e3, t3, i3) {
    if ("function" == typeof t3) return a2(e3, null, t3);
    t3 || (t3 = {}), i3 = n2(i3 || r2);
    var s3 = e3._writableState, h2 = e3._readableState, l2 = t3.readable || false !== t3.readable && e3.readable, c2 = t3.writable || false !== t3.writable && e3.writable, d2 = false, u2 = function() {
      e3.writable || p2();
    }, p2 = function() {
      c2 = false, l2 || i3.call(e3);
    }, f2 = function() {
      l2 = false, c2 || i3.call(e3);
    }, m2 = function(t4) {
      i3.call(e3, t4 ? new Error("exited with error code: " + t4) : null);
    }, _2 = function(t4) {
      i3.call(e3, t4);
    }, g2 = function() {
      o2(y2);
    }, y2 = function() {
      if (!d2) return (!l2 || h2 && h2.ended && !h2.destroyed) && (!c2 || s3 && s3.ended && !s3.destroyed) ? void 0 : i3.call(e3, new Error("premature close"));
    }, w2 = function() {
      e3.req.on("finish", p2);
    };
    return !(function(e4) {
      return e4.setHeader && "function" == typeof e4.abort;
    })(e3) ? c2 && !s3 && (e3.on("end", u2), e3.on("close", u2)) : (e3.on("complete", p2), e3.on("abort", g2), e3.req ? w2() : e3.on("request", w2)), (function(e4) {
      return e4.stdio && Array.isArray(e4.stdio) && 3 === e4.stdio.length;
    })(e3) && e3.on("exit", m2), e3.on("end", f2), e3.on("finish", p2), false !== t3.error && e3.on("error", _2), e3.on("close", g2), function() {
      d2 = true, e3.removeListener("complete", p2), e3.removeListener("abort", g2), e3.removeListener("request", w2), e3.req && e3.req.removeListener("finish", p2), e3.removeListener("end", u2), e3.removeListener("close", u2), e3.removeListener("finish", p2), e3.removeListener("exit", m2), e3.removeListener("end", f2), e3.removeListener("error", _2), e3.removeListener("close", g2);
    };
  };
  e2.exports = a2;
}, 6664: () => {
}, 6686: () => {
}, 6698: (e2) => {
  "function" == typeof Object.create ? e2.exports = function(e3, t2) {
    t2 && (e3.super_ = t2, e3.prototype = Object.create(t2.prototype, { constructor: { value: e3, enumerable: false, writable: true, configurable: true } }));
  } : e2.exports = function(e3, t2) {
    if (t2) {
      e3.super_ = t2;
      var i2 = function() {
      };
      i2.prototype = t2.prototype, e3.prototype = new i2(), e3.prototype.constructor = e3;
    }
  };
}, 6819: (e2, t2, i2) => {
  e2.exports = i2(8330).version;
}, 6889: () => {
}, 7007: (e2) => {
  var t2 = Object.create || function(e3) {
    var t3 = function() {
    };
    return t3.prototype = e3, new t3();
  }, i2 = Object.keys || function(e3) {
    var t3 = [];
    for (var i3 in e3) Object.prototype.hasOwnProperty.call(e3, i3) && t3.push(i3);
    return i3;
  }, s2 = Function.prototype.bind || function(e3) {
    var t3 = this;
    return function() {
      return t3.apply(e3, arguments);
    };
  };
  function n2() {
    this._events && Object.prototype.hasOwnProperty.call(this, "_events") || (this._events = t2(null), this._eventsCount = 0), this._maxListeners = this._maxListeners || void 0;
  }
  e2.exports = n2, n2.EventEmitter = n2, n2.prototype._events = void 0, n2.prototype._maxListeners = void 0;
  var r2, o2 = 10;
  try {
    var a2 = {};
    Object.defineProperty && Object.defineProperty(a2, "x", { value: 0 }), r2 = 0 === a2.x;
  } catch (e3) {
    r2 = false;
  }
  function h2(e3) {
    return void 0 === e3._maxListeners ? n2.defaultMaxListeners : e3._maxListeners;
  }
  function l2(e3, i3, s3, n3) {
    var r3, o3, a3;
    if ("function" != typeof s3) throw new TypeError('"listener" argument must be a function');
    if ((o3 = e3._events) ? (o3.newListener && (e3.emit("newListener", i3, s3.listener ? s3.listener : s3), o3 = e3._events), a3 = o3[i3]) : (o3 = e3._events = t2(null), e3._eventsCount = 0), a3) {
      if ("function" == typeof a3 ? a3 = o3[i3] = n3 ? [s3, a3] : [a3, s3] : n3 ? a3.unshift(s3) : a3.push(s3), !a3.warned && (r3 = h2(e3)) && r3 > 0 && a3.length > r3) {
        a3.warned = true;
        var l3 = new Error("Possible EventEmitter memory leak detected. " + a3.length + ' "' + String(i3) + '" listeners added. Use emitter.setMaxListeners() to increase limit.');
        l3.name = "MaxListenersExceededWarning", l3.emitter = e3, l3.type = i3, l3.count = a3.length, "object" == typeof console && console.warn && console.warn("%s: %s", l3.name, l3.message);
      }
    } else a3 = o3[i3] = s3, ++e3._eventsCount;
    return e3;
  }
  function c2() {
    if (!this.fired) switch (this.target.removeListener(this.type, this.wrapFn), this.fired = true, arguments.length) {
      case 0:
        return this.listener.call(this.target);
      case 1:
        return this.listener.call(this.target, arguments[0]);
      case 2:
        return this.listener.call(this.target, arguments[0], arguments[1]);
      case 3:
        return this.listener.call(this.target, arguments[0], arguments[1], arguments[2]);
      default:
        for (var e3 = new Array(arguments.length), t3 = 0; t3 < e3.length; ++t3) e3[t3] = arguments[t3];
        this.listener.apply(this.target, e3);
    }
  }
  function d2(e3, t3, i3) {
    var n3 = { fired: false, wrapFn: void 0, target: e3, type: t3, listener: i3 }, r3 = s2.call(c2, n3);
    return r3.listener = i3, n3.wrapFn = r3, r3;
  }
  function u2(e3, t3, i3) {
    var s3 = e3._events;
    if (!s3) return [];
    var n3 = s3[t3];
    return n3 ? "function" == typeof n3 ? i3 ? [n3.listener || n3] : [n3] : i3 ? (function(e4) {
      for (var t4 = new Array(e4.length), i4 = 0; i4 < t4.length; ++i4) t4[i4] = e4[i4].listener || e4[i4];
      return t4;
    })(n3) : f2(n3, n3.length) : [];
  }
  function p2(e3) {
    var t3 = this._events;
    if (t3) {
      var i3 = t3[e3];
      if ("function" == typeof i3) return 1;
      if (i3) return i3.length;
    }
    return 0;
  }
  function f2(e3, t3) {
    for (var i3 = new Array(t3), s3 = 0; s3 < t3; ++s3) i3[s3] = e3[s3];
    return i3;
  }
  r2 ? Object.defineProperty(n2, "defaultMaxListeners", { enumerable: true, get: function() {
    return o2;
  }, set: function(e3) {
    if ("number" != typeof e3 || e3 < 0 || e3 != e3) throw new TypeError('"defaultMaxListeners" must be a positive number');
    o2 = e3;
  } }) : n2.defaultMaxListeners = o2, n2.prototype.setMaxListeners = function(e3) {
    if ("number" != typeof e3 || e3 < 0 || isNaN(e3)) throw new TypeError('"n" argument must be a positive number');
    return this._maxListeners = e3, this;
  }, n2.prototype.getMaxListeners = function() {
    return h2(this);
  }, n2.prototype.emit = function(e3) {
    var t3, i3, s3, n3, r3, o3, a3 = "error" === e3;
    if (o3 = this._events) a3 = a3 && null == o3.error;
    else if (!a3) return false;
    if (a3) {
      if (arguments.length > 1 && (t3 = arguments[1]), t3 instanceof Error) throw t3;
      var h3 = new Error('Unhandled "error" event. (' + t3 + ")");
      throw h3.context = t3, h3;
    }
    if (!(i3 = o3[e3])) return false;
    var l3 = "function" == typeof i3;
    switch (s3 = arguments.length) {
      case 1:
        !(function(e4, t4, i4) {
          if (t4) e4.call(i4);
          else for (var s4 = e4.length, n4 = f2(e4, s4), r4 = 0; r4 < s4; ++r4) n4[r4].call(i4);
        })(i3, l3, this);
        break;
      case 2:
        !(function(e4, t4, i4, s4) {
          if (t4) e4.call(i4, s4);
          else for (var n4 = e4.length, r4 = f2(e4, n4), o4 = 0; o4 < n4; ++o4) r4[o4].call(i4, s4);
        })(i3, l3, this, arguments[1]);
        break;
      case 3:
        !(function(e4, t4, i4, s4, n4) {
          if (t4) e4.call(i4, s4, n4);
          else for (var r4 = e4.length, o4 = f2(e4, r4), a4 = 0; a4 < r4; ++a4) o4[a4].call(i4, s4, n4);
        })(i3, l3, this, arguments[1], arguments[2]);
        break;
      case 4:
        !(function(e4, t4, i4, s4, n4, r4) {
          if (t4) e4.call(i4, s4, n4, r4);
          else for (var o4 = e4.length, a4 = f2(e4, o4), h4 = 0; h4 < o4; ++h4) a4[h4].call(i4, s4, n4, r4);
        })(i3, l3, this, arguments[1], arguments[2], arguments[3]);
        break;
      default:
        for (n3 = new Array(s3 - 1), r3 = 1; r3 < s3; r3++) n3[r3 - 1] = arguments[r3];
        !(function(e4, t4, i4, s4) {
          if (t4) e4.apply(i4, s4);
          else for (var n4 = e4.length, r4 = f2(e4, n4), o4 = 0; o4 < n4; ++o4) r4[o4].apply(i4, s4);
        })(i3, l3, this, n3);
    }
    return true;
  }, n2.prototype.addListener = function(e3, t3) {
    return l2(this, e3, t3, false);
  }, n2.prototype.on = n2.prototype.addListener, n2.prototype.prependListener = function(e3, t3) {
    return l2(this, e3, t3, true);
  }, n2.prototype.once = function(e3, t3) {
    if ("function" != typeof t3) throw new TypeError('"listener" argument must be a function');
    return this.on(e3, d2(this, e3, t3)), this;
  }, n2.prototype.prependOnceListener = function(e3, t3) {
    if ("function" != typeof t3) throw new TypeError('"listener" argument must be a function');
    return this.prependListener(e3, d2(this, e3, t3)), this;
  }, n2.prototype.removeListener = function(e3, i3) {
    var s3, n3, r3, o3, a3;
    if ("function" != typeof i3) throw new TypeError('"listener" argument must be a function');
    if (!(n3 = this._events)) return this;
    if (!(s3 = n3[e3])) return this;
    if (s3 === i3 || s3.listener === i3) 0 === --this._eventsCount ? this._events = t2(null) : (delete n3[e3], n3.removeListener && this.emit("removeListener", e3, s3.listener || i3));
    else if ("function" != typeof s3) {
      for (r3 = -1, o3 = s3.length - 1; o3 >= 0; o3--) if (s3[o3] === i3 || s3[o3].listener === i3) {
        a3 = s3[o3].listener, r3 = o3;
        break;
      }
      if (r3 < 0) return this;
      0 === r3 ? s3.shift() : (function(e4, t3) {
        for (var i4 = t3, s4 = i4 + 1, n4 = e4.length; s4 < n4; i4 += 1, s4 += 1) e4[i4] = e4[s4];
        e4.pop();
      })(s3, r3), 1 === s3.length && (n3[e3] = s3[0]), n3.removeListener && this.emit("removeListener", e3, a3 || i3);
    }
    return this;
  }, n2.prototype.removeAllListeners = function(e3) {
    var s3, n3, r3;
    if (!(n3 = this._events)) return this;
    if (!n3.removeListener) return 0 === arguments.length ? (this._events = t2(null), this._eventsCount = 0) : n3[e3] && (0 === --this._eventsCount ? this._events = t2(null) : delete n3[e3]), this;
    if (0 === arguments.length) {
      var o3, a3 = i2(n3);
      for (r3 = 0; r3 < a3.length; ++r3) "removeListener" !== (o3 = a3[r3]) && this.removeAllListeners(o3);
      return this.removeAllListeners("removeListener"), this._events = t2(null), this._eventsCount = 0, this;
    }
    if ("function" == typeof (s3 = n3[e3])) this.removeListener(e3, s3);
    else if (s3) for (r3 = s3.length - 1; r3 >= 0; r3--) this.removeListener(e3, s3[r3]);
    return this;
  }, n2.prototype.listeners = function(e3) {
    return u2(this, e3, true);
  }, n2.prototype.rawListeners = function(e3) {
    return u2(this, e3, false);
  }, n2.listenerCount = function(e3, t3) {
    return "function" == typeof e3.listenerCount ? e3.listenerCount(t3) : p2.call(e3, t3);
  }, n2.prototype.listenerCount = p2, n2.prototype.eventNames = function() {
    return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
  };
}, 7264: () => {
}, 7373: (e2) => {
  e2.exports = function(e3) {
    var t2 = 0;
    return function() {
      if (t2 === e3.length) return null;
      var i2 = e3.length - t2, s2 = Math.random() * i2 | 0, n2 = e3[t2 + s2], r2 = e3[t2];
      return e3[t2] = n2, e3[t2 + s2] = r2, t2++, n2;
    };
  };
}, 7541: (e2, t2, i2) => {
  const s2 = i2(8765), n2 = i2(8499);
  e2.exports = { Throttle: s2, ThrottleGroup: n2 };
}, 7828: () => {
}, 7833: (e2, t2, i2) => {
  var s2 = i2(717);
  t2.formatArgs = function(t3) {
    if (t3[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + t3[0] + (this.useColors ? "%c " : " ") + "+" + e2.exports.humanize(this.diff), !this.useColors) return;
    const i3 = "color: " + this.color;
    t3.splice(1, 0, i3, "color: inherit");
    let s3 = 0, n3 = 0;
    t3[0].replace(/%[a-zA-Z%]/g, (e3) => {
      "%%" !== e3 && (s3++, "%c" === e3 && (n3 = s3));
    }), t3.splice(n3, 0, i3);
  }, t2.save = function(e3) {
    try {
      e3 ? t2.storage.setItem("debug", e3) : t2.storage.removeItem("debug");
    } catch (e4) {
    }
  }, t2.load = function() {
    let e3;
    try {
      e3 = t2.storage.getItem("debug") || t2.storage.getItem("DEBUG");
    } catch (e4) {
    }
    !e3 && void 0 !== s2 && "env" in s2 && (e3 = s2.env.DEBUG);
    return e3;
  }, t2.useColors = function() {
    if ("undefined" != typeof window && window.process && ("renderer" === window.process.type || window.process.__nwjs)) return true;
    if ("undefined" != typeof navigator && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) return false;
    let e3;
    return "undefined" != typeof document && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || "undefined" != typeof window && window.console && (window.console.firebug || window.console.exception && window.console.table) || "undefined" != typeof navigator && navigator.userAgent && (e3 = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(e3[1], 10) >= 31 || "undefined" != typeof navigator && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
  }, t2.storage = (function() {
    try {
      return localStorage;
    } catch (e3) {
    }
  })(), t2.destroy = /* @__PURE__ */ (() => {
    let e3 = false;
    return () => {
      e3 || (e3 = true, console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."));
    };
  })(), t2.colors = ["#0000CC", "#0000FF", "#0033CC", "#0033FF", "#0066CC", "#0066FF", "#0099CC", "#0099FF", "#00CC00", "#00CC33", "#00CC66", "#00CC99", "#00CCCC", "#00CCFF", "#3300CC", "#3300FF", "#3333CC", "#3333FF", "#3366CC", "#3366FF", "#3399CC", "#3399FF", "#33CC00", "#33CC33", "#33CC66", "#33CC99", "#33CCCC", "#33CCFF", "#6600CC", "#6600FF", "#6633CC", "#6633FF", "#66CC00", "#66CC33", "#9900CC", "#9900FF", "#9933CC", "#9933FF", "#99CC00", "#99CC33", "#CC0000", "#CC0033", "#CC0066", "#CC0099", "#CC00CC", "#CC00FF", "#CC3300", "#CC3333", "#CC3366", "#CC3399", "#CC33CC", "#CC33FF", "#CC6600", "#CC6633", "#CC9900", "#CC9933", "#CCCC00", "#CCCC33", "#FF0000", "#FF0033", "#FF0066", "#FF0099", "#FF00CC", "#FF00FF", "#FF3300", "#FF3333", "#FF3366", "#FF3399", "#FF33CC", "#FF33FF", "#FF6600", "#FF6633", "#FF9900", "#FF9933", "#FFCC00", "#FFCC33"], t2.log = console.debug || console.log || (() => {
  }), e2.exports = i2(736)(t2);
  const { formatters: n2 } = e2.exports;
  n2.j = function(e3) {
    try {
      return JSON.stringify(e3);
    } catch (e4) {
      return "[UnexpectedJSONParseError]: " + e4.message;
    }
  };
}, 8179: (e2, t2, i2) => {
  const { EventEmitter: s2 } = i2(7007), n2 = new Error("Stream was destroyed"), r2 = new Error("Premature close"), o2 = i2(6080), a2 = i2(5335), h2 = "undefined" == typeof queueMicrotask ? (e3) => globalThis.process.nextTick(e3) : queueMicrotask, l2 = 536870911, c2 = 1 ^ l2, d2 = 2 ^ l2, u2 = 32, p2 = 64, f2 = 128, m2 = 256, _2 = 1024, g2 = 2048, y2 = 4096, w2 = 8192, b2 = 16384, v2 = 32768, k2 = 131072, x2 = 131328, S2 = 16 ^ l2, E2 = 536805375, C2 = 768 ^ l2, P2 = 536838143, A2 = 536739839, T2 = 1 << 18, I2 = 2 << 18, L2 = 4 << 18, O2 = 8 << 18, R2 = 16 << 18, H2 = 32 << 18, N2 = 64 << 18, M2 = 128 << 18, F2 = 256 << 18, U2 = 512 << 18, j2 = 1024 << 18, B2 = 535822335, D2 = 503316479, q2 = 268435455, W2 = 262160, $2 = 536608751, z2 = 8404992, V2 = 14, G2 = 15, K2 = 8405006, Y2 = 33587200, J2 = 33587215, X2 = 2359296, Q2 = 270794767, Z2 = Symbol.asyncIterator || /* @__PURE__ */ Symbol("asyncIterator");
  class ee2 {
    constructor(e3, { highWaterMark: t3 = 16384, map: i3 = null, mapWritable: s3, byteLength: n3, byteLengthWritable: r3 } = {}) {
      this.stream = e3, this.queue = new o2(), this.highWaterMark = t3, this.buffered = 0, this.error = null, this.pipeline = null, this.drains = null, this.byteLength = r3 || n3 || Se2, this.map = s3 || i3, this.afterWrite = ae2.bind(this), this.afterUpdateNextTick = ce2.bind(this);
    }
    get ended() {
      return 0 !== (this.stream._duplexState & H2);
    }
    push(e3) {
      return !(142606350 & this.stream._duplexState) && (null !== this.map && (e3 = this.map(e3)), this.buffered += this.byteLength(e3), this.queue.push(e3), this.buffered < this.highWaterMark ? (this.stream._duplexState |= O2, true) : (this.stream._duplexState |= 6291456, false));
    }
    shift() {
      const e3 = this.queue.shift();
      return this.buffered -= this.byteLength(e3), 0 === this.buffered && (this.stream._duplexState &= 534773759), e3;
    }
    end(e3) {
      "function" == typeof e3 ? this.stream.once("finish", e3) : null != e3 && this.push(e3), this.stream._duplexState = (this.stream._duplexState | U2) & B2;
    }
    autoBatch(e3, t3) {
      const i3 = [], s3 = this.stream;
      for (i3.push(e3); (s3._duplexState & Q2) === X2; ) i3.push(s3._writableState.shift());
      if (0 !== (s3._duplexState & G2)) return t3(null);
      s3._writev(i3, t3);
    }
    update() {
      const e3 = this.stream;
      e3._duplexState |= I2;
      do {
        for (; (e3._duplexState & Q2) === O2; ) {
          const t3 = this.shift();
          e3._duplexState |= 67371008, e3._write(t3, this.afterWrite);
        }
        1310720 & e3._duplexState || this.updateNonPrimary();
      } while (true === this.continueUpdate());
      e3._duplexState &= 536346623;
    }
    updateNonPrimary() {
      const e3 = this.stream;
      if ((144965647 & e3._duplexState) === U2) return e3._duplexState = e3._duplexState | T2, void e3._final(re2.bind(this));
      4 !== (e3._duplexState & V2) ? 1 === (e3._duplexState & J2) && (e3._duplexState = (e3._duplexState | W2) & c2, e3._open(de2.bind(this))) : 0 === (e3._duplexState & Y2) && (e3._duplexState |= W2, e3._destroy(oe2.bind(this)));
    }
    continueUpdate() {
      return 0 !== (this.stream._duplexState & M2) && (this.stream._duplexState &= D2, true);
    }
    updateCallback() {
      (35127311 & this.stream._duplexState) === L2 ? this.update() : this.updateNextTick();
    }
    updateNextTick() {
      0 === (this.stream._duplexState & M2) && (this.stream._duplexState |= M2, 0 === (this.stream._duplexState & I2) && h2(this.afterUpdateNextTick));
    }
  }
  class te2 {
    constructor(e3, { highWaterMark: t3 = 16384, map: i3 = null, mapReadable: s3, byteLength: n3, byteLengthReadable: r3 } = {}) {
      this.stream = e3, this.queue = new o2(), this.highWaterMark = 0 === t3 ? 1 : t3, this.buffered = 0, this.readAhead = t3 > 0, this.error = null, this.pipeline = null, this.byteLength = r3 || n3 || Se2, this.map = s3 || i3, this.pipeTo = null, this.afterRead = he2.bind(this), this.afterUpdateNextTick = le2.bind(this);
    }
    get ended() {
      return 0 !== (this.stream._duplexState & b2);
    }
    pipe(e3, t3) {
      if (null !== this.pipeTo) throw new Error("Can only pipe to one destination");
      if ("function" != typeof t3 && (t3 = null), this.stream._duplexState |= 512, this.pipeTo = e3, this.pipeline = new se2(this.stream, e3, t3), t3 && this.stream.on("error", Ee2), xe2(e3)) e3._writableState.pipeline = this.pipeline, t3 && e3.on("error", Ee2), e3.on("finish", this.pipeline.finished.bind(this.pipeline));
      else {
        const t4 = this.pipeline.done.bind(this.pipeline, e3), i3 = this.pipeline.done.bind(this.pipeline, e3, null);
        e3.on("error", t4), e3.on("close", i3), e3.on("finish", this.pipeline.finished.bind(this.pipeline));
      }
      e3.on("drain", ne2.bind(this)), this.stream.emit("piping", e3), e3.emit("pipe", this.stream);
    }
    push(e3) {
      const t3 = this.stream;
      return null === e3 ? (this.highWaterMark = 0, t3._duplexState = 536805311 & t3._duplexState | 1024, false) : null !== this.map && null === (e3 = this.map(e3)) ? (t3._duplexState &= E2, this.buffered < this.highWaterMark) : (this.buffered += this.byteLength(e3), this.queue.push(e3), t3._duplexState = (t3._duplexState | f2) & E2, this.buffered < this.highWaterMark);
    }
    shift() {
      const e3 = this.queue.shift();
      return this.buffered -= this.byteLength(e3), 0 === this.buffered && (this.stream._duplexState &= 536862591), e3;
    }
    unshift(e3) {
      const t3 = [null !== this.map ? this.map(e3) : e3];
      for (; this.buffered > 0; ) t3.push(this.shift());
      for (let e4 = 0; e4 < t3.length - 1; e4++) {
        const i3 = t3[e4];
        this.buffered += this.byteLength(i3), this.queue.push(i3);
      }
      this.push(t3[t3.length - 1]);
    }
    read() {
      const e3 = this.stream;
      if ((16527 & e3._duplexState) === f2) {
        const t3 = this.shift();
        return null !== this.pipeTo && false === this.pipeTo.write(t3) && (e3._duplexState &= C2), 0 !== (e3._duplexState & g2) && e3.emit("data", t3), t3;
      }
      return false === this.readAhead && (e3._duplexState |= k2, this.updateNextTick()), null;
    }
    drain() {
      const e3 = this.stream;
      for (; (16527 & e3._duplexState) === f2 && 768 & e3._duplexState; ) {
        const t3 = this.shift();
        null !== this.pipeTo && false === this.pipeTo.write(t3) && (e3._duplexState &= C2), 0 !== (e3._duplexState & g2) && e3.emit("data", t3);
      }
    }
    update() {
      const e3 = this.stream;
      e3._duplexState |= u2;
      do {
        for (this.drain(); this.buffered < this.highWaterMark && (214047 & e3._duplexState) === k2; ) e3._duplexState |= 65552, e3._read(this.afterRead), this.drain();
        4224 == (12431 & e3._duplexState) && (e3._duplexState |= w2, e3.emit("readable")), 80 & e3._duplexState || this.updateNonPrimary();
      } while (true === this.continueUpdate());
      e3._duplexState &= 536870879;
    }
    updateNonPrimary() {
      const e3 = this.stream;
      (1167 & e3._duplexState) === _2 && (e3._duplexState = 536869887 & e3._duplexState | 16384, e3.emit("end"), (e3._duplexState & K2) === z2 && (e3._duplexState |= 4), null !== this.pipeTo && this.pipeTo.end()), 4 !== (e3._duplexState & V2) ? 1 === (e3._duplexState & J2) && (e3._duplexState = (e3._duplexState | W2) & c2, e3._open(de2.bind(this))) : 0 === (e3._duplexState & Y2) && (e3._duplexState |= W2, e3._destroy(oe2.bind(this)));
    }
    continueUpdate() {
      return 0 !== (this.stream._duplexState & v2) && (this.stream._duplexState &= P2, true);
    }
    updateCallback() {
      (32879 & this.stream._duplexState) === p2 ? this.update() : this.updateNextTick();
    }
    updateNextTickIfOpen() {
      32769 & this.stream._duplexState || (this.stream._duplexState |= v2, 0 === (this.stream._duplexState & u2) && h2(this.afterUpdateNextTick));
    }
    updateNextTick() {
      0 === (this.stream._duplexState & v2) && (this.stream._duplexState |= v2, 0 === (this.stream._duplexState & u2) && h2(this.afterUpdateNextTick));
    }
  }
  class ie2 {
    constructor(e3) {
      this.data = null, this.afterTransform = ue2.bind(e3), this.afterFinal = null;
    }
  }
  class se2 {
    constructor(e3, t3, i3) {
      this.from = e3, this.to = t3, this.afterPipe = i3, this.error = null, this.pipeToFinished = false;
    }
    finished() {
      this.pipeToFinished = true;
    }
    done(e3, t3) {
      t3 && (this.error = t3), e3 !== this.to || (this.to = null, null === this.from) ? e3 !== this.from || (this.from = null, null === this.to) ? (null !== this.afterPipe && this.afterPipe(this.error), this.to = this.from = this.afterPipe = null) : 0 === (e3._duplexState & b2) && this.to.destroy(this.error || new Error("Readable stream closed before ending")) : 0 !== (this.from._duplexState & b2) && this.pipeToFinished || this.from.destroy(this.error || new Error("Writable stream closed prematurely"));
    }
  }
  function ne2() {
    this.stream._duplexState |= 512, this.updateCallback();
  }
  function re2(e3) {
    const t3 = this.stream;
    e3 && t3.destroy(e3), 0 === (t3._duplexState & V2) && (t3._duplexState |= H2, t3.emit("finish")), (t3._duplexState & K2) === z2 && (t3._duplexState |= 4), t3._duplexState &= 402391039, 0 === (t3._duplexState & I2) ? this.update() : this.updateNextTick();
  }
  function oe2(e3) {
    const t3 = this.stream;
    e3 || this.error === n2 || (e3 = this.error), e3 && t3.emit("error", e3), t3._duplexState |= 8, t3.emit("close");
    const i3 = t3._readableState, s3 = t3._writableState;
    if (null !== i3 && null !== i3.pipeline && i3.pipeline.done(t3, e3), null !== s3) {
      for (; null !== s3.drains && s3.drains.length > 0; ) s3.drains.shift().resolve(false);
      null !== s3.pipeline && s3.pipeline.done(t3, e3);
    }
  }
  function ae2(e3) {
    const t3 = this.stream;
    e3 && t3.destroy(e3), t3._duplexState &= 469499903, null !== this.drains && (function(e4) {
      for (let t4 = 0; t4 < e4.length; t4++) 0 === --e4[t4].writes && (e4.shift().resolve(true), t4--);
    })(this.drains), (6553615 & t3._duplexState) === R2 && (t3._duplexState &= 532676607, (t3._duplexState & N2) === N2 && t3.emit("drain")), this.updateCallback();
  }
  function he2(e3) {
    e3 && this.stream.destroy(e3), this.stream._duplexState &= S2, false === this.readAhead && 0 === (this.stream._duplexState & m2) && (this.stream._duplexState &= A2), this.updateCallback();
  }
  function le2() {
    0 === (this.stream._duplexState & u2) && (this.stream._duplexState &= P2, this.update());
  }
  function ce2() {
    0 === (this.stream._duplexState & I2) && (this.stream._duplexState &= D2, this.update());
  }
  function de2(e3) {
    const t3 = this.stream;
    e3 && t3.destroy(e3), 4 & t3._duplexState || (17423 & t3._duplexState || (t3._duplexState |= p2), 142606351 & t3._duplexState || (t3._duplexState |= L2), t3.emit("open")), t3._duplexState &= $2, null !== t3._writableState && t3._writableState.updateCallback(), null !== t3._readableState && t3._readableState.updateCallback();
  }
  function ue2(e3, t3) {
    null != t3 && this.push(t3), this._writableState.afterWrite(e3);
  }
  function pe2(e3) {
    null !== this._readableState && ("data" === e3 && (this._duplexState |= 133376, this._readableState.updateNextTick()), "readable" === e3 && (this._duplexState |= y2, this._readableState.updateNextTick())), null !== this._writableState && "drain" === e3 && (this._duplexState |= N2, this._writableState.updateNextTick());
  }
  class fe2 extends s2 {
    constructor(e3) {
      super(), this._duplexState = 0, this._readableState = null, this._writableState = null, e3 && (e3.open && (this._open = e3.open), e3.destroy && (this._destroy = e3.destroy), e3.predestroy && (this._predestroy = e3.predestroy), e3.signal && e3.signal.addEventListener("abort", Ce2.bind(this))), this.on("newListener", pe2);
    }
    _open(e3) {
      e3(null);
    }
    _destroy(e3) {
      e3(null);
    }
    _predestroy() {
    }
    get readable() {
      return null !== this._readableState || void 0;
    }
    get writable() {
      return null !== this._writableState || void 0;
    }
    get destroyed() {
      return !!(8 & this._duplexState);
    }
    get destroying() {
      return 0 !== (this._duplexState & V2);
    }
    destroy(e3) {
      0 === (this._duplexState & V2) && (e3 || (e3 = n2), this._duplexState = 535822271 & this._duplexState | 4, null !== this._readableState && (this._readableState.highWaterMark = 0, this._readableState.error = e3), null !== this._writableState && (this._writableState.highWaterMark = 0, this._writableState.error = e3), this._duplexState |= 2, this._predestroy(), this._duplexState &= d2, null !== this._readableState && this._readableState.updateNextTick(), null !== this._writableState && this._writableState.updateNextTick());
    }
  }
  class me2 extends fe2 {
    constructor(e3) {
      super(e3), this._duplexState |= 8519681, this._readableState = new te2(this, e3), e3 && (false === this._readableState.readAhead && (this._duplexState &= A2), e3.read && (this._read = e3.read), e3.eagerOpen && this._readableState.updateNextTick(), e3.encoding && this.setEncoding(e3.encoding));
    }
    setEncoding(e3) {
      const t3 = new a2(e3), i3 = this._readableState.map || ve2;
      return this._readableState.map = function(e4) {
        const s3 = t3.push(e4);
        return "" === s3 && (0 !== e4.byteLength || t3.remaining > 0) ? null : i3(s3);
      }, this;
    }
    _read(e3) {
      e3(null);
    }
    pipe(e3, t3) {
      return this._readableState.updateNextTick(), this._readableState.pipe(e3, t3), e3;
    }
    read() {
      return this._readableState.updateNextTick(), this._readableState.read();
    }
    push(e3) {
      return this._readableState.updateNextTickIfOpen(), this._readableState.push(e3);
    }
    unshift(e3) {
      return this._readableState.updateNextTickIfOpen(), this._readableState.unshift(e3);
    }
    resume() {
      return this._duplexState |= x2, this._readableState.updateNextTick(), this;
    }
    pause() {
      return this._duplexState &= false === this._readableState.readAhead ? 536739583 : 536870655, this;
    }
    static _fromAsyncIterator(e3, t3) {
      let i3;
      const s3 = new me2({ ...t3, read(t4) {
        e3.next().then(n3).then(t4.bind(null, null)).catch(t4);
      }, predestroy() {
        i3 = e3.return();
      }, destroy(e4) {
        if (!i3) return e4(null);
        i3.then(e4.bind(null, null)).catch(e4);
      } });
      return s3;
      function n3(e4) {
        e4.done ? s3.push(null) : s3.push(e4.value);
      }
    }
    static from(e3, t3) {
      if (xe2(i3 = e3) && i3.readable) return e3;
      var i3;
      if (e3[Z2]) return this._fromAsyncIterator(e3[Z2](), t3);
      Array.isArray(e3) || (e3 = void 0 === e3 ? [] : [e3]);
      let s3 = 0;
      return new me2({ ...t3, read(t4) {
        this.push(s3 === e3.length ? null : e3[s3++]), t4(null);
      } });
    }
    static isBackpressured(e3) {
      return !!(17422 & e3._duplexState) || e3._readableState.buffered >= e3._readableState.highWaterMark;
    }
    static isPaused(e3) {
      return 0 === (e3._duplexState & m2);
    }
    [Z2]() {
      const e3 = this;
      let t3 = null, i3 = null, s3 = null;
      return this.on("error", (e4) => {
        t3 = e4;
      }), this.on("readable", function() {
        null !== i3 && r3(e3.read());
      }), this.on("close", function() {
        null !== i3 && r3(null);
      }), { [Z2]() {
        return this;
      }, next: () => new Promise(function(t4, n3) {
        i3 = t4, s3 = n3;
        const o4 = e3.read();
        null !== o4 ? r3(o4) : 8 & e3._duplexState && r3(null);
      }), return: () => o3(null), throw: (e4) => o3(e4) };
      function r3(r4) {
        null !== s3 && (t3 ? s3(t3) : null === r4 && 0 === (e3._duplexState & b2) ? s3(n2) : i3({ value: r4, done: null === r4 }), s3 = i3 = null);
      }
      function o3(t4) {
        return e3.destroy(t4), new Promise((i4, s4) => {
          if (8 & e3._duplexState) return i4({ value: void 0, done: true });
          e3.once("close", function() {
            t4 ? s4(t4) : i4({ value: void 0, done: true });
          });
        });
      }
    }
  }
  class _e2 extends fe2 {
    constructor(e3) {
      super(e3), this._duplexState |= 16385, this._writableState = new ee2(this, e3), e3 && (e3.writev && (this._writev = e3.writev), e3.write && (this._write = e3.write), e3.final && (this._final = e3.final), e3.eagerOpen && this._writableState.updateNextTick());
    }
    cork() {
      this._duplexState |= j2;
    }
    uncork() {
      this._duplexState &= q2, this._writableState.updateNextTick();
    }
    _writev(e3, t3) {
      t3(null);
    }
    _write(e3, t3) {
      this._writableState.autoBatch(e3, t3);
    }
    _final(e3) {
      e3(null);
    }
    static isBackpressured(e3) {
      return !!(146800654 & e3._duplexState);
    }
    static drained(e3) {
      if (e3.destroyed) return Promise.resolve(false);
      const t3 = e3._writableState;
      var i3;
      const s3 = ((i3 = e3)._writev !== _e2.prototype._writev && i3._writev !== ge2.prototype._writev ? Math.min(1, t3.queue.length) : t3.queue.length) + (e3._duplexState & F2 ? 1 : 0);
      return 0 === s3 ? Promise.resolve(true) : (null === t3.drains && (t3.drains = []), new Promise((e4) => {
        t3.drains.push({ writes: s3, resolve: e4 });
      }));
    }
    write(e3) {
      return this._writableState.updateNextTick(), this._writableState.push(e3);
    }
    end(e3) {
      return this._writableState.updateNextTick(), this._writableState.end(e3), this;
    }
  }
  class ge2 extends me2 {
    constructor(e3) {
      super(e3), this._duplexState = 1 | this._duplexState & k2, this._writableState = new ee2(this, e3), e3 && (e3.writev && (this._writev = e3.writev), e3.write && (this._write = e3.write), e3.final && (this._final = e3.final));
    }
    cork() {
      this._duplexState |= j2;
    }
    uncork() {
      this._duplexState &= q2, this._writableState.updateNextTick();
    }
    _writev(e3, t3) {
      t3(null);
    }
    _write(e3, t3) {
      this._writableState.autoBatch(e3, t3);
    }
    _final(e3) {
      e3(null);
    }
    write(e3) {
      return this._writableState.updateNextTick(), this._writableState.push(e3);
    }
    end(e3) {
      return this._writableState.updateNextTick(), this._writableState.end(e3), this;
    }
  }
  class ye2 extends ge2 {
    constructor(e3) {
      super(e3), this._transformState = new ie2(this), e3 && (e3.transform && (this._transform = e3.transform), e3.flush && (this._flush = e3.flush));
    }
    _write(e3, t3) {
      this._readableState.buffered >= this._readableState.highWaterMark ? this._transformState.data = e3 : this._transform(e3, this._transformState.afterTransform);
    }
    _read(e3) {
      if (null !== this._transformState.data) {
        const t3 = this._transformState.data;
        this._transformState.data = null, e3(null), this._transform(t3, this._transformState.afterTransform);
      } else e3(null);
    }
    destroy(e3) {
      super.destroy(e3), null !== this._transformState.data && (this._transformState.data = null, this._transformState.afterTransform());
    }
    _transform(e3, t3) {
      t3(null, e3);
    }
    _flush(e3) {
      e3(null);
    }
    _final(e3) {
      this._transformState.afterFinal = e3, this._flush(we2.bind(this));
    }
  }
  function we2(e3, t3) {
    const i3 = this._transformState.afterFinal;
    if (e3) return i3(e3);
    null != t3 && this.push(t3), this.push(null), i3(null);
  }
  function be2(e3, ...t3) {
    const i3 = Array.isArray(e3) ? [...e3, ...t3] : [e3, ...t3], s3 = i3.length && "function" == typeof i3[i3.length - 1] ? i3.pop() : null;
    if (i3.length < 2) throw new Error("Pipeline requires at least 2 streams");
    let n3 = i3[0], o3 = null, a3 = null;
    for (let e4 = 1; e4 < i3.length; e4++) o3 = i3[e4], xe2(n3) ? n3.pipe(o3, l3) : (h3(n3, true, e4 > 1, l3), n3.pipe(o3)), n3 = o3;
    if (s3) {
      let e4 = false;
      const t4 = xe2(o3) || !(!o3._writableState || !o3._writableState.autoDestroy);
      o3.on("error", (e5) => {
        null === a3 && (a3 = e5);
      }), o3.on("finish", () => {
        e4 = true, t4 || s3(a3);
      }), t4 && o3.on("close", () => s3(a3 || (e4 ? null : r2)));
    }
    return o3;
    function h3(e4, t4, i4, s4) {
      e4.on("error", s4), e4.on("close", function() {
        if (t4 && e4._readableState && !e4._readableState.ended) return s4(r2);
        if (i4 && e4._writableState && !e4._writableState.ended) return s4(r2);
      });
    }
    function l3(e4) {
      if (e4 && !a3) {
        a3 = e4;
        for (const t4 of i3) t4.destroy(e4);
      }
    }
  }
  function ve2(e3) {
    return e3;
  }
  function ke2(e3) {
    return !!e3._readableState || !!e3._writableState;
  }
  function xe2(e3) {
    return "number" == typeof e3._duplexState && ke2(e3);
  }
  function Se2(e3) {
    return (function(e4) {
      return "object" == typeof e4 && null !== e4 && "number" == typeof e4.byteLength;
    })(e3) ? e3.byteLength : 1024;
  }
  function Ee2() {
  }
  function Ce2() {
    this.destroy(new Error("Stream aborted."));
  }
  e2.exports = { pipeline: be2, pipelinePromise: function(...e3) {
    return new Promise((t3, i3) => be2(...e3, (e4) => {
      if (e4) return i3(e4);
      t3();
    }));
  }, isStream: ke2, isStreamx: xe2, isEnded: function(e3) {
    return !!e3._readableState && e3._readableState.ended;
  }, isFinished: function(e3) {
    return !!e3._writableState && e3._writableState.ended;
  }, isDisturbed: function(e3) {
    return !!(1 & ~e3._duplexState) || 0 !== (e3._duplexState & Y2);
  }, getStreamError: function(e3, t3 = {}) {
    const i3 = e3._readableState && e3._readableState.error || e3._writableState && e3._writableState.error;
    return t3.all || i3 !== n2 ? i3 : null;
  }, Stream: fe2, Writable: _e2, Readable: me2, Duplex: ge2, Transform: ye2, PassThrough: class extends ye2 {
  } };
}, 8190: (e2, t2, i2) => {
  e2.exports = function(e3, t3) {
    let i3, n2, r2, o2 = true;
    Array.isArray(e3) ? (i3 = [], n2 = e3.length) : (r2 = Object.keys(e3), i3 = {}, n2 = r2.length);
    function a2(e4) {
      function n3() {
        t3 && t3(e4, i3), t3 = null;
      }
      o2 ? s2(n3) : n3();
    }
    function h2(e4, t4, s3) {
      i3[e4] = s3, (0 === --n2 || t4) && a2(t4);
    }
    n2 ? r2 ? r2.forEach(function(t4) {
      e3[t4](function(e4, i4) {
        h2(t4, e4, i4);
      });
    }) : e3.forEach(function(e4, t4) {
      e4(function(e5, i4) {
        h2(t4, e5, i4);
      });
    }) : a2(null);
    o2 = false;
  };
  const s2 = i2(9596);
}, 8271: () => {
}, 8330: (e2) => {
  e2.exports = { version: "2.8.4" };
}, 8444: (e2) => {
  e2.exports = function(e3) {
    return Math.max(16384, 1 << Math.log2(e3 < 1024 ? 1 : e3 / 1024) + 0.5);
  };
}, 8446: (e2) => {
  e2.exports = { "application/andrew-inset": ["ez"], "application/applixware": ["aw"], "application/atom+xml": ["atom"], "application/atomcat+xml": ["atomcat"], "application/atomdeleted+xml": ["atomdeleted"], "application/atomsvc+xml": ["atomsvc"], "application/atsc-dwd+xml": ["dwd"], "application/atsc-held+xml": ["held"], "application/atsc-rsat+xml": ["rsat"], "application/bdoc": ["bdoc"], "application/calendar+xml": ["xcs"], "application/ccxml+xml": ["ccxml"], "application/cdfx+xml": ["cdfx"], "application/cdmi-capability": ["cdmia"], "application/cdmi-container": ["cdmic"], "application/cdmi-domain": ["cdmid"], "application/cdmi-object": ["cdmio"], "application/cdmi-queue": ["cdmiq"], "application/cu-seeme": ["cu"], "application/dash+xml": ["mpd"], "application/davmount+xml": ["davmount"], "application/docbook+xml": ["dbk"], "application/dssc+der": ["dssc"], "application/dssc+xml": ["xdssc"], "application/ecmascript": ["es", "ecma"], "application/emma+xml": ["emma"], "application/emotionml+xml": ["emotionml"], "application/epub+zip": ["epub"], "application/exi": ["exi"], "application/express": ["exp"], "application/fdt+xml": ["fdt"], "application/font-tdpfr": ["pfr"], "application/geo+json": ["geojson"], "application/gml+xml": ["gml"], "application/gpx+xml": ["gpx"], "application/gxf": ["gxf"], "application/gzip": ["gz"], "application/hjson": ["hjson"], "application/hyperstudio": ["stk"], "application/inkml+xml": ["ink", "inkml"], "application/ipfix": ["ipfix"], "application/its+xml": ["its"], "application/java-archive": ["jar", "war", "ear"], "application/java-serialized-object": ["ser"], "application/java-vm": ["class"], "application/javascript": ["js", "mjs"], "application/json": ["json", "map"], "application/json5": ["json5"], "application/jsonml+json": ["jsonml"], "application/ld+json": ["jsonld"], "application/lgr+xml": ["lgr"], "application/lost+xml": ["lostxml"], "application/mac-binhex40": ["hqx"], "application/mac-compactpro": ["cpt"], "application/mads+xml": ["mads"], "application/manifest+json": ["webmanifest"], "application/marc": ["mrc"], "application/marcxml+xml": ["mrcx"], "application/mathematica": ["ma", "nb", "mb"], "application/mathml+xml": ["mathml"], "application/mbox": ["mbox"], "application/mediaservercontrol+xml": ["mscml"], "application/metalink+xml": ["metalink"], "application/metalink4+xml": ["meta4"], "application/mets+xml": ["mets"], "application/mmt-aei+xml": ["maei"], "application/mmt-usd+xml": ["musd"], "application/mods+xml": ["mods"], "application/mp21": ["m21", "mp21"], "application/mp4": ["mp4s", "m4p"], "application/msword": ["doc", "dot"], "application/mxf": ["mxf"], "application/n-quads": ["nq"], "application/n-triples": ["nt"], "application/node": ["cjs"], "application/octet-stream": ["bin", "dms", "lrf", "mar", "so", "dist", "distz", "pkg", "bpk", "dump", "elc", "deploy", "exe", "dll", "deb", "dmg", "iso", "img", "msi", "msp", "msm", "buffer"], "application/oda": ["oda"], "application/oebps-package+xml": ["opf"], "application/ogg": ["ogx"], "application/omdoc+xml": ["omdoc"], "application/onenote": ["onetoc", "onetoc2", "onetmp", "onepkg"], "application/oxps": ["oxps"], "application/p2p-overlay+xml": ["relo"], "application/patch-ops-error+xml": ["xer"], "application/pdf": ["pdf"], "application/pgp-encrypted": ["pgp"], "application/pgp-signature": ["asc", "sig"], "application/pics-rules": ["prf"], "application/pkcs10": ["p10"], "application/pkcs7-mime": ["p7m", "p7c"], "application/pkcs7-signature": ["p7s"], "application/pkcs8": ["p8"], "application/pkix-attr-cert": ["ac"], "application/pkix-cert": ["cer"], "application/pkix-crl": ["crl"], "application/pkix-pkipath": ["pkipath"], "application/pkixcmp": ["pki"], "application/pls+xml": ["pls"], "application/postscript": ["ai", "eps", "ps"], "application/provenance+xml": ["provx"], "application/pskc+xml": ["pskcxml"], "application/raml+yaml": ["raml"], "application/rdf+xml": ["rdf", "owl"], "application/reginfo+xml": ["rif"], "application/relax-ng-compact-syntax": ["rnc"], "application/resource-lists+xml": ["rl"], "application/resource-lists-diff+xml": ["rld"], "application/rls-services+xml": ["rs"], "application/route-apd+xml": ["rapd"], "application/route-s-tsid+xml": ["sls"], "application/route-usd+xml": ["rusd"], "application/rpki-ghostbusters": ["gbr"], "application/rpki-manifest": ["mft"], "application/rpki-roa": ["roa"], "application/rsd+xml": ["rsd"], "application/rss+xml": ["rss"], "application/rtf": ["rtf"], "application/sbml+xml": ["sbml"], "application/scvp-cv-request": ["scq"], "application/scvp-cv-response": ["scs"], "application/scvp-vp-request": ["spq"], "application/scvp-vp-response": ["spp"], "application/sdp": ["sdp"], "application/senml+xml": ["senmlx"], "application/sensml+xml": ["sensmlx"], "application/set-payment-initiation": ["setpay"], "application/set-registration-initiation": ["setreg"], "application/shf+xml": ["shf"], "application/sieve": ["siv", "sieve"], "application/smil+xml": ["smi", "smil"], "application/sparql-query": ["rq"], "application/sparql-results+xml": ["srx"], "application/srgs": ["gram"], "application/srgs+xml": ["grxml"], "application/sru+xml": ["sru"], "application/ssdl+xml": ["ssdl"], "application/ssml+xml": ["ssml"], "application/swid+xml": ["swidtag"], "application/tei+xml": ["tei", "teicorpus"], "application/thraud+xml": ["tfi"], "application/timestamped-data": ["tsd"], "application/toml": ["toml"], "application/trig": ["trig"], "application/ttml+xml": ["ttml"], "application/ubjson": ["ubj"], "application/urc-ressheet+xml": ["rsheet"], "application/urc-targetdesc+xml": ["td"], "application/voicexml+xml": ["vxml"], "application/wasm": ["wasm"], "application/widget": ["wgt"], "application/winhlp": ["hlp"], "application/wsdl+xml": ["wsdl"], "application/wspolicy+xml": ["wspolicy"], "application/xaml+xml": ["xaml"], "application/xcap-att+xml": ["xav"], "application/xcap-caps+xml": ["xca"], "application/xcap-diff+xml": ["xdf"], "application/xcap-el+xml": ["xel"], "application/xcap-ns+xml": ["xns"], "application/xenc+xml": ["xenc"], "application/xhtml+xml": ["xhtml", "xht"], "application/xliff+xml": ["xlf"], "application/xml": ["xml", "xsl", "xsd", "rng"], "application/xml-dtd": ["dtd"], "application/xop+xml": ["xop"], "application/xproc+xml": ["xpl"], "application/xslt+xml": ["*xsl", "xslt"], "application/xspf+xml": ["xspf"], "application/xv+xml": ["mxml", "xhvml", "xvml", "xvm"], "application/yang": ["yang"], "application/yin+xml": ["yin"], "application/zip": ["zip"], "audio/3gpp": ["*3gpp"], "audio/adpcm": ["adp"], "audio/amr": ["amr"], "audio/basic": ["au", "snd"], "audio/midi": ["mid", "midi", "kar", "rmi"], "audio/mobile-xmf": ["mxmf"], "audio/mp3": ["*mp3"], "audio/mp4": ["m4a", "mp4a"], "audio/mpeg": ["mpga", "mp2", "mp2a", "mp3", "m2a", "m3a"], "audio/ogg": ["oga", "ogg", "spx", "opus"], "audio/s3m": ["s3m"], "audio/silk": ["sil"], "audio/wav": ["wav"], "audio/wave": ["*wav"], "audio/webm": ["weba"], "audio/xm": ["xm"], "font/collection": ["ttc"], "font/otf": ["otf"], "font/ttf": ["ttf"], "font/woff": ["woff"], "font/woff2": ["woff2"], "image/aces": ["exr"], "image/apng": ["apng"], "image/avif": ["avif"], "image/bmp": ["bmp"], "image/cgm": ["cgm"], "image/dicom-rle": ["drle"], "image/emf": ["emf"], "image/fits": ["fits"], "image/g3fax": ["g3"], "image/gif": ["gif"], "image/heic": ["heic"], "image/heic-sequence": ["heics"], "image/heif": ["heif"], "image/heif-sequence": ["heifs"], "image/hej2k": ["hej2"], "image/hsj2": ["hsj2"], "image/ief": ["ief"], "image/jls": ["jls"], "image/jp2": ["jp2", "jpg2"], "image/jpeg": ["jpeg", "jpg", "jpe"], "image/jph": ["jph"], "image/jphc": ["jhc"], "image/jpm": ["jpm"], "image/jpx": ["jpx", "jpf"], "image/jxr": ["jxr"], "image/jxra": ["jxra"], "image/jxrs": ["jxrs"], "image/jxs": ["jxs"], "image/jxsc": ["jxsc"], "image/jxsi": ["jxsi"], "image/jxss": ["jxss"], "image/ktx": ["ktx"], "image/ktx2": ["ktx2"], "image/png": ["png"], "image/sgi": ["sgi"], "image/svg+xml": ["svg", "svgz"], "image/t38": ["t38"], "image/tiff": ["tif", "tiff"], "image/tiff-fx": ["tfx"], "image/webp": ["webp"], "image/wmf": ["wmf"], "message/disposition-notification": ["disposition-notification"], "message/global": ["u8msg"], "message/global-delivery-status": ["u8dsn"], "message/global-disposition-notification": ["u8mdn"], "message/global-headers": ["u8hdr"], "message/rfc822": ["eml", "mime"], "model/3mf": ["3mf"], "model/gltf+json": ["gltf"], "model/gltf-binary": ["glb"], "model/iges": ["igs", "iges"], "model/mesh": ["msh", "mesh", "silo"], "model/mtl": ["mtl"], "model/obj": ["obj"], "model/step+xml": ["stpx"], "model/step+zip": ["stpz"], "model/step-xml+zip": ["stpxz"], "model/stl": ["stl"], "model/vrml": ["wrl", "vrml"], "model/x3d+binary": ["*x3db", "x3dbz"], "model/x3d+fastinfoset": ["x3db"], "model/x3d+vrml": ["*x3dv", "x3dvz"], "model/x3d+xml": ["x3d", "x3dz"], "model/x3d-vrml": ["x3dv"], "text/cache-manifest": ["appcache", "manifest"], "text/calendar": ["ics", "ifb"], "text/coffeescript": ["coffee", "litcoffee"], "text/css": ["css"], "text/csv": ["csv"], "text/html": ["html", "htm", "shtml"], "text/jade": ["jade"], "text/jsx": ["jsx"], "text/less": ["less"], "text/markdown": ["markdown", "md"], "text/mathml": ["mml"], "text/mdx": ["mdx"], "text/n3": ["n3"], "text/plain": ["txt", "text", "conf", "def", "list", "log", "in", "ini"], "text/richtext": ["rtx"], "text/rtf": ["*rtf"], "text/sgml": ["sgml", "sgm"], "text/shex": ["shex"], "text/slim": ["slim", "slm"], "text/spdx": ["spdx"], "text/stylus": ["stylus", "styl"], "text/tab-separated-values": ["tsv"], "text/troff": ["t", "tr", "roff", "man", "me", "ms"], "text/turtle": ["ttl"], "text/uri-list": ["uri", "uris", "urls"], "text/vcard": ["vcard"], "text/vtt": ["vtt"], "text/xml": ["*xml"], "text/yaml": ["yaml", "yml"], "video/3gpp": ["3gp", "3gpp"], "video/3gpp2": ["3g2"], "video/h261": ["h261"], "video/h263": ["h263"], "video/h264": ["h264"], "video/iso.segment": ["m4s"], "video/jpeg": ["jpgv"], "video/jpm": ["*jpm", "jpgm"], "video/mj2": ["mj2", "mjp2"], "video/mp2t": ["ts"], "video/mp4": ["mp4", "mp4v", "mpg4"], "video/mpeg": ["mpeg", "mpg", "mpe", "m1v", "m2v"], "video/ogg": ["ogv"], "video/quicktime": ["qt", "mov"], "video/webm": ["webm"] };
}, 8454: (e2, t2, i2) => {
  var s2 = i2(7007), n2 = i2(6698);
  function r2(e3) {
    if (!(this instanceof r2)) return new r2(e3);
    "number" == typeof e3 && (e3 = { max: e3 }), e3 || (e3 = {}), s2.EventEmitter.call(this), this.cache = {}, this.head = this.tail = null, this.length = 0, this.max = e3.max || 1e3, this.maxAge = e3.maxAge || 0;
  }
  e2.exports = r2, n2(r2, s2.EventEmitter), Object.defineProperty(r2.prototype, "keys", { get: function() {
    return Object.keys(this.cache);
  } }), r2.prototype.clear = function() {
    this.cache = {}, this.head = this.tail = null, this.length = 0;
  }, r2.prototype.remove = function(e3) {
    if ("string" != typeof e3 && (e3 = "" + e3), this.cache.hasOwnProperty(e3)) {
      var t3 = this.cache[e3];
      return delete this.cache[e3], this._unlink(e3, t3.prev, t3.next), t3.value;
    }
  }, r2.prototype._unlink = function(e3, t3, i3) {
    this.length--, 0 === this.length ? this.head = this.tail = null : this.head === e3 ? (this.head = t3, this.cache[this.head].next = null) : this.tail === e3 ? (this.tail = i3, this.cache[this.tail].prev = null) : (this.cache[t3].next = i3, this.cache[i3].prev = t3);
  }, r2.prototype.peek = function(e3) {
    if (this.cache.hasOwnProperty(e3)) {
      var t3 = this.cache[e3];
      if (this._checkAge(e3, t3)) return t3.value;
    }
  }, r2.prototype.set = function(e3, t3) {
    var i3;
    if ("string" != typeof e3 && (e3 = "" + e3), this.cache.hasOwnProperty(e3)) {
      if ((i3 = this.cache[e3]).value = t3, this.maxAge && (i3.modified = Date.now()), e3 === this.head) return t3;
      this._unlink(e3, i3.prev, i3.next);
    } else i3 = { value: t3, modified: 0, next: null, prev: null }, this.maxAge && (i3.modified = Date.now()), this.cache[e3] = i3, this.length === this.max && this.evict();
    return this.length++, i3.next = null, i3.prev = this.head, this.head && (this.cache[this.head].next = e3), this.head = e3, this.tail || (this.tail = e3), t3;
  }, r2.prototype._checkAge = function(e3, t3) {
    return !(this.maxAge && Date.now() - t3.modified > this.maxAge) || (this.remove(e3), this.emit("evict", { key: e3, value: t3.value }), false);
  }, r2.prototype.get = function(e3) {
    if ("string" != typeof e3 && (e3 = "" + e3), this.cache.hasOwnProperty(e3)) {
      var t3 = this.cache[e3];
      if (this._checkAge(e3, t3)) return this.head !== e3 && (e3 === this.tail ? (this.tail = t3.next, this.cache[this.tail].prev = null) : this.cache[t3.prev].next = t3.next, this.cache[t3.next].prev = t3.prev, this.cache[this.head].next = e3, t3.prev = this.head, t3.next = null, this.head = e3), t3.value;
    }
  }, r2.prototype.evict = function() {
    if (this.tail) {
      var e3 = this.tail, t3 = this.remove(this.tail);
      this.emit("evict", { key: e3, value: t3 });
    }
  };
}, 8499: (e2, t2, i2) => {
  const { TokenBucket: s2 } = i2(9439), n2 = i2(8765);
  e2.exports = class {
    constructor(e3 = {}) {
      if ("object" != typeof e3) throw new Error("Options must be an object");
      this.throttles = [], this.setEnabled(e3.enabled), this.setRate(e3.rate, e3.chunksize);
    }
    getEnabled() {
      return this._enabled;
    }
    getRate() {
      return this.bucket.tokensPerInterval;
    }
    getChunksize() {
      return this.chunksize;
    }
    setEnabled(e3 = true) {
      if ("boolean" != typeof e3) throw new Error("Enabled must be a boolean");
      this._enabled = e3;
      for (const t3 of this.throttles) t3.setEnabled(e3);
    }
    setRate(e3, t3 = null) {
      if (!Number.isInteger(e3) || e3 < 0) throw new Error("Rate must be an integer bigger than zero");
      if (e3 = parseInt(e3), t3 && ("number" != typeof t3 || t3 <= 0)) throw new Error("Chunksize must be bigger than zero");
      if (t3 = t3 || Math.max(parseInt(e3 / 10), 1), t3 = parseInt(t3), e3 > 0 && t3 > e3) throw new Error("Chunk size must be smaller than rate");
      this.bucket || (this.bucket = new s2(e3, e3, "second", null)), this.bucket.bucketSize = e3, this.bucket.tokensPerInterval = e3, this.chunksize = t3;
    }
    setChunksize(e3) {
      if (!Number.isInteger(e3) || e3 <= 0) throw new Error("Chunk size must be an integer bigger than zero");
      const t3 = this.getRate();
      if (e3 = parseInt(e3), t3 > 0 && e3 > t3) throw new Error("Chunk size must be smaller than rate");
      this.chunksize = e3;
    }
    throttle(e3 = {}) {
      if ("object" != typeof e3) throw new Error("Options must be an object");
      return new n2({ ...e3, group: this });
    }
    destroy() {
      for (const e3 of this.throttles) e3.destroy();
      this.throttles = [];
    }
    _addThrottle(e3) {
      if (!(e3 instanceof n2)) throw new Error("Throttle must be an instance of Throttle");
      this.throttles.push(e3);
    }
    _removeThrottle(e3) {
      const t3 = this.throttles.indexOf(e3);
      t3 > -1 && this.throttles.splice(t3, 1);
    }
  };
}, 8673: (e2) => {
  function t2() {
    this._types = /* @__PURE__ */ Object.create(null), this._extensions = /* @__PURE__ */ Object.create(null);
    for (let e3 = 0; e3 < arguments.length; e3++) this.define(arguments[e3]);
    this.define = this.define.bind(this), this.getType = this.getType.bind(this), this.getExtension = this.getExtension.bind(this);
  }
  t2.prototype.define = function(e3, t3) {
    for (let i2 in e3) {
      let s2 = e3[i2].map(function(e4) {
        return e4.toLowerCase();
      });
      i2 = i2.toLowerCase();
      for (let e4 = 0; e4 < s2.length; e4++) {
        const n2 = s2[e4];
        if ("*" !== n2[0]) {
          if (!t3 && n2 in this._types) throw new Error('Attempt to change mapping for "' + n2 + '" extension from "' + this._types[n2] + '" to "' + i2 + '". Pass `force=true` to allow this, otherwise remove "' + n2 + '" from the list of extensions for "' + i2 + '".');
          this._types[n2] = i2;
        }
      }
      if (t3 || !this._extensions[i2]) {
        const e4 = s2[0];
        this._extensions[i2] = "*" !== e4[0] ? e4 : e4.substr(1);
      }
    }
  }, t2.prototype.getType = function(e3) {
    let t3 = (e3 = String(e3)).replace(/^.*[/\\]/, "").toLowerCase(), i2 = t3.replace(/^.*\./, "").toLowerCase(), s2 = t3.length < e3.length;
    return (i2.length < t3.length - 1 || !s2) && this._types[i2] || null;
  }, t2.prototype.getExtension = function(e3) {
    return (e3 = /^\s*([^;\s]*)/.test(e3) && RegExp.$1) && this._extensions[e3.toLowerCase()] || null;
  }, e2.exports = t2;
}, 8727: (e2) => {
  function t2(e3) {
    return parseInt(e3, 10) === e3;
  }
  function i2(e3) {
    function i3(t3) {
      if (void 0 === t3) {
        t3 = new Array(e3);
        for (var i4 = 0; i4 < e3; i4++) t3[i4] = Math.floor(Math.random() * e3);
      } else if ("string" == typeof t3) t3 = (t3 = "" + t3).split("").map(function(t4) {
        return t4.charCodeAt(0) % e3;
      });
      else {
        if (!Array.isArray(t3)) throw new TypeError("invalid seed key specified");
        if (!t3.every(function(e4) {
          return "number" == typeof e4 && e4 === (0 | e4);
        })) throw new TypeError("invalid seed key specified: not array of integers");
      }
      for (var s4 = t3.length, n3 = (function() {
        for (var t4 = new Array(e3), i5 = 0; i5 < e3; i5++) t4[i5] = i5;
        return t4;
      })(), r3 = 0, o3 = 0; o3 < e3; o3++) {
        r3 = (r3 + n3[o3] + t3[o3 % s4]) % e3;
        var a3 = n3[o3];
        n3[o3] = n3[r3], n3[r3] = a3;
      }
      return n3;
    }
    function s3(e4) {
      this.s = i3(e4), this.i = 0, this.j = 0;
    }
    return s3.prototype.randomNative = function() {
      this.i = (this.i + 1) % e3, this.j = (this.j + this.s[this.i]) % e3;
      var t3 = this.s[this.i];
      return this.s[this.i] = this.s[this.j], this.s[this.j] = t3, this.s[(this.s[this.i] + this.s[this.j]) % e3];
    }, s3.prototype.randomUInt32 = function() {
      return 256 * (256 * (256 * this.randomByte() + this.randomByte()) + this.randomByte()) + this.randomByte();
    }, s3.prototype.randomFloat = function() {
      return this.randomUInt32() / 4294967296;
    }, s3.prototype.random = function() {
      var e4, i4;
      if (1 === arguments.length) e4 = 0, i4 = arguments[0];
      else {
        if (2 !== arguments.length) throw new TypeError("random takes one or two integer arguments");
        e4 = arguments[0], i4 = arguments[1];
      }
      if (!t2(e4) || !t2(i4)) throw new TypeError("random takes one or two integer arguments");
      return e4 + this.randomUInt32() % (i4 - e4 + 1);
    }, s3.prototype.currentState = function() {
      return { i: this.i, j: this.j, s: this.s.slice() };
    }, s3.prototype.setState = function(t3) {
      var i4 = t3.s, s4 = t3.i, n3 = t3.j;
      if (!(s4 === (0 | s4) && 0 <= s4 && s4 < e3)) throw new Error("state.i should be integer [0, " + (e3 - 1) + "]");
      if (!(n3 === (0 | n3) && 0 <= n3 && n3 < e3)) throw new Error("state.j should be integer [0, " + (e3 - 1) + "]");
      if (!Array.isArray(i4) || i4.length !== e3) throw new Error("state should be array of length " + e3);
      for (var r3 = 0; r3 < e3; r3++) if (-1 === i4.indexOf(r3)) throw new Error("state should be permutation of 0.." + (e3 - 1) + ": " + r3 + " is missing");
      this.i = s4, this.j = n3, this.s = i4.slice();
    }, s3;
  }
  var s2 = i2(256);
  s2.prototype.randomByte = s2.prototype.randomNative;
  var n2 = i2(16);
  n2.prototype.randomByte = function() {
    return 16 * this.randomNative() + this.randomNative();
  };
  var r2 = "a".charCodeAt(0), o2 = "0".charCodeAt(0);
  function a2(e3) {
    return e3 < 10 ? String.fromCharCode(o2 + e3) : String.fromCharCode(r2 + e3 - 10);
  }
  function h2(e3) {
    return parseInt(e3, 16);
  }
  n2.prototype.currentStateString = function() {
    var e3 = this.currentState();
    return a2(e3.i) + a2(e3.j) + e3.s.map(a2).join("");
  }, n2.prototype.setStateString = function(e3) {
    if (!e3.match(/^[0-9a-f]{18}$/)) throw new TypeError("RC4small stateString should be 18 hex character string");
    var t3 = h2(e3[0]), i3 = h2(e3[1]), s3 = e3.split("").slice(2).map(h2);
    this.setState({ i: t3, j: i3, s: s3 });
  }, s2.RC4small = n2, e2.exports = s2;
}, 8765: (e2, t2, i2) => {
  const { EventEmitter: s2 } = i2(7007), { Transform: n2 } = i2(8179), { wait: r2 } = i2(2072);
  e2.exports = class extends n2 {
    constructor(e3 = {}) {
      if (super(), "object" != typeof e3) throw new Error("Options must be an object");
      const t3 = Object.assign({}, e3);
      if (t3.group && !(t3.group instanceof o2)) throw new Error("Group must be an instanece of ThrottleGroup");
      t3.group || (t3.group = new o2(t3)), this._setEnabled(t3.enabled || t3.group.enabled), this._group = t3.group, this._emitter = new s2(), this._destroyed = false, this._group._addThrottle(this);
    }
    getEnabled() {
      return this._enabled;
    }
    getGroup() {
      return this._group;
    }
    _setEnabled(e3 = true) {
      if ("boolean" != typeof e3) throw new Error("Enabled must be a boolean");
      this._enabled = e3;
    }
    setEnabled(e3) {
      this._setEnabled(e3), this._enabled ? this._emitter.emit("enabled") : this._emitter.emit("disabled");
    }
    _transform(e3, t3) {
      this._processChunk(e3, t3);
    }
    async _waitForTokens(e3) {
      return new Promise((t3, i3) => {
        let s3 = false;
        const n3 = this;
        function r3(e4) {
          if (n3._emitter.removeListener("disabled", r3), n3._emitter.removeListener("destroyed", r3), !s3) {
            if (s3 = true, e4) return i3(e4);
            t3();
          }
        }
        this._emitter.once("disabled", r3), this._emitter.once("destroyed", r3), this._group.bucket.removeTokens(e3, r3);
      });
    }
    _areBothEnabled() {
      return this._enabled && this._group.getEnabled();
    }
    async _processChunk(e3, t3) {
      if (!this._areBothEnabled()) return t3(null, e3);
      let i3 = 0, s3 = this._group.getChunksize(), n3 = e3.slice(i3, i3 + s3);
      for (; n3.length > 0; ) {
        if (this._areBothEnabled()) try {
          for (; 0 === this._group.getRate() && !this._destroyed && this._areBothEnabled(); ) if (await r2(1e3), this._destroyed) return;
          if (this._areBothEnabled() && !this._group.bucket.tryRemoveTokens(n3.length) && (await this._waitForTokens(n3.length), this._destroyed)) return;
        } catch (e4) {
          return t3(e4);
        }
        this.push(n3), i3 += s3, s3 = this._areBothEnabled() ? this._group.getChunksize() : e3.length - i3, n3 = e3.slice(i3, i3 + s3);
      }
      return t3();
    }
    destroy(...e3) {
      this._group._removeThrottle(this), this._destroyed = true, this._emitter.emit("destroyed"), super.destroy(...e3);
    }
  };
  const o2 = i2(8499);
}, 8878: () => {
}, 9439: (e2, t2, i2) => {
  t2.RateLimiter = i2(3065), t2.TokenBucket = i2(5472);
}, 9596: (e2) => {
  let t2;
  e2.exports = "function" == typeof queueMicrotask ? queueMicrotask.bind("undefined" != typeof window ? window : globalThis) : (e3) => (t2 || (t2 = Promise.resolve())).then(e3).catch((e4) => setTimeout(() => {
    throw e4;
  }, 0));
}, 9639: (e2, t2, i2) => {
  i2.d(t2, { NJ: () => g2, V5: () => o2, dU: () => f2, HB: () => y2, xW: () => h2, LC: () => l2, tW: () => S2, fk: () => a2, Ht: () => w2, po: () => E2, L0: () => _2 });
  const s2 = "0123456789abcdef", n2 = [], r2 = [];
  for (let e3 = 0; e3 < 256; e3++) n2[e3] = s2[e3 >> 4 & 15] + s2[15 & e3], e3 < 16 && (e3 < 10 ? r2[48 + e3] = e3 : r2[87 + e3] = e3);
  const o2 = (e3) => {
    const t3 = e3.length;
    let i3 = "", s3 = 0;
    for (; s3 < t3; ) i3 += n2[e3[s3++]];
    return i3;
  }, a2 = (e3) => {
    const t3 = e3.length >> 1, i3 = t3 << 1, s3 = new Uint8Array(t3);
    let n3 = 0, o3 = 0;
    for (; o3 < i3; ) s3[n3++] = r2[e3.charCodeAt(o3++)] << 4 | r2[e3.charCodeAt(o3++)];
    return s3;
  }, h2 = (e3, t3 = 0) => {
    const i3 = e3.length || 0;
    if (!t3) {
      let s4 = i3;
      for (; s4--; ) t3 += e3[s4].length;
    }
    const s3 = new Uint8Array(t3);
    let n3 = t3, r3 = i3;
    for (; r3--; ) n3 -= e3[r3].length, s3.set(e3[r3], n3);
    return s3;
  }, l2 = (e3, t3) => {
    if (e3.length !== t3.length) return false;
    for (let i3 = e3.length; i3 > -1; i3 -= 1) if (e3[i3] !== t3[i3]) return false;
    return true;
  };
  for (var c2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", d2 = "undefined" == typeof Uint8Array ? [] : new Uint8Array(256), u2 = 0; u2 < 64; u2++) d2[c2.charCodeAt(u2)] = u2;
  const p2 = new TextDecoder(), f2 = (e3, t3) => {
    if (!t3) return p2.decode(e3);
    return new TextDecoder(t3).decode(e3);
  }, m2 = new TextEncoder(), _2 = (e3) => m2.encode(e3), g2 = (e3) => (function(e4) {
    var t3, i3 = new Uint8Array(e4), s3 = i3.length, n3 = "";
    for (t3 = 0; t3 < s3; t3 += 3) n3 += c2[i3[t3] >> 2], n3 += c2[(3 & i3[t3]) << 4 | i3[t3 + 1] >> 4], n3 += c2[(15 & i3[t3 + 1]) << 2 | i3[t3 + 2] >> 6], n3 += c2[63 & i3[t3 + 2]];
    return s3 % 3 == 2 ? n3 = n3.substring(0, n3.length - 1) + "=" : s3 % 3 == 1 && (n3 = n3.substring(0, n3.length - 2) + "=="), n3;
  })(e3), y2 = (e3) => {
    let t3, i3 = "", n3 = 0;
    const r3 = e3.length;
    for (; n3 < r3; ) t3 = e3.charCodeAt(n3++), i3 += s2[t3 >> 4] + s2[15 & t3];
    return i3;
  }, w2 = (e3) => {
    const t3 = a2(e3);
    if (t3.length <= 65536) return String.fromCharCode(...t3);
    let i3 = "", s3 = 0;
    for (; s3 < t3.length; ) i3 += String.fromCharCode(...t3.subarray(s3, s3 += 65536));
    return i3;
  }, b2 = "undefined" != typeof window ? window : self, v2 = b2.crypto || b2.msCrypto || {}, k2 = v2.subtle || v2.webkitSubtle, x2 = { hex: o2, base64: g2 }, S2 = async (e3, t3, i3 = "sha-1") => {
    if (!k2) throw new Error("no web crypto support");
    "string" == typeof e3 && (e3 = _2(e3));
    const s3 = new Uint8Array(await k2.digest(i3, e3));
    return t3 ? x2[t3](s3) : s3;
  }, E2 = (e3) => {
    const t3 = new Uint8Array(e3);
    return v2.getRandomValues(t3);
  };
} };
var s = {};
function n(e2) {
  var t2 = s[e2];
  if (void 0 !== t2) return t2.exports;
  var r2 = s[e2] = { exports: {} };
  return i[e2](r2, r2.exports, n), r2.exports;
}
t = Object.getPrototypeOf ? (e2) => Object.getPrototypeOf(e2) : (e2) => e2.__proto__, n.t = function(i2, s2) {
  if (1 & s2 && (i2 = this(i2)), 8 & s2) return i2;
  if ("object" == typeof i2 && i2) {
    if (4 & s2 && i2.__esModule) return i2;
    if (16 & s2 && "function" == typeof i2.then) return i2;
  }
  var r2 = /* @__PURE__ */ Object.create(null);
  n.r(r2);
  var o2 = {};
  e = e || [null, t({}), t([]), t(t)];
  for (var a2 = 2 & s2 && i2; ("object" == typeof a2 || "function" == typeof a2) && !~e.indexOf(a2); a2 = t(a2)) Object.getOwnPropertyNames(a2).forEach((e2) => o2[e2] = () => i2[e2]);
  return o2.default = () => i2, n.d(r2, o2), r2;
}, n.d = (e2, t2) => {
  for (var i2 in t2) n.o(t2, i2) && !n.o(e2, i2) && Object.defineProperty(e2, i2, { enumerable: true, get: t2[i2] });
}, n.o = (e2, t2) => Object.prototype.hasOwnProperty.call(e2, t2), n.r = (e2) => {
  "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(e2, Symbol.toStringTag, { value: "Module" }), Object.defineProperty(e2, "__esModule", { value: true });
};
var r = n(7007);
function o(e2) {
  if ("string" != typeof e2) throw new TypeError("Path must be a string. Received " + JSON.stringify(e2));
}
function a(e2, t2) {
  let i2, s2 = "", n2 = 0, r2 = -1, o2 = 0;
  for (let a2 = 0; a2 <= e2.length; ++a2) {
    if (a2 < e2.length) i2 = e2.charCodeAt(a2);
    else {
      if (47 === i2) break;
      i2 = 47;
    }
    if (47 === i2) {
      if (r2 === a2 - 1 || 1 === o2) ;
      else if (r2 !== a2 - 1 && 2 === o2) {
        if (s2.length < 2 || 2 !== n2 || 46 !== s2.charCodeAt(s2.length - 1) || 46 !== s2.charCodeAt(s2.length - 2)) {
          if (s2.length > 2) {
            const e3 = s2.lastIndexOf("/");
            if (e3 !== s2.length - 1) {
              -1 === e3 ? (s2 = "", n2 = 0) : (s2 = s2.slice(0, e3), n2 = s2.length - 1 - s2.lastIndexOf("/")), r2 = a2, o2 = 0;
              continue;
            }
          } else if (2 === s2.length || 1 === s2.length) {
            s2 = "", n2 = 0, r2 = a2, o2 = 0;
            continue;
          }
        }
        t2 && (s2.length > 0 ? s2 += "/.." : s2 = "..", n2 = 2);
      } else s2.length > 0 ? s2 += "/" + e2.slice(r2 + 1, a2) : s2 = e2.slice(r2 + 1, a2), n2 = a2 - r2 - 1;
      r2 = a2, o2 = 0;
    } else 46 === i2 && -1 !== o2 ? ++o2 : o2 = -1;
  }
  return s2;
}
function h() {
  if (0 === arguments.length) return ".";
  let e2;
  for (let t2 = 0; t2 < arguments.length; ++t2) {
    const i2 = arguments[t2];
    o(i2), i2.length > 0 && (void 0 === e2 ? e2 = i2 : e2 += "/" + i2);
  }
  return void 0 === e2 ? "." : (function(e3) {
    if (o(e3), 0 === e3.length) return ".";
    const t2 = 47 === e3.charCodeAt(0), i2 = 47 === e3.charCodeAt(e3.length - 1);
    return 0 !== (e3 = a(e3, !t2)).length || t2 || (e3 = "."), e3.length > 0 && i2 && (e3 += "/"), t2 ? "/" + e3 : e3;
  })(e2);
}
n(717);
var l = "/";
var c = n(988);
var d = n(1467);
var u = n(8444);
var p = n(2123);
var f = new RegExp(["^npm-debug\\.log$", "^\\..*\\.swp$", "^\\.DS_Store$", "^\\.AppleDouble$", "^\\.LSOverride$", "^Icon\\r$", "^\\._.*", "^\\.Spotlight-V100(?:$|\\/)", "\\.Trashes", "^__MACOSX$", "~$", "^Thumbs\\.db$", "^ehthumbs\\.db$", "^[Dd]esktop\\.ini$", "@eaDir$"].join("|"));
function m(e2) {
  return f.test(e2);
}
var _ = n(405);
var g = n(8190);
var y = n(9596);
var w = n(9639);
var b = (n(3468), n(2532));
var v = [["udp://tracker.leechers-paradise.org:6969"], ["udp://tracker.coppersurfer.tk:6969"], ["udp://tracker.opentrackr.org:1337"], ["udp://explodie.org:6969"], ["udp://tracker.empire-js.us:1337"], ["wss://tracker.btorrent.xyz"], ["wss://tracker.openwebtorrent.com"], ["wss://tracker.webtorrent.dev"]];
var k = /* @__PURE__ */ Symbol("itemPath");
function x(e2, t2, i2) {
  var s2;
  if (s2 = e2, "undefined" != typeof FileList && s2 instanceof FileList && (e2 = Array.from(e2)), Array.isArray(e2) || (e2 = [e2]), 0 === e2.length) throw new Error("invalid input type");
  e2.forEach((e3) => {
    if (null == e3) throw new Error(`invalid input type: ${e3}`);
  }), 1 !== (e2 = e2.map((e3) => C(e3) && "string" == typeof e3.path && "function" == typeof b ? e3.path : e3)).length || "string" == typeof e2[0] || e2[0].name || (e2[0].name = t2.name);
  let n2 = null;
  e2.forEach((t3, i3) => {
    if ("string" == typeof t3) return;
    let s3 = t3.fullPath || t3.name;
    s3 || (s3 = `Unknown File ${i3 + 1}`, t3.unknownName = true), t3[k] = s3.split("/"), t3[k][0] || t3[k].shift(), t3[k].length < 2 ? n2 = null : 0 === i3 && e2.length > 1 ? n2 = t3[k][0] : t3[k][0] !== n2 && (n2 = null);
  });
  (void 0 === t2.filterJunkFiles || t2.filterJunkFiles) && (e2 = e2.filter((e3) => "string" == typeof e3 || !(function(e4) {
    const t3 = e4[e4.length - 1];
    return "." === t3[0] && m(t3);
  })(e3[k]))), n2 && e2.forEach((e3) => {
    const t3 = (ArrayBuffer.isView(e3) || P(e3)) && !e3[k];
    "string" == typeof e3 || t3 || e3[k].shift();
  }), !t2.name && n2 && (t2.name = n2), t2.name || e2.some((e3) => "string" == typeof e3 ? (t2.name = (function(e4, t3) {
    if (void 0 !== t3 && "string" != typeof t3) throw new TypeError('"ext" argument must be a string');
    o(e4);
    let i3, s3 = 0, n3 = -1, r3 = true;
    if (void 0 !== t3 && t3.length > 0 && t3.length <= e4.length) {
      if (t3.length === e4.length && t3 === e4) return "";
      let o2 = t3.length - 1, a3 = -1;
      for (i3 = e4.length - 1; i3 >= 0; --i3) {
        const h3 = e4.charCodeAt(i3);
        if (47 === h3) {
          if (!r3) {
            s3 = i3 + 1;
            break;
          }
        } else -1 === a3 && (r3 = false, a3 = i3 + 1), o2 >= 0 && (h3 === t3.charCodeAt(o2) ? -1 === --o2 && (n3 = i3) : (o2 = -1, n3 = a3));
      }
      return s3 === n3 ? n3 = a3 : -1 === n3 && (n3 = e4.length), e4.slice(s3, n3);
    }
    for (i3 = e4.length - 1; i3 >= 0; --i3) if (47 === e4.charCodeAt(i3)) {
      if (!r3) {
        s3 = i3 + 1;
        break;
      }
    } else -1 === n3 && (r3 = false, n3 = i3 + 1);
    return -1 === n3 ? "" : e4.slice(s3, n3);
  })(e3), true) : !e3.unknownName && (t2.name = e3[k][e3[k].length - 1], true)), t2.name || (t2.name = `Unnamed Torrent ${Date.now()}`), t2.maxPieceLength || (t2.maxPieceLength = 4194304);
  const r2 = e2.reduce((e3, t3) => e3 + Number("string" == typeof t3), 0);
  let a2 = 1 === e2.length;
  if (1 === e2.length && "string" == typeof e2[0]) {
    if ("function" != typeof b) throw new Error("filesystem paths do not work in the browser");
    p(e2[0], (e3, t3) => {
      if (e3) return i2(e3);
      a2 = t3, h2();
    });
  } else y(h2);
  function h2() {
    g(e2.map((e3) => (t3) => {
      const i3 = {};
      if (C(e3)) i3.getStream = e3.stream(), i3.length = e3.size;
      else if (ArrayBuffer.isView(e3)) i3.getStream = [e3], i3.length = e3.length;
      else {
        if (!P(e3)) {
          if ("string" == typeof e3) {
            if ("function" != typeof b) throw new Error("filesystem paths do not work in the browser");
            return void b(e3, r2 > 1 || a2, t3);
          }
          throw new Error("invalid input type");
        }
        i3.getStream = (async function* (e4, t4) {
          for await (const i4 of e4) t4.length += i4.length, yield i4;
        })(e3, i3), i3.length = 0;
      }
      i3.path = e3[k], t3(null, i3);
    }), (e3, t3) => {
      if (e3) return i2(e3);
      t3 = t3.flat(), i2(null, t3, a2);
    });
  }
}
var S = 5;
function E(e2, t2) {
  return e2 + t2.length;
}
function C(e2) {
  return "undefined" != typeof Blob && e2 instanceof Blob;
}
function P(e2) {
  return "object" == typeof e2 && null != e2 && "function" == typeof e2.pipe;
}
var A = function(e2, t2, i2) {
  "function" == typeof t2 && ([t2, i2] = [i2, t2]), x(e2, t2 = t2 ? Object.assign({}, t2) : {}, (e3, s2, n2) => {
    if (e3) return i2(e3);
    t2.singleFileTorrent = n2, (function(e4, t3, i3) {
      let s3 = t3.announceList;
      s3 || ("string" == typeof t3.announce ? s3 = [[t3.announce]] : Array.isArray(t3.announce) && (s3 = t3.announce.map((e5) => [e5])));
      s3 || (s3 = []);
      globalThis.WEBTORRENT_ANNOUNCE && ("string" == typeof globalThis.WEBTORRENT_ANNOUNCE ? s3.push([[globalThis.WEBTORRENT_ANNOUNCE]]) : Array.isArray(globalThis.WEBTORRENT_ANNOUNCE) && (s3 = s3.concat(globalThis.WEBTORRENT_ANNOUNCE.map((e5) => [e5]))));
      void 0 === t3.announce && void 0 === t3.announceList && (s3 = s3.concat(v));
      "string" == typeof t3.urlList && (t3.urlList = [t3.urlList]);
      const n3 = { info: { name: t3.name }, "creation date": Math.ceil((Number(t3.creationDate) || Date.now()) / 1e3), encoding: "UTF-8" };
      0 !== s3.length && (n3.announce = s3[0][0], n3["announce-list"] = s3);
      void 0 !== t3.comment && (n3.comment = t3.comment);
      void 0 !== t3.createdBy && (n3["created by"] = t3.createdBy);
      void 0 !== t3.private && (n3.info.private = Number(t3.private));
      void 0 !== t3.info && Object.assign(n3.info, t3.info);
      void 0 !== t3.sslCert && (n3.info["ssl-cert"] = t3.sslCert);
      void 0 !== t3.urlList && (n3["url-list"] = t3.urlList);
      const r2 = e4.reduce(E, 0), o2 = t3.pieceLength || Math.min(u(r2), t3.maxPieceLength);
      n3.info["piece length"] = o2, (async function(e5, t4, i4, s4, n4) {
        const r3 = [];
        let o3 = 0, a2 = 0;
        const h2 = e5.map((e6) => e6.getStream), l2 = s4.onProgress;
        let c2 = 0, u2 = 0, p2 = false;
        const f2 = d(_(h2), t4, { zeroPadding: false });
        try {
          for await (const e6 of f2) await new Promise((t5) => {
            o3 += e6.length;
            const s5 = u2;
            ++u2, ++c2 < S && t5(), (0, w.tW)(e6, "hex").then((h3) => {
              r3[s5] = h3, --c2, a2 += e6.length, l2 && l2(a2, i4), t5(), p2 && 0 === c2 && n4(null, (0, w.fk)(r3.join("")), o3);
            });
          });
          if (0 === c2) return n4(null, (0, w.fk)(r3.join("")), o3);
          p2 = true;
        } catch (e6) {
          n4(e6);
        }
      })(e4, o2, r2, t3, (s4, r3, o3) => {
        if (s4) return i3(s4);
        n3.info.pieces = r3, e4.forEach((e5) => {
          delete e5.getStream;
        }), t3.singleFileTorrent ? n3.info.length = o3 : n3.info.files = e4, i3(null, c.A.encode(n3));
      });
    })(s2, t2, i2);
  });
};
var T = n(7833);
var I = n(6664);
var L = n(1827);
var O = n(3208);
self.Blob, self.File, self.FormData, self.Headers, self.Request, self.Response, self.AbortController, self.AbortSignal;
var R = self.fetch || (() => {
  throw new Error("global fetch is not available!");
});
var H = [255, 255, 26, 27, 28, 29, 30, 31, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 255, 255, 255, 255, 255, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 255, 255, 255, 255, 255];
var N = function(e2) {
  if (!ArrayBuffer.isView(e2) && "string" != typeof e2) throw new TypeError("base32.decode only takes Buffer or string as parameter");
  let t2, i2 = 0, s2 = 0, n2 = 0;
  ArrayBuffer.isView(e2) || (e2 = (0, w.L0)(e2));
  const r2 = new Uint8Array(Math.ceil(5 * e2.length / 8));
  for (let o2 = 0; o2 < e2.length && 61 !== e2[o2]; o2++) {
    const a2 = e2[o2] - 48;
    if (!(a2 < H.length)) throw new Error("Invalid input - it is not base32 encoded string");
    s2 = H[a2], i2 <= 3 ? (i2 = (i2 + 5) % 8, 0 === i2 ? (t2 |= s2, r2[n2] = t2, n2++, t2 = 0) : t2 |= 255 & s2 << 8 - i2) : (i2 = (i2 + 5) % 8, t2 |= 255 & s2 >>> i2, r2[n2] = t2, n2++, t2 = 255 & s2 << 8 - i2);
  }
  return r2.subarray(0, n2);
};
function M(e2) {
  return e2.reduce((e3, t2, i2, s2) => {
    const n2 = t2.split("-").map((e4) => parseInt(e4));
    return e3.concat(((e4, t3 = e4) => Array.from({ length: t3 - e4 + 1 }, (t4, i3) => i3 + e4))(...n2));
  }, []);
}
var F = function(e2) {
  const t2 = {}, i2 = e2.split("magnet:?")[1];
  let s2;
  if ((i2 && i2.length >= 0 ? i2.split("&") : []).forEach((e3) => {
    const i3 = e3.split("=");
    if (2 !== i3.length) return;
    const s3 = i3[0];
    let n2 = i3[1];
    "dn" === s3 && (n2 = decodeURIComponent(n2).replace(/\+/g, " ")), "tr" !== s3 && "xs" !== s3 && "as" !== s3 && "ws" !== s3 || (n2 = decodeURIComponent(n2)), "kt" === s3 && (n2 = decodeURIComponent(n2).split("+")), "ix" === s3 && (n2 = Number(n2)), "so" === s3 && (n2 = M(decodeURIComponent(n2).split(","))), t2[s3] ? (Array.isArray(t2[s3]) || (t2[s3] = [t2[s3]]), t2[s3].push(n2)) : t2[s3] = n2;
  }), t2.xt) {
    (Array.isArray(t2.xt) ? t2.xt : [t2.xt]).forEach((e3) => {
      (s2 = e3.match(/^urn:btih:(.{40})/)) ? t2.infoHash = s2[1].toLowerCase() : (s2 = e3.match(/^urn:btih:(.{32})/)) ? t2.infoHash = (0, w.V5)(N(s2[1])) : (s2 = e3.match(/^urn:btmh:1220(.{64})/)) && (t2.infoHashV2 = s2[1].toLowerCase());
    });
  }
  if (t2.xs) {
    (Array.isArray(t2.xs) ? t2.xs : [t2.xs]).forEach((e3) => {
      (s2 = e3.match(/^urn:btpk:(.{64})/)) && (t2.publicKey = s2[1].toLowerCase());
    });
  }
  return t2.infoHash && (t2.infoHashBuffer = (0, w.fk)(t2.infoHash)), t2.infoHashV2 && (t2.infoHashV2Buffer = (0, w.fk)(t2.infoHashV2)), t2.publicKey && (t2.publicKeyBuffer = (0, w.fk)(t2.publicKey)), t2.dn && (t2.name = t2.dn), t2.kt && (t2.keywords = t2.kt), t2.announce = [], ("string" == typeof t2.tr || Array.isArray(t2.tr)) && (t2.announce = t2.announce.concat(t2.tr)), t2.urlList = [], ("string" == typeof t2.as || Array.isArray(t2.as)) && (t2.urlList = t2.urlList.concat(t2.as)), ("string" == typeof t2.ws || Array.isArray(t2.ws)) && (t2.urlList = t2.urlList.concat(t2.ws)), t2.peerAddresses = [], ("string" == typeof t2["x.pe"] || Array.isArray(t2["x.pe"])) && (t2.peerAddresses = t2.peerAddresses.concat(t2["x.pe"])), t2.announce = Array.from(new Set(t2.announce)), t2.urlList = Array.from(new Set(t2.urlList)), t2.peerAddresses = Array.from(new Set(t2.peerAddresses)), t2;
};
async function U(e2) {
  if ("string" == typeof e2 && /^(stream-)?magnet:/.test(e2)) {
    const t2 = F(e2);
    if (!t2.infoHash) throw new Error("Invalid torrent identifier");
    return t2;
  }
  if ("string" == typeof e2 && (/^[a-f0-9]{40}$/i.test(e2) || /^[a-z2-7]{32}$/i.test(e2))) return F(`magnet:?xt=urn:btih:${e2}`);
  if (ArrayBuffer.isView(e2) && 20 === e2.length) return F(`magnet:?xt=urn:btih:${(0, w.V5)(e2)}`);
  if (ArrayBuffer.isView(e2)) return await (async function(e3) {
    ArrayBuffer.isView(e3) && (e3 = c.A.decode(e3));
    D(e3.info, "info"), D(e3.info["name.utf-8"] || e3.info.name, "info.name"), D(e3.info["piece length"], "info['piece length']"), D(e3.info.pieces, "info.pieces"), e3.info.files ? e3.info.files.forEach((e4) => {
      D("number" == typeof e4.length, "info.files[0].length"), D(e4["path.utf-8"] || e4.path, "info.files[0].path");
    }) : D("number" == typeof e3.info.length, "info.length");
    const t2 = { info: e3.info, infoBuffer: c.A.encode(e3.info), name: (0, w.dU)(e3.info["name.utf-8"] || e3.info.name), announce: [] };
    t2.infoHashBuffer = await (0, w.tW)(t2.infoBuffer), t2.infoHash = (0, w.V5)(t2.infoHashBuffer), void 0 !== e3.info.private && (t2.private = !!e3.info.private);
    e3["creation date"] && (t2.created = new Date(1e3 * e3["creation date"]));
    e3["created by"] && (t2.createdBy = (0, w.dU)(e3["created by"]));
    ArrayBuffer.isView(e3.comment) && (t2.comment = (0, w.dU)(e3.comment));
    Array.isArray(e3["announce-list"]) && e3["announce-list"].length > 0 ? e3["announce-list"].forEach((e4) => {
      e4.forEach((e5) => {
        t2.announce.push((0, w.dU)(e5));
      });
    }) : e3.announce && t2.announce.push((0, w.dU)(e3.announce));
    ArrayBuffer.isView(e3["url-list"]) && (e3["url-list"] = e3["url-list"].length > 0 ? [e3["url-list"]] : []);
    t2.urlList = (e3["url-list"] || []).map((e4) => (0, w.dU)(e4)), t2.announce = Array.from(new Set(t2.announce)), t2.urlList = Array.from(new Set(t2.urlList));
    const i2 = e3.info.files || [e3.info];
    t2.files = i2.map((e4, s3) => {
      const n2 = [].concat(t2.name, e4["path.utf-8"] || e4.path || []).map((e5) => ArrayBuffer.isView(e5) ? (0, w.dU)(e5) : e5);
      return { path: h.apply(null, [l].concat(n2)).slice(1), name: n2[n2.length - 1], length: e4.length, offset: i2.slice(0, s3).reduce(B, 0) };
    }), t2.length = i2.reduce(B, 0);
    const s2 = t2.files[t2.files.length - 1];
    return t2.pieceLength = e3.info["piece length"], t2.lastPieceLength = (s2.offset + s2.length) % t2.pieceLength || t2.pieceLength, t2.pieces = (function(e4) {
      const t3 = [];
      for (let i3 = 0; i3 < e4.length; i3 += 20) t3.push((0, w.V5)(e4.slice(i3, i3 + 20)));
      return t3;
    })(e3.info.pieces), t2;
  })(e2);
  if (e2 && e2.infoHash) return e2.infoHash = e2.infoHash.toLowerCase(), e2.announce || (e2.announce = []), "string" == typeof e2.announce && (e2.announce = [e2.announce]), e2.urlList || (e2.urlList = []), e2;
  throw new Error("Invalid torrent identifier");
}
async function j(e2, t2, i2) {
  if ("function" == typeof t2) return j(e2, {}, t2);
  if ("function" != typeof i2) throw new Error("second argument must be a Function");
  let s2;
  try {
    s2 = await U(e2);
  } catch (e3) {
  }
  if (s2 && s2.infoHash) y(() => {
    i2(null, s2);
  });
  else if (n2 = e2, "undefined" != typeof Blob && n2 instanceof Blob) try {
    r2(new Uint8Array(await e2.arrayBuffer()));
  } catch (e3) {
    return i2(new Error(`Error converting Blob: ${e3.message}`));
  }
  else if (/^https?:/.test(e2)) try {
    const i3 = await R(e2, { headers: { "user-agent": "WebTorrent (https://webtorrent.io)" }, signal: AbortSignal.timeout(3e4), ...t2 });
    r2(new Uint8Array(await i3.arrayBuffer()));
  } catch (e3) {
    return i2(new Error(`Error downloading torrent: ${e3.message}`));
  }
  else "function" == typeof O.readFile && "string" == typeof e2 ? O.readFile(e2, (e3, t3) => {
    if (e3) return i2(new Error("Invalid torrent identifier"));
    r2(t3);
  }) : y(() => {
    i2(new Error("Invalid torrent identifier"));
  });
  var n2;
  async function r2(e3) {
    try {
      s2 = await U(e3);
    } catch (e4) {
      return i2(e4);
    }
    s2 && s2.infoHash ? i2(null, s2) : i2(new Error("Invalid torrent identifier"));
  }
}
function B(e2, t2) {
  return e2 + t2.length;
}
function D(e2, t2) {
  if (!e2) throw new Error(`Torrent is missing required field: ${t2}`);
}
var q = U;
var W = function(e2) {
  e2 = Object.assign({}, e2);
  let t2 = /* @__PURE__ */ new Set();
  e2.xt && "string" == typeof e2.xt && t2.add(e2.xt), e2.xt && Array.isArray(e2.xt) && (t2 = new Set(e2.xt)), e2.infoHashBuffer && t2.add(`urn:btih:${(0, w.V5)(e2.infoHashBuffer)}`), e2.infoHash && t2.add(`urn:btih:${e2.infoHash}`), e2.infoHashV2Buffer && t2.add(e2.xt = `urn:btmh:1220${(0, w.V5)(e2.infoHashV2Buffer)}`), e2.infoHashV2 && t2.add(`urn:btmh:1220${e2.infoHashV2}`);
  const i2 = Array.from(t2);
  1 === i2.length && (e2.xt = i2[0]), i2.length > 1 && (e2.xt = i2), e2.publicKeyBuffer && (e2.xs = `urn:btpk:${(0, w.V5)(e2.publicKeyBuffer)}`), e2.publicKey && (e2.xs = `urn:btpk:${e2.publicKey}`), e2.name && (e2.dn = e2.name), e2.keywords && (e2.kt = e2.keywords), e2.announce && (e2.tr = e2.announce), e2.urlList && (e2.ws = e2.urlList, delete e2.as), e2.peerAddresses && (e2["x.pe"] = e2.peerAddresses);
  let s2 = "magnet:?";
  return Object.keys(e2).filter((e3) => 2 === e3.length || "x.pe" === e3).forEach((t3, i3) => {
    const n2 = Array.isArray(e2[t3]) ? e2[t3] : [e2[t3]];
    var r2;
    n2.forEach((e3, n3) => {
      (i3 > 0 || n3 > 0) && ("kt" !== t3 && "so" !== t3 || 0 === n3) && (s2 += "&"), "dn" === t3 && (e3 = encodeURIComponent(e3).replace(/%20/g, "+")), "tr" !== t3 && "as" !== t3 && "ws" !== t3 || (e3 = encodeURIComponent(e3)), "xs" !== t3 || e3.startsWith("urn:btpk:") || (e3 = encodeURIComponent(e3)), "kt" === t3 && (e3 = encodeURIComponent(e3)), "so" !== t3 && (s2 += "kt" === t3 && n3 > 0 ? `+${e3}` : `${t3}=${e3}`);
    }), "so" === t3 && (s2 += `${t3}=${r2 = n2, r2.reduce((e3, t4, i4, s3) => (0 !== i4 && t4 === s3[i4 - 1] + 1 || e3.push([]), e3[e3.length - 1].push(t4), e3), []).map((e3) => e3.length > 1 ? `${e3[0]}-${e3[e3.length - 1]}` : `${e3[0]}`)}`);
  }), s2;
};
var $ = "undefined" != typeof window ? window : self;
var z = $.RTCPeerConnection || $.mozRTCPeerConnection || $.webkitRTCPeerConnection;
var V = $.RTCSessionDescription || $.mozRTCSessionDescription || $.webkitRTCSessionDescription;
var G = $.RTCIceCandidate || $.mozRTCIceCandidate || $.webkitRTCIceCandidate;
$.RTCIceTransport, $.RTCDataChannel, $.RTCSctpTransport, $.RTCDtlsTransport, $.RTCCertificate, $.MediaStream, $.MediaStreamTrack, $.MediaStreamTrackEvent, $.RTCPeerConnectionIceEvent, $.RTCDataChannelEvent, $.RTCTrackEvent, $.RTCError, $.RTCErrorEvent, $.RTCRtpTransceiver, $.RTCRtpReceiver, $.RTCRtpSender;
var K = n(8179);
var Y = n(6310);
var J = T("simple-peer");
var X = 65536;
function Q(e2) {
  return e2.replace(/a=ice-options:trickle\s\n/g, "");
}
var Z = class _Z extends K.Duplex {
  _pc;
  constructor(e2) {
    if (super(e2 = Object.assign({ allowHalfOpen: false }, e2)), this.__objectMode = !!e2.objectMode, this._id = (0, w.V5)((0, w.po)(4)).slice(0, 7), this._debug("new peer %o", e2), this.channelName = e2.initiator ? e2.channelName || (0, w.V5)((0, w.po)(20)) : null, this.initiator = e2.initiator || false, this.channelConfig = e2.channelConfig || _Z.channelConfig, this.channelNegotiated = this.channelConfig.negotiated, this.config = Object.assign({}, _Z.config, e2.config), this.offerOptions = e2.offerOptions || {}, this.answerOptions = e2.answerOptions || {}, this.sdpTransform = e2.sdpTransform || ((e3) => e3), this.trickle = void 0 === e2.trickle || e2.trickle, this.allowHalfTrickle = void 0 !== e2.allowHalfTrickle && e2.allowHalfTrickle, this.iceCompleteTimeout = e2.iceCompleteTimeout || 5e3, this._destroying = false, this._connected = false, this.remoteAddress = void 0, this.remoteFamily = void 0, this.remotePort = void 0, this.localAddress = void 0, this.localFamily = void 0, this.localPort = void 0, !z) throw "undefined" == typeof window ? Y(new Error("No WebRTC support: Specify `opts.wrtc` option in this environment"), "ERR_WEBRTC_SUPPORT") : Y(new Error("No WebRTC support: Not a supported browser"), "ERR_WEBRTC_SUPPORT");
    this._pcReady = false, this._channelReady = false, this._iceComplete = false, this._iceCompleteTimer = null, this._channel = null, this._pendingCandidates = [], this._isNegotiating = false, this._firstNegotiation = true, this._batchedNegotiation = false, this._queuedNegotiation = false, this._sendersAwaitingStable = [], this._closingInterval = null, this._remoteTracks = [], this._remoteStreams = [], this._chunk = null, this._cb = null, this._interval = null;
    try {
      this._pc = new z(this.config);
    } catch (e3) {
      return void this.__destroy(Y(e3, "ERR_PC_CONSTRUCTOR"));
    }
    this._isReactNativeWebrtc = "number" == typeof this._pc._peerConnectionId, this._pc.oniceconnectionstatechange = () => {
      this._onIceStateChange();
    }, this._pc.onicegatheringstatechange = () => {
      this._onIceStateChange();
    }, this._pc.onconnectionstatechange = () => {
      this._onConnectionStateChange();
    }, this._pc.onsignalingstatechange = () => {
      this._onSignalingStateChange();
    }, this._pc.onicecandidate = (e3) => {
      this._onIceCandidate(e3);
    }, "object" == typeof this._pc.peerIdentity && this._pc.peerIdentity.catch((e3) => {
      this.__destroy(Y(e3, "ERR_PC_PEER_IDENTITY"));
    }), this.initiator || this.channelNegotiated ? this._setupData({ channel: this._pc.createDataChannel(this.channelName, this.channelConfig) }) : this._pc.ondatachannel = (e3) => {
      this._setupData(e3);
    }, this._debug("initial negotiation"), this._needsNegotiation(), this._onFinishBound = () => {
      this._onFinish();
    }, this.once("finish", this._onFinishBound);
  }
  get bufferSize() {
    return this._channel && this._channel.bufferedAmount || 0;
  }
  get connected() {
    return this._connected && "open" === this._channel.readyState;
  }
  address() {
    return { port: this.localPort, family: this.localFamily, address: this.localAddress };
  }
  signal(e2) {
    if (!this._destroying) {
      if (this.destroyed) throw Y(new Error("cannot signal after peer is destroyed"), "ERR_DESTROYED");
      if ("string" == typeof e2) try {
        e2 = JSON.parse(e2);
      } catch (t2) {
        e2 = {};
      }
      this._debug("signal()"), e2.renegotiate && this.initiator && (this._debug("got request to renegotiate"), this._needsNegotiation()), e2.transceiverRequest && this.initiator && (this._debug("got request for transceiver"), this.addTransceiver(e2.transceiverRequest.kind, e2.transceiverRequest.init)), e2.candidate && (this._pc.remoteDescription && this._pc.remoteDescription.type ? this._addIceCandidate(e2.candidate) : this._pendingCandidates.push(e2.candidate)), e2.sdp && this._pc.setRemoteDescription(new V(e2)).then(() => {
        this.destroyed || (this._pendingCandidates.forEach((e3) => {
          this._addIceCandidate(e3);
        }), this._pendingCandidates = [], "offer" === this._pc.remoteDescription.type && this._createAnswer());
      }).catch((e3) => {
        this.__destroy(Y(e3, "ERR_SET_REMOTE_DESCRIPTION"));
      }), e2.sdp || e2.candidate || e2.renegotiate || e2.transceiverRequest || this.__destroy(Y(new Error("signal() called with invalid signal data"), "ERR_SIGNALING"));
    }
  }
  _addIceCandidate(e2) {
    const t2 = new G(e2);
    this._pc.addIceCandidate(t2).catch((e3) => {
      var i2;
      !t2.address || t2.address.endsWith(".local") ? (i2 = "Ignoring unsupported ICE candidate.", console.warn(i2)) : this.__destroy(Y(e3, "ERR_ADD_ICE_CANDIDATE"));
    });
  }
  send(e2) {
    if (!this._destroying) {
      if (this.destroyed) throw Y(new Error("cannot send after peer is destroyed"), "ERR_DESTROYED");
      this._channel.send(e2);
    }
  }
  _needsNegotiation() {
    this._debug("_needsNegotiation"), this._batchedNegotiation || (this._batchedNegotiation = true, queueMicrotask(() => {
      this._batchedNegotiation = false, this.initiator || !this._firstNegotiation ? (this._debug("starting batched negotiation"), this.negotiate()) : this._debug("non-initiator initial negotiation request discarded"), this._firstNegotiation = false;
    }));
  }
  negotiate() {
    if (!this._destroying) {
      if (this.destroyed) throw Y(new Error("cannot negotiate after peer is destroyed"), "ERR_DESTROYED");
      this.initiator ? this._isNegotiating ? (this._queuedNegotiation = true, this._debug("already negotiating, queueing")) : (this._debug("start negotiation"), setTimeout(() => {
        this._createOffer();
      }, 0)) : this._isNegotiating ? (this._queuedNegotiation = true, this._debug("already negotiating, queueing")) : (this._debug("requesting negotiation from initiator"), this.emit("signal", { type: "renegotiate", renegotiate: true })), this._isNegotiating = true;
    }
  }
  _final(e2) {
    this._readableState.ended || this.push(null), e2(null);
  }
  __destroy(e2) {
    this.end(), this._destroy(() => {
    }, e2);
  }
  _destroy(e2, t2) {
    this.destroyed || this._destroying || (this._destroying = true, this._debug("destroying (error: %s)", t2 && (t2.message || t2)), setTimeout(() => {
      if (this._connected && this.emit("disconnect"), this._connected = false, this._pcReady = false, this._channelReady = false, this._remoteTracks = null, this._remoteStreams = null, this._senderMap = null, clearInterval(this._closingInterval), this._closingInterval = null, clearInterval(this._interval), this._interval = null, this._chunk = null, this._cb = null, this._onFinishBound && this.removeListener("finish", this._onFinishBound), this._onFinishBound = null, this._channel) {
        try {
          this._channel.close();
        } catch (e3) {
        }
        this._channel.onmessage = null, this._channel.onopen = null, this._channel.onclose = null, this._channel.onerror = null;
      }
      if (this._pc) {
        try {
          this._pc.close();
        } catch (e3) {
        }
        this._pc.oniceconnectionstatechange = null, this._pc.onicegatheringstatechange = null, this._pc.onsignalingstatechange = null, this._pc.onicecandidate = null, this._pc.ontrack = null, this._pc.ondatachannel = null;
      }
      this._pc = null, this._channel = null, t2 && this.emit("error", t2), e2();
    }, 0));
  }
  _setupData(e2) {
    if (!e2.channel) return this.__destroy(Y(new Error("Data channel event is missing `channel` property"), "ERR_DATA_CHANNEL"));
    this._channel = e2.channel, this._channel.binaryType = "arraybuffer", "number" == typeof this._channel.bufferedAmountLowThreshold && (this._channel.bufferedAmountLowThreshold = X), this.channelName = this._channel.label, this._channel.onmessage = (e3) => {
      this._onChannelMessage(e3);
    }, this._channel.onbufferedamountlow = () => {
      this._onChannelBufferedAmountLow();
    }, this._channel.onopen = () => {
      this._onChannelOpen();
    }, this._channel.onclose = () => {
      this._onChannelClose();
    }, this._channel.onerror = (e3) => {
      const t3 = e3.error instanceof Error ? e3.error : new Error(`Datachannel error: ${e3.message} ${e3.filename}:${e3.lineno}:${e3.colno}`);
      this.__destroy(Y(t3, "ERR_DATA_CHANNEL"));
    };
    let t2 = false;
    this._closingInterval = setInterval(() => {
      this._channel && "closing" === this._channel.readyState ? (t2 && this._onChannelClose(), t2 = true) : t2 = false;
    }, 5e3);
  }
  _write(e2, t2) {
    if (this.destroyed) return t2(Y(new Error("cannot write after peer is destroyed"), "ERR_DATA_CHANNEL"));
    if (this._connected) {
      try {
        this.send(e2);
      } catch (e3) {
        return this.__destroy(Y(e3, "ERR_DATA_CHANNEL"));
      }
      this._channel.bufferedAmount > X ? (this._debug("start backpressure: bufferedAmount %d", this._channel.bufferedAmount), this._cb = t2) : t2(null);
    } else this._debug("write before connect"), this._chunk = e2, this._cb = t2;
  }
  _onFinish() {
    if (this.destroyed) return;
    const e2 = () => {
      setTimeout(() => this.__destroy(), 1e3);
    };
    this._connected ? e2() : this.once("connect", e2);
  }
  _startIceCompleteTimeout() {
    this.destroyed || this._iceCompleteTimer || (this._debug("started iceComplete timeout"), this._iceCompleteTimer = setTimeout(() => {
      this._iceComplete || (this._iceComplete = true, this._debug("iceComplete timeout completed"), this.emit("iceTimeout"), this.emit("_iceComplete"));
    }, this.iceCompleteTimeout));
  }
  _createOffer() {
    this.destroyed || this._pc.createOffer(this.offerOptions).then((e2) => {
      if (this.destroyed) return;
      this.trickle || this.allowHalfTrickle || (e2.sdp = Q(e2.sdp)), e2.sdp = this.sdpTransform(e2.sdp);
      const t2 = () => {
        if (this.destroyed) return;
        const t3 = this._pc.localDescription || e2;
        this._debug("signal"), this.emit("signal", { type: t3.type, sdp: t3.sdp });
      };
      this._pc.setLocalDescription(e2).then(() => {
        this._debug("createOffer success"), this.destroyed || (this.trickle || this._iceComplete ? t2() : this.once("_iceComplete", t2));
      }).catch((e3) => {
        this.__destroy(Y(e3, "ERR_SET_LOCAL_DESCRIPTION"));
      });
    }).catch((e2) => {
      this.__destroy(Y(e2, "ERR_CREATE_OFFER"));
    });
  }
  _createAnswer() {
    this.destroyed || this._pc.createAnswer(this.answerOptions).then((e2) => {
      if (this.destroyed) return;
      this.trickle || this.allowHalfTrickle || (e2.sdp = Q(e2.sdp)), e2.sdp = this.sdpTransform(e2.sdp);
      const t2 = () => {
        if (this.destroyed) return;
        const t3 = this._pc.localDescription || e2;
        this._debug("signal"), this.emit("signal", { type: t3.type, sdp: t3.sdp }), this.initiator || this._requestMissingTransceivers?.();
      };
      this._pc.setLocalDescription(e2).then(() => {
        this.destroyed || (this.trickle || this._iceComplete ? t2() : this.once("_iceComplete", t2));
      }).catch((e3) => {
        this.__destroy(Y(e3, "ERR_SET_LOCAL_DESCRIPTION"));
      });
    }).catch((e2) => {
      this.__destroy(Y(e2, "ERR_CREATE_ANSWER"));
    });
  }
  _onConnectionStateChange() {
    this.destroyed || this._destroying || "failed" === this._pc.connectionState && this.__destroy(Y(new Error("Connection failed."), "ERR_CONNECTION_FAILURE"));
  }
  _onIceStateChange() {
    if (this.destroyed) return;
    const e2 = this._pc.iceConnectionState, t2 = this._pc.iceGatheringState;
    this._debug("iceStateChange (connection: %s) (gathering: %s)", e2, t2), this.emit("iceStateChange", e2, t2), "connected" !== e2 && "completed" !== e2 || (this._pcReady = true, this._maybeReady()), "failed" === e2 && this.__destroy(Y(new Error("Ice connection failed."), "ERR_ICE_CONNECTION_FAILURE")), "closed" === e2 && this.__destroy(Y(new Error("Ice connection closed."), "ERR_ICE_CONNECTION_CLOSED"));
  }
  getStats(e2) {
    const t2 = (e3) => ("[object Array]" === Object.prototype.toString.call(e3.values) && e3.values.forEach((t3) => {
      Object.assign(e3, t3);
    }), e3);
    0 === this._pc.getStats.length || this._isReactNativeWebrtc ? this._pc.getStats().then((i2) => {
      const s2 = [];
      i2.forEach((e3) => {
        s2.push(t2(e3));
      }), e2(null, s2);
    }, (t3) => e2(t3)) : this._pc.getStats.length > 0 ? this._pc.getStats((i2) => {
      if (this.destroyed) return;
      const s2 = [];
      i2.result().forEach((e3) => {
        const i3 = {};
        e3.names().forEach((t3) => {
          i3[t3] = e3.stat(t3);
        }), i3.id = e3.id, i3.type = e3.type, i3.timestamp = e3.timestamp, s2.push(t2(i3));
      }), e2(null, s2);
    }, (t3) => e2(t3)) : e2(null, []);
  }
  _maybeReady() {
    if (this._debug("maybeReady pc %s channel %s", this._pcReady, this._channelReady), this._connected || this._connecting || !this._pcReady || !this._channelReady) return;
    this._connecting = true;
    const e2 = () => {
      this.destroyed || this._destroying || this.getStats((t2, i2) => {
        if (this.destroyed || this._destroying) return;
        t2 && (i2 = []);
        const s2 = {}, n2 = {}, r2 = {};
        let o2 = false;
        i2.forEach((e3) => {
          "remotecandidate" !== e3.type && "remote-candidate" !== e3.type || (s2[e3.id] = e3), "localcandidate" !== e3.type && "local-candidate" !== e3.type || (n2[e3.id] = e3), "candidatepair" !== e3.type && "candidate-pair" !== e3.type || (r2[e3.id] = e3);
        });
        const a2 = (e3) => {
          o2 = true;
          let t3 = n2[e3.localCandidateId];
          t3 && (t3.ip || t3.address) ? (this.localAddress = t3.ip || t3.address, this.localPort = Number(t3.port)) : t3 && t3.ipAddress ? (this.localAddress = t3.ipAddress, this.localPort = Number(t3.portNumber)) : "string" == typeof e3.googLocalAddress && (t3 = e3.googLocalAddress.split(":"), this.localAddress = t3[0], this.localPort = Number(t3[1])), this.localAddress && (this.localFamily = this.localAddress.includes(":") ? "IPv6" : "IPv4");
          let i3 = s2[e3.remoteCandidateId];
          i3 && (i3.ip || i3.address) ? (this.remoteAddress = i3.ip || i3.address, this.remotePort = Number(i3.port)) : i3 && i3.ipAddress ? (this.remoteAddress = i3.ipAddress, this.remotePort = Number(i3.portNumber)) : "string" == typeof e3.googRemoteAddress && (i3 = e3.googRemoteAddress.split(":"), this.remoteAddress = i3[0], this.remotePort = Number(i3[1])), this.remoteAddress && (this.remoteFamily = this.remoteAddress.includes(":") ? "IPv6" : "IPv4"), this._debug("connect local: %s:%s remote: %s:%s", this.localAddress, this.localPort, this.remoteAddress, this.remotePort);
        };
        if (i2.forEach((e3) => {
          "transport" === e3.type && e3.selectedCandidatePairId && a2(r2[e3.selectedCandidatePairId]), ("googCandidatePair" === e3.type && "true" === e3.googActiveConnection || ("candidatepair" === e3.type || "candidate-pair" === e3.type) && e3.selected) && a2(e3);
        }), o2 || Object.keys(r2).length && !Object.keys(n2).length) {
          if (this._connecting = false, this._connected = true, this.emit("connect"), this._chunk) {
            try {
              this.send(this._chunk);
            } catch (t3) {
              return this.__destroy(Y(t3, "ERR_DATA_CHANNEL"));
            }
            this._chunk = null, this._debug('sent chunk from "write before connect"');
            const e3 = this._cb;
            this._cb = null, e3(null);
          }
          "number" != typeof this._channel.bufferedAmountLowThreshold && (this._interval = setInterval(() => this._onInterval(), 150), this._interval.unref && this._interval.unref()), this._debug("connect"), this.emit("connect");
        } else setTimeout(e2, 100);
      });
    };
    e2();
  }
  _onInterval() {
    !this._cb || !this._channel || this._channel.bufferedAmount > X || this._onChannelBufferedAmountLow();
  }
  _onSignalingStateChange() {
    this.destroyed || ("stable" === this._pc.signalingState && (this._isNegotiating = false, this._debug("flushing sender queue", this._sendersAwaitingStable), this._sendersAwaitingStable.forEach((e2) => {
      this._pc.removeTrack(e2), this._queuedNegotiation = true;
    }), this._sendersAwaitingStable = [], this._queuedNegotiation ? (this._debug("flushing negotiation queue"), this._queuedNegotiation = false, this._needsNegotiation()) : (this._debug("negotiated"), this.emit("negotiated"))), this._debug("signalingStateChange %s", this._pc.signalingState), this.emit("signalingStateChange", this._pc.signalingState));
  }
  _onIceCandidate(e2) {
    this.destroyed || (e2.candidate && this.trickle ? this.emit("signal", { type: "candidate", candidate: { candidate: e2.candidate.candidate, sdpMLineIndex: e2.candidate.sdpMLineIndex, sdpMid: e2.candidate.sdpMid } }) : e2.candidate || this._iceComplete || (this._iceComplete = true, this.emit("_iceComplete")), e2.candidate && this._startIceCompleteTimeout());
  }
  _onChannelMessage(e2) {
    if (this.destroyed) return;
    let t2 = e2.data;
    t2 instanceof ArrayBuffer ? t2 = new Uint8Array(t2) : false === this.__objectMode && (t2 = (0, w.L0)(t2)), this.push(t2);
  }
  _onChannelBufferedAmountLow() {
    if (this.destroyed || !this._cb) return;
    this._debug("ending backpressure: bufferedAmount %d", this._channel.bufferedAmount);
    const e2 = this._cb;
    this._cb = null, e2(null);
  }
  _onChannelOpen() {
    this._connected || this.destroyed || (this._debug("on channel open"), this._channelReady = true, this._maybeReady());
  }
  _onChannelClose() {
    this.destroyed || (this._debug("on channel close"), this.__destroy());
  }
  _debug() {
    const e2 = [].slice.call(arguments);
    e2[0] = "[" + this._id + "] " + e2[0], J.apply(null, e2);
  }
};
Z.WEBRTC_SUPPORT = !!z, Z.config = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] }], sdpSemantics: "unified-plan" }, Z.channelConfig = {};
var ee = Z;
var te = n(1035);
var ie = n(7541);
var se = n(3278);
var ne = n(8271);
var re = n(6686);
var oe = n(7828);
var ae = n(6889);
var he = /^\[?([^\]]+)]?:(\d+)$/;
var le = /* @__PURE__ */ new Map();
function ce(e2) {
  if (1e5 === le.size && le.clear(), !le.has(e2)) {
    const t2 = he.exec(e2);
    if (!t2) throw new Error(`invalid addr: ${e2}`);
    le.set(e2, [t2[1], Number(t2[2])]);
  }
  return le.get(e2);
}
var de = n(3033);
var ue = n(4497);
async function* pe(e2, t2 = {}) {
  if (e2?.[Symbol.asyncIterator]) return void (yield* e2[Symbol.asyncIterator](t2.offset));
  if (!e2?.get) throw new Error("First argument must be an abstract-chunk-store compliant store");
  const i2 = t2.chunkLength || e2.chunkLength;
  if (!i2) throw new Error("missing required `chunkLength` property");
  let s2 = t2.length || e2.length;
  if (!Number.isFinite(s2)) throw new Error("missing required `length` property");
  const n2 = t2.offset || 0, r2 = (t3, i3, s3) => new Promise((n3, r3) => {
    e2.get(t3, { offset: s3, length: i3 }, (e3, t4) => {
      e3 && r3(e3), n3(t4);
    });
  });
  let o2 = Math.floor(n2 / i2);
  const a2 = n2 % i2;
  if (n2) {
    const e3 = Math.min(s2, i2 - a2);
    s2 -= e3, yield r2(o2++, e3, a2);
  }
  for (let e3 = s2; e3 > 0; ++o2, e3 -= i2) yield r2(o2, Math.min(e3, i2));
}
async function fe(e2, t2, i2 = {}) {
  if (!e2?.put) throw new Error("First argument must be an abstract-chunk-store compliant store");
  const s2 = i2.chunkLength || e2.chunkLength;
  if (!s2) throw new Error("missing required `chunkLength` property");
  const n2 = i2.storeMaxOutstandingPuts || 16;
  let r2 = 0, o2 = 0, a2 = () => {
  }, h2 = false;
  for await (const l2 of d(t2, s2, { zeroPadding: i2.zeroPadding || false })) await new Promise((t3, i3) => {
    r2++ <= n2 && t3(), e2.put(o2++, l2, (e3) => {
      if (e3) return i3(e3);
      --r2, t3(), h2 && 0 === r2 && a2();
    });
  });
  0 !== r2 && (h2 = new Promise((e3) => {
    a2 = e3;
  }), await h2);
}
var me = n(4018);
var _e = n(3970);
var ge = n(3519);
var ye = n(1551);
var we = { DEFAULT_ANNOUNCE_PEERS: 50, MAX_ANNOUNCE_PEERS: 82, parseUrl: (e2) => {
  const t2 = new URL(e2.replace(/^udp:/, "http:"));
  return e2.match(/^udp:/) && Object.defineProperties(t2, { href: { value: t2.href.replace(/^http/, "udp") }, protocol: { value: t2.protocol.replace(/^http/, "udp") }, origin: { value: t2.origin.replace(/^http/, "udp") } }), t2;
}, ...n.t(ye, 2) };
var be = n(826);
var ve = n(61);
var ke = n(2701);
var xe = T("simple-websocket");
var Se = "function" != typeof ke ? WebSocket : ke;
var Ee = class extends K.Duplex {
  constructor(e2 = {}) {
    if ("string" == typeof e2 && (e2 = { url: e2 }), super(e2 = Object.assign({ allowHalfOpen: false }, e2)), this.__objectMode = !!e2.objectMode, null != e2.objectMode && delete e2.objectMode, null == e2.url && null == e2.socket) throw new Error("Missing required `url` or `socket` option");
    if (null != e2.url && null != e2.socket) throw new Error("Must specify either `url` or `socket` option, not both");
    if (this._id = (0, w.V5)((0, w.po)(4)).slice(0, 7), this._debug("new websocket: %o", e2), this.connected = false, this._chunk = null, this._cb = null, this._interval = null, e2.socket) this.url = e2.socket.url, this._ws = e2.socket, this.connected = e2.socket.readyState === Se.OPEN;
    else {
      this.url = e2.url;
      try {
        this._ws = "function" == typeof ke ? new Se(e2.url, { ...e2, encoding: void 0 }) : new Se(e2.url);
      } catch (e3) {
        return void y(() => this.destroy(e3));
      }
    }
    this._ws.binaryType = "arraybuffer", e2.socket && this.connected ? y(() => this._handleOpen()) : this._ws.onopen = () => this._handleOpen(), this._ws.onmessage = (e3) => this._handleMessage(e3), this._ws.onclose = () => this._handleClose(), this._ws.onerror = (e3) => this._handleError(e3), this._handleFinishBound = () => this._handleFinish(), this.once("finish", this._handleFinishBound);
  }
  send(e2) {
    this._ws.send(e2);
  }
  _final(e2) {
    this._readableState.ended || this.push(null), e2(null);
  }
  _destroy(e2) {
    if (!this.destroyed) {
      if (this._writableState.ended || this.end(), this.connected = false, clearInterval(this._interval), this._interval = null, this._chunk = null, this._cb = null, this._handleFinishBound && this.removeListener("finish", this._handleFinishBound), this._handleFinishBound = null, this._ws) {
        const e3 = this._ws, t2 = () => {
          e3.onclose = null;
        };
        if (e3.readyState === Se.CLOSED) t2();
        else try {
          e3.onclose = t2, e3.close();
        } catch (e4) {
          t2();
        }
        e3.onopen = null, e3.onmessage = null, e3.onerror = () => {
        };
      }
      this._ws = null, e2();
    }
  }
  _write(e2, t2) {
    if (this.destroyed) return t2(new Error("cannot write after socket is destroyed"));
    if (this.connected) {
      try {
        this.send(e2);
      } catch (e3) {
        return this.destroy(e3);
      }
      "function" != typeof ke && this._ws.bufferedAmount > 65536 ? (this._debug("start backpressure: bufferedAmount %d", this._ws.bufferedAmount), this._cb = t2) : t2(null);
    } else this._debug("write before connect"), this._chunk = e2, this._cb = t2;
  }
  _handleOpen() {
    if (!this.connected && !this.destroyed) {
      if (this.connected = true, this._chunk) {
        try {
          this.send(this._chunk);
        } catch (e3) {
          return this.destroy(e3);
        }
        this._chunk = null, this._debug('sent chunk from "write before connect"');
        const e2 = this._cb;
        this._cb = null, e2(null);
      }
      "function" != typeof ke && (this._interval = setInterval(() => this._onInterval(), 150), this._interval.unref && this._interval.unref()), this._debug("connect"), this.emit("connect");
    }
  }
  _handleMessage(e2) {
    if (this.destroyed) return;
    let t2 = e2.data;
    t2 instanceof ArrayBuffer && (t2 = new Uint8Array(t2)), false === this.__objectMode && (t2 = (0, w.L0)(t2)), this.push(t2);
  }
  _handleClose() {
    this.destroyed || (this._debug("on close"), this.destroy());
  }
  _handleError(e2) {
    this.destroy(new Error(`Error connecting to ${this.url}`));
  }
  _handleFinish() {
    if (this.destroyed) return;
    const e2 = () => {
      setTimeout(() => this.destroy(), 1e3);
    };
    this.connected ? e2() : this.once("connect", e2);
  }
  _onInterval() {
    if (!this._cb || !this._ws || this._ws.bufferedAmount > 65536) return;
    this._debug("ending backpressure: bufferedAmount %d", this._ws.bufferedAmount);
    const e2 = this._cb;
    this._cb = null, e2(null);
  }
  _debug() {
    const e2 = [].slice.call(arguments);
    e2[0] = "[" + this._id + "] " + e2[0], xe.apply(null, e2);
  }
};
Ee.WEBSOCKET_SUPPORT = !!Se;
var Ce = class extends r {
  constructor(e2, t2) {
    super(), this.client = e2, this.announceUrl = t2, this.interval = null, this.destroyed = false;
  }
  setInterval(e2) {
    null == e2 && (e2 = this.DEFAULT_ANNOUNCE_INTERVAL), clearInterval(this.interval), e2 && (this.interval = setInterval(() => {
      this.announce(this.client._defaultAnnounceOpts());
    }, e2), this.interval.unref && this.interval.unref());
  }
};
var Pe = T("bittorrent-tracker:websocket-tracker");
var Ae = {};
var Te = class extends Ce {
  constructor(e2, t2) {
    super(e2, t2), Pe("new websocket tracker %s", t2), this.peers = {}, this.socket = null, this.reconnecting = false, this.retries = 0, this.reconnectTimer = null, this.expectingResponse = false, this._openSocket();
  }
  announce(e2) {
    if (this.destroyed || this.reconnecting) return;
    if (!this.socket.connected) return void this.socket.once("connect", () => {
      this.announce(e2);
    });
    const t2 = Object.assign({}, e2, { action: "announce", info_hash: this.client._infoHashBinary, peer_id: this.client._peerIdBinary });
    if (this._trackerId && (t2.trackerid = this._trackerId), "stopped" === e2.event || "completed" === e2.event) this._send(t2);
    else {
      const i2 = Math.min(e2.numwant, 5);
      this._generateOffers(i2, (e3) => {
        t2.numwant = i2, t2.offers = e3, this._send(t2);
      });
    }
  }
  scrape(e2) {
    if (this.destroyed || this.reconnecting) return;
    if (!this.socket.connected) return void this.socket.once("connect", () => {
      this.scrape(e2);
    });
    const t2 = { action: "scrape", info_hash: Array.isArray(e2.infoHash) && e2.infoHash.length > 0 ? e2.infoHash.map((e3) => (0, w.Ht)(e3)) : e2.infoHash && (0, w.Ht)(e2.infoHash) || this.client._infoHashBinary };
    this._send(t2);
  }
  destroy(e2 = Ie) {
    if (this.destroyed) return e2(null);
    this.destroyed = true, clearInterval(this.interval), clearTimeout(this.reconnectTimer);
    for (const e3 in this.peers) {
      const t3 = this.peers[e3];
      clearTimeout(t3.trackerTimeout), t3.destroy();
    }
    if (this.peers = null, this.socket && (this.socket.removeListener("connect", this._onSocketConnectBound), this.socket.removeListener("data", this._onSocketDataBound), this.socket.removeListener("close", this._onSocketCloseBound), this.socket.removeListener("error", this._onSocketErrorBound), this.socket = null), this._onSocketConnectBound = null, this._onSocketErrorBound = null, this._onSocketDataBound = null, this._onSocketCloseBound = null, Ae[this.announceUrl] && (Ae[this.announceUrl].consumers -= 1), Ae[this.announceUrl].consumers > 0) return e2();
    let t2, i2 = Ae[this.announceUrl];
    if (delete Ae[this.announceUrl], i2.on("error", Ie), i2.once("close", e2), !this.expectingResponse) return s2();
    function s2() {
      t2 && (clearTimeout(t2), t2 = null), i2.removeListener("data", s2), i2.destroy(), i2 = null;
    }
    t2 = setTimeout(s2, we.DESTROY_TIMEOUT), i2.once("data", s2);
  }
  _openSocket() {
    if (this.destroyed = false, this.peers || (this.peers = {}), this._onSocketConnectBound = () => {
      this._onSocketConnect();
    }, this._onSocketErrorBound = (e2) => {
      this._onSocketError(e2);
    }, this._onSocketDataBound = (e2) => {
      this._onSocketData(e2);
    }, this._onSocketCloseBound = () => {
      this._onSocketClose();
    }, this.socket = Ae[this.announceUrl], this.socket) Ae[this.announceUrl].consumers += 1, this.socket.connected && this._onSocketConnectBound();
    else {
      const e2 = new URL(this.announceUrl);
      let t2;
      this.client._proxyOpts && (t2 = "wss:" === e2.protocol ? this.client._proxyOpts.httpsAgent : this.client._proxyOpts.httpAgent, !t2 && this.client._proxyOpts.socksProxy && (t2 = this.client._proxyOpts.socksProxy)), this.socket = Ae[this.announceUrl] = new Ee({ url: this.announceUrl, agent: t2 }), this.socket.consumers = 1, this.socket.once("connect", this._onSocketConnectBound);
    }
    this.socket.on("data", this._onSocketDataBound), this.socket.once("close", this._onSocketCloseBound), this.socket.once("error", this._onSocketErrorBound);
  }
  _onSocketConnect() {
    this.destroyed || this.reconnecting && (this.reconnecting = false, this.retries = 0, this.announce(this.client._defaultAnnounceOpts()));
  }
  _onSocketData(e2) {
    if (!this.destroyed) {
      this.expectingResponse = false;
      try {
        e2 = JSON.parse((0, w.dU)(e2));
      } catch (e3) {
        return void this.client.emit("warning", new Error("Invalid tracker response"));
      }
      "announce" === e2.action ? this._onAnnounceResponse(e2) : "scrape" === e2.action ? this._onScrapeResponse(e2) : this._onSocketError(new Error(`invalid action in WS response: ${e2.action}`));
    }
  }
  _onAnnounceResponse(e2) {
    if (e2.info_hash !== this.client._infoHashBinary) return void Pe("ignoring websocket data from %s for %s (looking for %s: reused socket)", this.announceUrl, (0, w.HB)(e2.info_hash), this.client.infoHash);
    if (e2.peer_id && e2.peer_id === this.client._peerIdBinary) return;
    Pe("received %s from %s for %s", JSON.stringify(e2), this.announceUrl, this.client.infoHash);
    const t2 = e2["failure reason"];
    if (t2) return this.client.emit("warning", new Error(t2));
    const i2 = e2["warning message"];
    i2 && this.client.emit("warning", new Error(i2));
    const s2 = e2.interval || e2["min interval"];
    s2 && this.setInterval(1e3 * s2);
    const n2 = e2["tracker id"];
    if (n2 && (this._trackerId = n2), null != e2.complete) {
      const t3 = Object.assign({}, e2, { announce: this.announceUrl, infoHash: (0, w.HB)(e2.info_hash) });
      this.client.emit("update", t3);
    }
    let r2;
    if (e2.offer && e2.peer_id && (Pe("creating peer (from remote offer)"), r2 = this._createPeer(), r2.id = (0, w.HB)(e2.peer_id), r2.once("signal", (t3) => {
      const i3 = { action: "announce", info_hash: this.client._infoHashBinary, peer_id: this.client._peerIdBinary, to_peer_id: e2.peer_id, answer: t3, offer_id: e2.offer_id };
      this._trackerId && (i3.trackerid = this._trackerId), this._send(i3);
    }), this.client.emit("peer", r2), r2.signal(e2.offer)), e2.answer && e2.peer_id) {
      const t3 = (0, w.HB)(e2.offer_id);
      r2 = this.peers[t3], r2 ? (r2.id = (0, w.HB)(e2.peer_id), this.client.emit("peer", r2), r2.signal(e2.answer), clearTimeout(r2.trackerTimeout), r2.trackerTimeout = null, delete this.peers[t3]) : Pe(`got unexpected answer: ${JSON.stringify(e2.answer)}`);
    }
  }
  _onScrapeResponse(e2) {
    e2 = e2.files || {};
    const t2 = Object.keys(e2);
    0 !== t2.length ? t2.forEach((t3) => {
      const i2 = Object.assign(e2[t3], { announce: this.announceUrl, infoHash: (0, w.HB)(t3) });
      this.client.emit("scrape", i2);
    }) : this.client.emit("warning", new Error("invalid scrape response"));
  }
  _onSocketClose() {
    this.destroyed || (this.destroy(), this._startReconnectTimer());
  }
  _onSocketError(e2) {
    this.destroyed || (this.destroy(), this.client.emit("warning", e2), this._startReconnectTimer());
  }
  _startReconnectTimer() {
    const e2 = Math.floor(3e5 * Math.random()) + Math.min(1e4 * Math.pow(2, this.retries), 36e5);
    this.reconnecting = true, clearTimeout(this.reconnectTimer), this.reconnectTimer = setTimeout(() => {
      this.retries++, this._openSocket();
    }, e2), this.reconnectTimer.unref && this.reconnectTimer.unref(), Pe("reconnecting socket in %s ms", e2);
  }
  _send(e2) {
    if (this.destroyed) return;
    this.expectingResponse = true;
    const t2 = JSON.stringify(e2);
    Pe("send %s", t2), this.socket.send(t2);
  }
  _generateOffers(e2, t2) {
    const i2 = this, s2 = [];
    Pe("generating %s offers", e2);
    for (let t3 = 0; t3 < e2; ++t3) n2();
    function n2() {
      const e3 = (0, w.V5)((0, w.po)(20));
      Pe("creating peer (from _generateOffers)");
      const t3 = i2.peers[e3] = i2._createPeer({ initiator: true });
      t3.once("signal", (t4) => {
        s2.push({ offer: t4, offer_id: (0, w.Ht)(e3) }), r2();
      }), t3.trackerTimeout = setTimeout(() => {
        Pe("tracker timeout: destroying peer"), t3.trackerTimeout = null, delete i2.peers[e3], t3.destroy();
      }, 5e4), t3.trackerTimeout.unref && t3.trackerTimeout.unref();
    }
    function r2() {
      s2.length === e2 && (Pe("generated %s offers", e2), t2(s2));
    }
    r2();
  }
  _createPeer(e2) {
    const t2 = this;
    e2 = Object.assign({ trickle: false, config: t2.client._rtcConfig, wrtc: t2.client._wrtc }, e2);
    const i2 = new ee(e2);
    return i2.once("error", s2), i2.once("connect", function e3() {
      i2.removeListener("error", s2), i2.removeListener("connect", e3);
    }), i2;
    function s2(e3) {
      t2.client.emit("warning", new Error(`Connection error: ${e3.message}`)), i2.destroy();
    }
  }
};
function Ie() {
}
Te.prototype.DEFAULT_ANNOUNCE_INTERVAL = 3e4, Te._socketPool = Ae;
var Le = Te;
var Oe = n(717);
var Re = T("bittorrent-tracker:client");
var He = class extends r {
  constructor(e2 = {}) {
    if (super(), !e2.peerId) throw new Error("Option `peerId` is required");
    if (!e2.infoHash) throw new Error("Option `infoHash` is required");
    if (!e2.announce) throw new Error("Option `announce` is required");
    if (!Oe.browser && !e2.port) throw new Error("Option `port` is required");
    this.peerId = "string" == typeof e2.peerId ? e2.peerId : (0, w.V5)(e2.peerId), this._peerIdBuffer = (0, w.fk)(this.peerId), this._peerIdBinary = (0, w.Ht)(this.peerId), this.infoHash = "string" == typeof e2.infoHash ? e2.infoHash.toLowerCase() : (0, w.V5)(e2.infoHash), this._infoHashBuffer = (0, w.fk)(this.infoHash), this._infoHashBinary = (0, w.Ht)(this.infoHash), Re("new client %s", this.infoHash), this.destroyed = false, this._port = e2.port, this._getAnnounceOpts = e2.getAnnounceOpts, this._rtcConfig = e2.rtcConfig, this._userAgent = e2.userAgent, this._proxyOpts = e2.proxyOpts, this._wrtc = "function" == typeof e2.wrtc ? e2.wrtc() : e2.wrtc;
    let t2 = "string" == typeof e2.announce ? [e2.announce] : null == e2.announce ? [] : e2.announce;
    t2 = t2.map((e3) => (ArrayBuffer.isView(e3) && (e3 = (0, w.dU)(e3)), "/" === e3[e3.length - 1] && (e3 = e3.substring(0, e3.length - 1)), e3)), t2 = Array.from(new Set(t2));
    const i2 = false !== this._wrtc && (!!this._wrtc || ee.WEBRTC_SUPPORT), s2 = (e3) => {
      y(() => {
        this.emit("warning", e3);
      });
    };
    this._trackers = t2.map((e3) => {
      let t3;
      try {
        t3 = we.parseUrl(e3);
      } catch (t4) {
        return s2(new Error(`Invalid tracker URL: ${e3}`)), null;
      }
      const n2 = t3.port;
      if (n2 < 0 || n2 > 65535) return s2(new Error(`Invalid tracker port: ${e3}`)), null;
      const r2 = t3.protocol;
      return "http:" !== r2 && "https:" !== r2 || "function" != typeof be ? "udp:" === r2 && "function" == typeof ve ? new ve(this, e3) : "ws:" !== r2 && "wss:" !== r2 || !i2 || "ws:" === r2 && "undefined" != typeof window && "https:" === window.location.protocol ? (s2(new Error(`Unsupported tracker protocol: ${e3}`)), null) : new Le(this, e3) : new be(this, e3);
    }).filter(Boolean);
  }
  start(e2) {
    (e2 = this._defaultAnnounceOpts(e2)).event = "started", Re("send `start` %o", e2), this._announce(e2), this._trackers.forEach((e3) => {
      e3.setInterval();
    });
  }
  stop(e2) {
    (e2 = this._defaultAnnounceOpts(e2)).event = "stopped", Re("send `stop` %o", e2), this._announce(e2);
  }
  complete(e2) {
    e2 || (e2 = {}), (e2 = this._defaultAnnounceOpts(e2)).event = "completed", Re("send `complete` %o", e2), this._announce(e2);
  }
  update(e2) {
    (e2 = this._defaultAnnounceOpts(e2)).event && delete e2.event, Re("send `update` %o", e2), this._announce(e2);
  }
  _announce(e2) {
    this._trackers.forEach((t2) => {
      t2.announce(e2);
    });
  }
  scrape(e2) {
    Re("send `scrape`"), e2 || (e2 = {}), this._trackers.forEach((t2) => {
      t2.scrape(e2);
    });
  }
  setInterval(e2) {
    Re("setInterval %d", e2), this._trackers.forEach((t2) => {
      t2.setInterval(e2);
    });
  }
  destroy(e2) {
    if (this.destroyed) return;
    this.destroyed = true, Re("destroy");
    const t2 = this._trackers.map((e3) => (t3) => {
      e3.destroy(t3);
    });
    g(t2, e2), this._trackers = [], this._getAnnounceOpts = null;
  }
  _defaultAnnounceOpts(e2 = {}) {
    return null == e2.numwant && (e2.numwant = we.DEFAULT_ANNOUNCE_PEERS), null == e2.uploaded && (e2.uploaded = 0), null == e2.downloaded && (e2.downloaded = 0), this._getAnnounceOpts && (e2 = Object.assign({}, e2, this._getAnnounceOpts())), e2;
  }
};
He.scrape = (e2, t2) => {
  if (t2 = ge(t2), !e2.infoHash) throw new Error("Option `infoHash` is required");
  if (!e2.announce) throw new Error("Option `announce` is required");
  const i2 = Object.assign({}, e2, { infoHash: Array.isArray(e2.infoHash) ? e2.infoHash[0] : e2.infoHash, peerId: (0, w.L0)("01234567890123456789"), port: 6881 }), s2 = new He(i2);
  s2.once("error", t2), s2.once("warning", t2);
  let n2 = Array.isArray(e2.infoHash) ? e2.infoHash.length : 1;
  const r2 = {};
  return s2.on("scrape", (e3) => {
    if (n2 -= 1, r2[e3.infoHash] = e3, 0 === n2) {
      s2.destroy();
      const e4 = Object.keys(r2);
      1 === e4.length ? t2(null, r2[e4[0]]) : t2(null, r2);
    }
  }), s2.scrape({ infoHash: e2.infoHash }), s2;
};
var Ne = He;
var Me = n(2799);
var Fe = n(717);
var Ue = T("torrent-discovery");
var je = class extends r.EventEmitter {
  constructor(e2) {
    if (super(), !e2.peerId) throw new Error("Option `peerId` is required");
    if (!e2.infoHash) throw new Error("Option `infoHash` is required");
    if (!Fe.browser && !e2.port) throw new Error("Option `port` is required");
    this.peerId = "string" == typeof e2.peerId ? e2.peerId : e2.peerId.toString("hex"), this.infoHash = "string" == typeof e2.infoHash ? e2.infoHash.toLowerCase() : e2.infoHash.toString("hex"), this._port = e2.port, this._userAgent = e2.userAgent, this.destroyed = false, this._announce = e2.announce || [], this._intervalMs = e2.intervalMs || 9e5, this._trackerOpts = null, this._dhtAnnouncing = false, this._dhtTimeout = false, this._internalDHT = false, this._onWarning = (e3) => {
      this.emit("warning", e3);
    }, this._onError = (e3) => {
      this.emit("error", e3);
    }, this._onDHTPeer = (e3, t3) => {
      t3.toString("hex") === this.infoHash && this.emit("peer", `${e3.host}:${e3.port}`, "dht");
    }, this._onTrackerPeer = (e3) => {
      this.emit("peer", e3, "tracker");
    }, this._onTrackerAnnounce = () => {
      this.emit("trackerAnnounce");
    }, this._onLSDPeer = (e3, t3) => {
      this.emit("peer", e3, "lsd");
    };
    const t2 = (e3, t3) => {
      const i2 = new _e.Client(t3);
      return i2.on("warning", this._onWarning), i2.on("error", this._onError), i2.listen(e3), this._internalDHT = true, i2;
    };
    false === e2.tracker ? this.tracker = null : e2.tracker && "object" == typeof e2.tracker ? (this._trackerOpts = Object.assign({}, e2.tracker), this.tracker = this._createTracker()) : this.tracker = this._createTracker(), false === e2.dht || "function" != typeof _e.Client ? this.dht = null : e2.dht && "function" == typeof e2.dht.addNode ? this.dht = e2.dht : e2.dht && "object" == typeof e2.dht ? this.dht = t2(e2.dhtPort, e2.dht) : this.dht = t2(e2.dhtPort), this.dht && (this.dht.on("peer", this._onDHTPeer), this._dhtAnnounce()), false === e2.lsd || "function" != typeof Me ? this.lsd = null : this.lsd = this._createLSD();
  }
  updatePort(e2) {
    e2 !== this._port && (this._port = e2, this.dht && this._dhtAnnounce(), this.tracker && (this.tracker.stop(), this.tracker.destroy(() => {
      this.tracker = this._createTracker();
    })));
  }
  complete(e2) {
    this.tracker && this.tracker.complete(e2);
  }
  destroy(e2) {
    if (this.destroyed) return;
    this.destroyed = true, clearTimeout(this._dhtTimeout);
    const t2 = [];
    this.tracker && (this.tracker.stop(), this.tracker.removeListener("warning", this._onWarning), this.tracker.removeListener("error", this._onError), this.tracker.removeListener("peer", this._onTrackerPeer), this.tracker.removeListener("update", this._onTrackerAnnounce), t2.push((e3) => {
      this.tracker.destroy(e3);
    })), this.dht && this.dht.removeListener("peer", this._onDHTPeer), this._internalDHT && (this.dht.removeListener("warning", this._onWarning), this.dht.removeListener("error", this._onError), t2.push((e3) => {
      this.dht.destroy(e3);
    })), this.lsd && (this.lsd.removeListener("warning", this._onWarning), this.lsd.removeListener("error", this._onError), this.lsd.removeListener("peer", this._onLSDPeer), t2.push((e3) => {
      this.lsd.destroy(e3);
    })), g(t2, e2), this.dht = null, this.tracker = null, this.lsd = null, this._announce = null;
  }
  _createTracker() {
    const e2 = Object.assign({}, this._trackerOpts, { infoHash: this.infoHash, announce: this._announce, peerId: this.peerId, port: this._port, userAgent: this._userAgent }), t2 = new Ne(e2);
    return t2.on("warning", this._onWarning), t2.on("error", this._onError), t2.on("peer", this._onTrackerPeer), t2.on("update", this._onTrackerAnnounce), t2.setInterval(this._intervalMs), t2.start(), t2;
  }
  _dhtAnnounce() {
    this._dhtAnnouncing || (Ue("dht announce"), this._dhtAnnouncing = true, clearTimeout(this._dhtTimeout), this.dht.announce(this.infoHash, this._port, (e2) => {
      this._dhtAnnouncing = false, Ue("dht announce complete"), e2 && this.emit("warning", e2), this.emit("dhtAnnounce"), this.destroyed || (this._dhtTimeout = setTimeout(() => {
        this._dhtAnnounce();
      }, this._intervalMs + Math.floor(Math.random() * this._intervalMs / 5)), this._dhtTimeout.unref && this._dhtTimeout.unref());
    }));
  }
  _createLSD() {
    const e2 = Object.assign({}, { infoHash: this.infoHash, peerId: this.peerId, port: this._port }), t2 = new Me(e2);
    return t2.on("warning", this._onWarning), t2.on("error", this._onError), t2.on("peer", this._onLSDPeer), t2.start(), t2;
  }
};
var Be = je;
var De = ["seeking position failed.", "InvalidStateError"];
var qe = ["A requested file or directory could not be found at the time an operation was processed.", "NotFoundError"];
var We = (e2) => [`Failed to execute 'write' on 'UnderlyingSinkBase': Invalid params passed. ${e2}`, "SyntaxError"];
var $e = class extends WritableStream {
  constructor(e2) {
    super(e2), Object.setPrototypeOf(this, FileSystemWritableFileStream.prototype), this._closed = false;
  }
  async close() {
    this._closed = true;
    const e2 = this.getWriter(), t2 = e2.close();
    return e2.releaseLock(), t2;
  }
  seek(e2) {
    return this.write({ type: "seek", position: e2 });
  }
  truncate(e2) {
    return this.write({ type: "truncate", size: e2 });
  }
  write(e2) {
    if (this._closed) return Promise.reject(new TypeError("Cannot write to a CLOSED writable stream"));
    const t2 = this.getWriter(), i2 = t2.write(e2);
    return t2.releaseLock(), i2;
  }
};
if (Object.defineProperty($e.prototype, Symbol.toStringTag, { value: "FileSystemWritableFileStream", writable: false, enumerable: false, configurable: true }), Object.defineProperties($e.prototype, { close: { enumerable: true }, seek: { enumerable: true }, truncate: { enumerable: true }, write: { enumerable: true } }), !globalThis.FileSystemFileHandle || globalThis.FileSystemFileHandle.prototype.createWritable || globalThis.FileSystemWritableFileStream || (globalThis.FileSystemWritableFileStream = $e), globalThis.FileSystemFileHandle && !globalThis.FileSystemFileHandle.prototype.createWritable) {
  const e2 = /* @__PURE__ */ new WeakMap();
  let t2;
  const i2 = () => {
    let e3, t3;
    onmessage = async (i3) => {
      const s3 = i3.ports[0], n2 = i3.data;
      switch (n2.type) {
        case "open": {
          const i4 = n2.name;
          let s4 = await navigator.storage.getDirectory();
          for (const e4 of n2.path) s4 = await s4.getDirectoryHandle(e4);
          e3 = await s4.getFileHandle(i4), t3 = await e3.createSyncAccessHandle();
          break;
        }
        case "write":
          t3.write(n2.data, { at: n2.position }), t3.flush();
          break;
        case "truncate":
          t3.truncate(n2.size);
          break;
        case "abort":
        case "close":
          t3.close();
      }
      s3.postMessage(0);
    };
  };
  globalThis.FileSystemFileHandle.prototype.createWritable = async function(s3) {
    if (!t2) {
      const e3 = `(${i2.toString()})()`, s4 = new Blob([e3], { type: "text/javascript" });
      t2 = URL.createObjectURL(s4);
    }
    const n2 = new Worker(t2, { type: "module" });
    let r2 = 0;
    const o2 = new TextEncoder();
    let a2 = await this.getFile().then((e3) => e3.size);
    const h2 = (e3) => new Promise((t3, i3) => {
      const s4 = new MessageChannel();
      s4.port1.onmessage = (e4) => {
        e4.data instanceof Error ? i3(e4.data) : t3(e4.data), s4.port1.close(), s4.port2.close(), s4.port1.onmessage = null;
      }, n2.postMessage(e3, [s4.port2]);
    }), l2 = await navigator.storage.getDirectory(), c2 = await e2.get(this), d2 = await l2.resolve(c2);
    if (null === d2) throw new DOMException(...qe);
    return await h2({ type: "open", path: d2, name: this.name }), false === s3?.keepExistingData && (await h2({ type: "truncate", size: 0 }), a2 = 0), new $e({ async write(e3) {
      if ("write" === (e3 = e3?.constructor === Object ? { ...e3 } : { type: "write", data: e3, position: r2 }).type) {
        if (!("data" in e3)) throw await h2({ type: "close" }), new DOMException(...We("write requires a data argument"));
        if (e3.position ??= r2, "string" == typeof e3.data) e3.data = o2.encode(e3.data);
        else if (e3.data instanceof ArrayBuffer) e3.data = new Uint8Array(e3.data);
        else if (e3.data instanceof Uint8Array || !ArrayBuffer.isView(e3.data)) {
          if (!(e3.data instanceof Uint8Array)) {
            const t3 = await new Response(e3.data).arrayBuffer();
            e3.data = new Uint8Array(t3);
          }
        } else e3.data = new Uint8Array(e3.data.buffer, e3.data.byteOffset, e3.data.byteLength);
        Number.isInteger(e3.position) && e3.position >= 0 && (r2 = e3.position), r2 += e3.data.byteLength, a2 += e3.data.byteLength;
      } else {
        if ("seek" === e3.type) {
          if (Number.isInteger(e3.position) && e3.position >= 0) {
            if (a2 < e3.position) throw new DOMException(...De);
            return void (r2 = e3.position);
          }
          throw await h2({ type: "close" }), new DOMException(...We("seek requires a position argument"));
        }
        if ("truncate" === e3.type) {
          if (!(Number.isInteger(e3.size) && e3.size >= 0)) throw await h2({ type: "close" }), new DOMException(...We("truncate requires a size argument"));
          a2 = e3.size, r2 > a2 && (r2 = a2);
        }
      }
      await h2(e3);
    }, async close() {
      await h2({ type: "close" }), n2.terminate();
    }, async abort(e3) {
      await h2({ type: "abort", reason: e3 }), n2.terminate();
    } });
  };
  const s2 = FileSystemDirectoryHandle.prototype.getFileHandle;
  FileSystemDirectoryHandle.prototype.getFileHandle = async function(...t3) {
    const i3 = await s2.call(this, ...t3);
    return e2.set(i3, this), i3;
  };
}
var ze = /[<>:"/\\|?*\u0000-\u001F]/g;
globalThis.navigator?.storage?.getDirectory && navigator.storage.getDirectory().then((e2) => {
  e2.removeEntry("chunks", { recursive: true }).catch(() => {
  });
});
var Ve = (e2, t2) => {
};
var Ge = class {
  name = "";
  chunks = [];
  chunkMap = [];
  directoryMap = {};
  files;
  rootDirPromise;
  storageDirPromise;
  chunksDirPromise;
  closing = false;
  closed = false;
  constructor(e2, t2 = {}) {
    if (this.chunkLength = Number(e2), !this.chunkLength) throw new Error("First argument must be a chunk length");
    if (!globalThis.navigator?.storage?.getDirectory) throw new Error("FSA API is not supported");
    if (this.closed = false, this.name = t2.name || crypto.randomUUID(), this.rootDirPromise = t2.rootDir || navigator.storage.getDirectory(), this.storageDirPromise = (async () => (await this.rootDirPromise).getDirectoryHandle(this.name, { create: true }))(), this.chunksDirPromise = this.storageDirPromise, t2.files && t2.rootDir) {
      if (this.chunksDirPromise = this._getChunksDirHandle(), this.files = t2.files.map((e3, t3, i2) => {
        if (null == e3.path) throw new Error("File is missing `path` property");
        if (null == e3.length) throw new Error("File is missing `length` property");
        if (null == e3.offset) if (0 === t3) e3.offset = 0;
        else {
          const s3 = i2[t3 - 1];
          e3.offset = s3.offset + s3.length;
        }
        null == e3.handle && (e3.handle = this._createFileHandle({ path: e3.path })), e3.blob = this._createBlobReference(e3.handle);
        const s2 = e3.offset, n2 = e3.offset + e3.length, r2 = Math.floor(s2 / this.chunkLength), o2 = Math.floor((n2 - 1) / this.chunkLength);
        for (let t4 = r2; t4 <= o2; ++t4) {
          const i3 = t4 * this.chunkLength, r3 = s2 < i3 ? 0 : s2 - i3, o3 = n2 > i3 + this.chunkLength ? this.chunkLength : n2 - i3, a2 = s2 > i3 ? 0 : i3 - s2;
          this.chunkMap[t4] || (this.chunkMap[t4] = []), this.chunkMap[t4].push({ from: r3, to: o3, offset: a2, file: e3 });
        }
        return e3;
      }), window.addEventListener("pagehide", () => this.cleanup()), this.length = this.files.reduce((e3, t3) => e3 + t3.length, 0), null != t2.length && t2.length !== this.length) throw new Error("total `files` length is not equal to explicit `length` option");
    } else this.length = Number(t2.length) || 1 / 0;
    this.length !== 1 / 0 && (this.lastChunkLength = this.length % this.chunkLength || this.chunkLength, this.lastChunkIndex = Math.ceil(this.length / this.chunkLength) - 1);
  }
  async _getChunkHandle(e2) {
    let t2 = this.chunks[e2];
    if (!t2) {
      const i2 = await this.chunksDirPromise;
      this.chunks[e2] = t2 = await i2.getFileHandle(e2, { create: true });
    }
    return t2;
  }
  async _createFileHandle(e2) {
    const t2 = e2.path.slice(e2.path.lastIndexOf("/") + 1);
    return (await this._getDirectoryHandle(e2)).getFileHandle(t2.replace(ze, ""), { create: true });
  }
  async _createBlobReference(e2) {
    return (await e2).getFile();
  }
  async _getDirectoryHandle(e2) {
    const t2 = e2.path.lastIndexOf("/");
    if (-1 === t2 || 0 === t2) return this.storageDirPromise;
    const i2 = e2.path = e2.path.slice(0, t2);
    return this.directoryMap[i2] || (this.directoryMap[i2] = (async () => (await this._getDirectoryHandle(e2)).getDirectoryHandle(i2.slice(i2.lastIndexOf("/") + 1), { create: true }))()), this.directoryMap[i2];
  }
  async _getChunksDirHandle() {
    const e2 = await navigator.storage.getDirectory();
    return (await e2.getDirectoryHandle("chunks", { create: true })).getDirectoryHandle(this.name, { create: true });
  }
  async put(e2, t2, i2 = Ve) {
    try {
      return await this._put(e2, t2), i2(null), null;
    } catch (e3) {
      return queueMicrotask(() => i2(e3)), e3;
    }
  }
  async getStreamForHandle(e2) {
    return (await e2).createWritable({ keepExistingData: true });
  }
  async _put(e2, t2) {
    if (this.closed) throw new Error("Storage is closed");
    const i2 = e2 === this.lastChunkIndex;
    if (i2 && t2.length !== this.lastChunkLength) throw new Error(`Last chunk length must be ${this.lastChunkLength}`);
    if (!i2 && t2.length !== this.chunkLength) throw new Error(`Chunk length must be ${this.chunkLength}`);
    const s2 = (async () => {
      const i3 = await this._getChunkHandle(e2), s3 = await i3.createWritable({ keepExistingData: false });
      await s3.write(t2), await s3.close();
    })();
    if (!this.files) return s2;
    const n2 = this.chunkMap[e2];
    if (!n2) throw new Error("No files matching the request range");
    const r2 = n2.map(async ({ file: e3, offset: i3, from: s3, to: n3 }) => {
      e3.stream || (e3.stream = this.getStreamForHandle(e3.handle)), await (await e3.stream).write({ type: "write", position: i3, data: t2.slice(s3, n3) });
    });
    r2.push(s2), await Promise.all(r2);
  }
  async get(e2, t2, i2 = Ve) {
    null == t2 && (t2 = {});
    try {
      const s2 = await this._get(e2, t2);
      return i2(null, s2), s2;
    } catch (e3) {
      return i2(e3), e3;
    }
  }
  async _get(e2, t2) {
    if ("function" == typeof t2) return this.get(e2, void 0, t2);
    if (this.closed) throw new Error("Storage is closed");
    const i2 = e2 === this.lastChunkIndex ? this.lastChunkLength : this.chunkLength, s2 = t2.offset || 0, n2 = t2.length ? s2 + t2.length : i2, r2 = t2.length || i2 - s2;
    if (s2 < 0 || s2 < 0 || n2 > i2) throw new Error("Invalid offset and/or length");
    if (s2 === n2) return new Uint8Array(0);
    if (!this.files || this.chunks[e2]) {
      const t3 = await this._getChunkHandle(e2);
      let n3 = await t3.getFile();
      0 === s2 && r2 === i2 || (n3 = n3.slice(s2, r2 + s2));
      const o3 = await n3.arrayBuffer();
      if (0 === o3.byteLength) throw new Error(`Index ${e2} does not exist`);
      return new Uint8Array(o3);
    }
    let o2 = this.chunkMap[e2];
    if (!o2) throw new Error("No files matching the request range");
    if (t2 && (o2 = o2.filter(({ from: e3, to: t3 }) => t3 > s2 && e3 < n2), 0 === o2.length)) throw new Error("No files matching the request range");
    const a2 = o2.map(async ({ from: e3, to: i3, offset: r3, file: o3 }) => {
      t2 && (i3 > n2 && (i3 = n2), e3 < s2 && (r3 += s2 - e3, e3 = s2));
      return (await o3.blob).slice(r3, r3 + i3 - e3);
    }), h2 = await Promise.all(a2), l2 = 1 === h2.length ? await h2[0].arrayBuffer() : await new Blob(h2).arrayBuffer();
    if (0 === l2.byteLength) throw new Error(`Index ${e2} does not exist`);
    return new Uint8Array(l2);
  }
  async close(e2 = Ve) {
    if (this.closing) return ((e3 = Ve, t2) => queueMicrotask(() => e3(new Error(t2))))(e2, "Storage is closed");
    this.closing = true, this.chunkMap = void 0, this.directoryMap = void 0, this.files && await this.cleanup(), this.closed = true, queueMicrotask(() => e2(null));
  }
  async cleanup() {
    if (this.closed || !this.files) return;
    const e2 = [];
    for (const t3 of this.files) t3.stream && (e2.push(t3.stream.then((e3) => e3.close())), t3.stream = void 0);
    const t2 = (async () => {
      const e3 = await this.chunksDirPromise;
      this.chunks = [];
      for await (const t3 of e3.keys()) await e3.removeEntry(t3, { recursive: true });
      this.chunksDirPromise = this._getChunksDirHandle(), await this.chunksDirPromise;
    })();
    await Promise.all(e2);
    for (const e3 of this.files) e3.blob = this._createBlobReference(e3.handle);
    await t2;
  }
  async destroy(e2 = Ve) {
    this.close(async (t2) => {
      if (t2) return e2(t2);
      try {
        const e3 = await this.rootDirPromise;
        await e3.removeEntry(this.name, { recursive: true });
      } catch (t3) {
        return e2(t3);
      }
      e2(null);
    });
  }
};
var Ke = n(3714);
var Ye = n(1314);
var Je = T("lt_donthave");
var Xe = () => {
  class e2 extends r.EventEmitter {
    constructor(e3) {
      super(), this._peerSupports = false, this._wire = e3;
    }
    onExtendedHandshake() {
      this._peerSupports = true;
    }
    onMessage(e3) {
      let t2;
      try {
        t2 = new DataView(e3.buffer).getUint32(0);
      } catch (e4) {
        return;
      }
      this._wire.peerPieces.get(t2) && (Je("got donthave %d", t2), this._wire.peerPieces.set(t2, false), this.emit("donthave", t2), this._failRequests(t2));
    }
    donthave(e3) {
      if (!this._peerSupports) return;
      Je("donthave %d", e3);
      const t2 = new Uint8Array(4);
      new DataView(t2.buffer).setUint32(0, e3), this._wire.extended("lt_donthave", t2);
    }
    _failRequests(e3) {
      const t2 = this._wire.requests;
      for (let i2 = 0; i2 < t2.length; i2++) {
        const s2 = t2[i2];
        s2.piece === e3 && (Ye(t2, i2), i2 -= 1, this._wire._callback(s2, new Error("peer sent donthave"), null));
      }
    }
  }
  return e2.prototype.name = "lt_donthave", e2;
};
var Qe = n(4862);
var Ze = n(5372);
var et = 16384;
var tt = class {
  constructor(e2) {
    this.length = e2, this.missing = e2, this.sources = null, this._chunks = Math.ceil(e2 / et), this._remainder = e2 % et || et, this._buffered = 0, this._buffer = null, this._cancellations = null, this._reservations = 0, this._flushed = false;
  }
  chunkLength(e2) {
    return e2 === this._chunks - 1 ? this._remainder : et;
  }
  chunkLengthRemaining(e2) {
    return this.length - e2 * et;
  }
  chunkOffset(e2) {
    return e2 * et;
  }
  reserve() {
    return this.init() ? this._cancellations.length ? this._cancellations.pop() : this._reservations < this._chunks ? this._reservations++ : -1 : -1;
  }
  reserveRemaining() {
    if (!this.init()) return -1;
    if (this._cancellations.length || this._reservations < this._chunks) {
      let e2 = this._reservations;
      for (; this._cancellations.length; ) e2 = Math.min(e2, this._cancellations.pop());
      return this._reservations = this._chunks, e2;
    }
    return -1;
  }
  cancel(e2) {
    this.init() && this._cancellations.push(e2);
  }
  cancelRemaining(e2) {
    this.init() && (this._reservations = e2);
  }
  get(e2) {
    return this.init() ? this._buffer[e2] : null;
  }
  set(e2, t2, i2) {
    if (!this.init()) return false;
    const s2 = t2.length, n2 = Math.ceil(s2 / et);
    for (let s3 = 0; s3 < n2; s3++) if (!this._buffer[e2 + s3]) {
      const n3 = s3 * et, r2 = t2.subarray(n3, n3 + et);
      this._buffered++, this._buffer[e2 + s3] = r2, this.missing -= r2.length, this.sources.includes(i2) || this.sources.push(i2);
    }
    return this._buffered === this._chunks;
  }
  flush() {
    if (!this._buffer || this._chunks !== this._buffered) return null;
    const e2 = (0, w.xW)(this._buffer, this.length);
    return this._buffer = null, this._cancellations = null, this.sources = null, this._flushed = true, e2;
  }
  init() {
    return !this._flushed && (this._buffer || (this._buffer = new Array(this._chunks), this._cancellations = [], this.sources = []), true);
  }
};
tt.BLOCK_LENGTH = et;
var it = n(7373);
var st = T("ut_metadata");
var nt = 16384;
var rt = (e2) => {
  class t2 extends r.EventEmitter {
    constructor(t3) {
      super(), this._wire = t3, this._fetching = false, this._metadataComplete = false, this._metadataSize = null, this._remainingRejects = null, this._bitfield = new de.A(0, { grow: 1e3 }), ArrayBuffer.isView(e2) && this.setMetadata(e2);
    }
    onHandshake(e3, t3, i2) {
      this._infoHash = e3;
    }
    onExtendedHandshake(e3) {
      return e3.m && e3.m.ut_metadata ? e3.metadata_size ? "number" != typeof e3.metadata_size || 1e7 < e3.metadata_size || e3.metadata_size <= 0 ? this.emit("warning", new Error("Peer gave invalid metadata size")) : (this._metadataSize = e3.metadata_size, this._numPieces = Math.ceil(this._metadataSize / nt), this._remainingRejects = 2 * this._numPieces, void this._requestPieces()) : this.emit("warning", new Error("Peer does not have metadata")) : this.emit("warning", new Error("Peer does not support ut_metadata"));
    }
    onMessage(e3) {
      let t3, i2;
      try {
        const s2 = (0, w.dU)(e3), n2 = s2.indexOf("ee") + 2;
        t3 = c.A.decode(s2.substring(0, n2)), i2 = e3.slice(n2);
      } catch (e4) {
        return;
      }
      switch (t3.msg_type) {
        case 0:
          this._onRequest(t3.piece);
          break;
        case 1:
          this._onData(t3.piece, i2, t3.total_size);
          break;
        case 2:
          this._onReject(t3.piece);
      }
    }
    fetch() {
      this._metadataComplete || (this._fetching = true, this._metadataSize && this._requestPieces());
    }
    cancel() {
      this._fetching = false;
    }
    async setMetadata(e3) {
      if (this._metadataComplete) return true;
      st("set metadata");
      try {
        const t3 = c.A.decode(e3).info;
        t3 && (e3 = c.A.encode(t3));
      } catch (e4) {
      }
      return (!this._infoHash || this._infoHash === await (0, w.tW)(e3, "hex")) && (this.cancel(), this.metadata = e3, this._metadataComplete = true, this._metadataSize = this.metadata.length, this._wire.extendedHandshake.metadata_size = this._metadataSize, this.emit("metadata", c.A.encode({ info: c.A.decode(this.metadata) })), true);
    }
    _send(e3, t3) {
      let i2 = c.A.encode(e3);
      ArrayBuffer.isView(t3) && (i2 = (0, w.xW)([i2, t3])), this._wire.extended("ut_metadata", i2);
    }
    _request(e3) {
      this._send({ msg_type: 0, piece: e3 });
    }
    _data(e3, t3, i2) {
      const s2 = { msg_type: 1, piece: e3 };
      "number" == typeof i2 && (s2.total_size = i2), this._send(s2, t3);
    }
    _reject(e3) {
      this._send({ msg_type: 2, piece: e3 });
    }
    _onRequest(e3) {
      if (!this._metadataComplete) return void this._reject(e3);
      const t3 = e3 * nt;
      let i2 = t3 + nt;
      i2 > this._metadataSize && (i2 = this._metadataSize);
      const s2 = this.metadata.slice(t3, i2);
      this._data(e3, s2, this._metadataSize);
    }
    _onData(e3, t3, i2) {
      t3.length > nt || !this._fetching || (this.metadata.set(t3, e3 * nt), this._bitfield.set(e3), this._checkDone());
    }
    _onReject(e3) {
      this._remainingRejects > 0 && this._fetching ? (this._request(e3), this._remainingRejects -= 1) : this.emit("warning", new Error('Peer sent "reject" too much'));
    }
    _requestPieces() {
      if (this._fetching) {
        this.metadata = new Uint8Array(this._metadataSize);
        for (let e3 = 0; e3 < this._numPieces; e3++) this._request(e3);
      }
    }
    async _checkDone() {
      let e3 = true;
      for (let t3 = 0; t3 < this._numPieces; t3++) if (!this._bitfield.get(t3)) {
        e3 = false;
        break;
      }
      if (!e3) return;
      await this.setMetadata(this.metadata) || this._failedMetadata();
    }
    _failedMetadata() {
      this._bitfield = new de.A(0, { grow: 1e3 }), this._remainingRejects -= this._numPieces, this._remainingRejects > 0 ? this._requestPieces() : this.emit("warning", new Error("Peer sent invalid metadata"));
    }
  }
  return t2.prototype.name = "ut_metadata", t2;
};
var ot = n(8878);
var at = n(1133);
var ht = T("webtorrent:file-iterator");
var lt = class extends r {
  constructor(e2, { start: t2, end: i2 }) {
    super(), this._torrent = e2._torrent, this._pieceLength = e2._torrent.pieceLength, this._startPiece = (t2 + e2.offset) / this._pieceLength | 0, this._endPiece = (i2 + e2.offset) / this._pieceLength | 0, this._piece = this._startPiece, this._offset = t2 + e2.offset - this._startPiece * this._pieceLength, this._missing = i2 - t2 + 1, this._criticalLength = Math.min(1048576 / this._pieceLength | 0, 2), this._torrent._select(this._startPiece, this._endPiece, 1, null, true), this.destroyed = false;
  }
  [Symbol.asyncIterator]() {
    return this;
  }
  next() {
    return new Promise((e2, t2) => {
      if (0 === this._missing || this.destroyed) return e2({ done: true }), this.destroy();
      const i2 = (t3, s3) => {
        if (!this._torrent.bitfield.get(t3)) {
          const n2 = (r2) => {
            (r2 === t3 || this.destroyed) && (this._torrent.removeListener("verified", n2), r2 === t3 ? i2(t3, s3) : e2({ done: true }));
          };
          return this._torrent.on("verified", n2), this._torrent.critical(t3, t3 + this._criticalLength);
        }
        if (this.destroyed) return e2({ done: true });
        this._torrent.store.get(t3, s3, (i3, s4) => this.destroyed ? e2({ done: true }) : (ht("read %s and yielding (length %s) (err %s)", t3, s4?.length, i3?.message), i3 ? (this.destroy(void 0, i3), e2({ done: true })) : void e2({ value: s4, done: false })));
      }, s2 = Math.min(this._missing, this._pieceLength - this._offset);
      i2(this._piece++, { length: s2, offset: this._offset }), this._missing -= s2, this._offset = 0;
    });
  }
  async return() {
    return this.destroy(), { done: true, value: void 0 };
  }
  async throw(e2) {
    throw e2;
  }
  destroy(e2 = (e3) => {
  }, t2) {
    this.destroyed || (this.destroyed = true, this._torrent.destroyed || this._torrent._deselect(this._startPiece, this._endPiece, true), this.emit("return"), e2(t2));
  }
};
var ct = class extends r {
  constructor(e2, t2) {
    super(), this._torrent = e2, this._destroyed = false, this._fileStreams = /* @__PURE__ */ new Set(), this._iterators = /* @__PURE__ */ new Set(), this.name = t2.name, this.path = t2.path, this.length = t2.length, this.size = t2.length, this.type = at.getType(this.name) || "application/octet-stream", this.offset = t2.offset, this.done = false;
    const i2 = t2.offset, s2 = i2 + t2.length - 1;
    this._startPiece = i2 / this._torrent.pieceLength | 0, this._endPiece = s2 / this._torrent.pieceLength | 0, 0 === this.length && (this.done = true, this.emit("done")), this._client = e2.client;
  }
  get downloaded() {
    if (this._destroyed || !this._torrent.bitfield) return 0;
    const { pieces: e2, bitfield: t2, pieceLength: i2, lastPieceLength: s2 } = this._torrent, { _startPiece: n2, _endPiece: r2 } = this, o2 = (t3) => t3 === e2.length - 1 ? s2 : i2, a2 = (n3) => {
      const r3 = n3 === e2.length - 1 ? s2 : i2;
      return t2.get(n3) ? r3 : r3 - e2[n3].missing;
    };
    let h2 = 0;
    for (let e3 = n2; e3 <= r2; e3 += 1) {
      const t3 = a2(e3);
      if (h2 += t3, e3 === n2) {
        const e4 = this.offset % i2;
        h2 -= Math.min(e4, t3);
      }
      if (e3 === r2) {
        const e4 = o2(r2) - (this.offset + this.length) % i2;
        h2 -= Math.min(e4, t3);
      }
    }
    return h2;
  }
  get progress() {
    return this.length ? this.downloaded / this.length : 0;
  }
  select(e2) {
    0 !== this.length && this._torrent.select(this._startPiece, this._endPiece, e2);
  }
  deselect() {
    0 !== this.length && this._torrent.deselect(this._startPiece, this._endPiece);
  }
  [Symbol.asyncIterator](e2 = {}) {
    if (0 === this.length || this._destroyed) return (async function* () {
    })();
    const { start: t2 = 0 } = e2 ?? {}, i2 = e2?.end && e2.end < this.length ? e2.end : this.length - 1;
    if (this.done) return pe(this._torrent.store, { offset: t2 + this.offset, length: i2 - t2 + 1 });
    const s2 = new lt(this, { start: t2, end: i2 });
    return this._iterators.add(s2), s2.once("return", () => {
      this._iterators.delete(s2);
    }), s2;
  }
  createReadStream(e2) {
    if (this._destroyed) throw new Error("File is destroyed");
    const t2 = this[Symbol.asyncIterator](e2), i2 = K.Readable.from(t2);
    return this._fileStreams.add(i2), i2.once("close", () => {
      this._fileStreams.delete(i2);
    }), i2;
  }
  async arrayBuffer(e2 = {}) {
    if (this._destroyed) throw new Error("File is destroyed");
    const { start: t2 = 0 } = e2, i2 = e2?.end && e2.end < this.length ? e2.end : this.length - 1, s2 = new Uint8Array(i2 - t2 + 1);
    let n2 = 0;
    for await (const e3 of this[Symbol.asyncIterator]({ start: t2, end: i2 })) s2.set(e3, n2), n2 += e3.length;
    return s2.buffer;
  }
  async blob(e2) {
    if (this._destroyed) throw new Error("File is destroyed");
    return new Blob([await this.arrayBuffer(e2)], { type: this.type });
  }
  stream(e2) {
    if (this._destroyed) throw new Error("File is destroyed");
    let t2;
    return new ReadableStream({ start: () => {
      t2 = this[Symbol.asyncIterator](e2);
    }, async pull(e3) {
      const { value: i2, done: s2 } = await t2.next();
      s2 ? e3.close() : e3.enqueue(i2);
    }, cancel() {
      t2.return();
    } });
  }
  get streamURL() {
    if (!this._client._server) throw new Error("No server created");
    return `${this._client._server.pathname}/${this._torrent.infoHash}/${this.path}`;
  }
  streamTo(e2) {
    return e2.src = this.streamURL, e2;
  }
  includes(e2) {
    return this._startPiece <= e2 && this._endPiece >= e2;
  }
  _destroy() {
    this._destroyed = true, this._torrent = null;
    for (const e2 of this._fileStreams) e2.destroy();
    this._fileStreams.clear();
    for (const e2 of this._iterators) e2.destroy();
    this._iterators.clear();
  }
};
var dt = n(5658);
var ut = class {
  constructor(e2) {
    this._torrent = e2, this._numPieces = e2.pieces.length, this._pieces = new Array(this._numPieces), this._onWire = (e3) => {
      this.recalculate(), this._initWire(e3);
    }, this._onWireHave = (e3) => {
      this._pieces[e3] += 1;
    }, this._onWireBitfield = () => {
      this.recalculate();
    }, this._torrent.wires.forEach((e3) => {
      this._initWire(e3);
    }), this._torrent.on("wire", this._onWire), this.recalculate();
  }
  getRarestPiece(e2) {
    let t2 = [], i2 = 1 / 0;
    for (let s2 = 0; s2 < this._numPieces; ++s2) {
      if (e2 && !e2(s2)) continue;
      const n2 = this._pieces[s2];
      n2 === i2 ? t2.push(s2) : n2 < i2 && (t2 = [s2], i2 = n2);
    }
    return t2.length ? t2[Math.random() * t2.length | 0] : -1;
  }
  destroy() {
    this._torrent.removeListener("wire", this._onWire), this._torrent.wires.forEach((e2) => {
      this._cleanupWireEvents(e2);
    }), this._torrent = null, this._pieces = null, this._onWire = null, this._onWireHave = null, this._onWireBitfield = null;
  }
  _initWire(e2) {
    e2._onClose = () => {
      this._cleanupWireEvents(e2);
      for (let t2 = 0; t2 < this._numPieces; ++t2) this._pieces[t2] -= e2.peerPieces.get(t2);
    }, e2.on("have", this._onWireHave), e2.on("bitfield", this._onWireBitfield), e2.once("close", e2._onClose);
  }
  recalculate() {
    this._pieces.fill(0);
    for (const e2 of this._torrent.wires) for (let t2 = 0; t2 < this._numPieces; ++t2) this._pieces[t2] += e2.peerPieces.get(t2);
  }
  _cleanupWireEvents(e2) {
    e2.removeListener("have", this._onWireHave), e2.removeListener("bitfield", this._onWireBitfield), e2._onClose && e2.removeListener("close", e2._onClose), e2._onClose = null;
  }
};
var pt = n(4343);
var ft = n(6458);
var mt = n(6819);
var _t = T("webtorrent:webconn");
var gt = class extends ft.A {
  constructor(e2, t2) {
    super(), this.url = e2, this.connId = e2, this._torrent = t2, this._init(e2);
  }
  _init(e2) {
    this.setKeepAlive(true), this.use(Xe()), this.once("handshake", async (t2, i2) => {
      const s2 = await (0, w.tW)(e2, "hex");
      if (this.destroyed) return;
      this.handshake(t2, s2);
      const n2 = this._torrent.pieces.length, r2 = new de.A(n2);
      for (let e3 = 0; e3 <= n2; e3++) r2.set(e3, true);
      this.bitfield(r2);
    }), this.once("interested", () => {
      _t("interested"), this.unchoke();
    }), this.on("uninterested", () => {
      _t("uninterested");
    }), this.on("choke", () => {
      _t("choke");
    }), this.on("unchoke", () => {
      _t("unchoke");
    }), this.on("bitfield", () => {
      _t("bitfield");
    }), this.lt_donthave.on("donthave", () => {
      _t("donthave");
    }), this.on("request", (e3, t2, i2, s2) => {
      _t("request pieceIndex=%d offset=%d length=%d", e3, t2, i2), this.httpRequest(e3, t2, i2, (t3, i3) => {
        if (t3) {
          this.lt_donthave.donthave(e3);
          const t4 = setTimeout(() => {
            this.destroyed || this.have(e3);
          }, 1e4);
          t4.unref && t4.unref();
        }
        s2(t3, i3);
      });
    });
  }
  async httpRequest(e2, t2, i2, s2) {
    s2 = ge(s2);
    const n2 = e2 * this._torrent.pieceLength + t2, r2 = n2 + i2 - 1, o2 = this._torrent.files;
    let a2, h2;
    if (o2.length <= 1) a2 = [{ url: this.url, start: n2, end: r2 }];
    else {
      const e3 = o2.filter((e4) => e4.offset <= r2 && e4.offset + e4.length > n2);
      if (e3.length < 1) return s2(new Error("Could not find file corresponding to web seed range request"));
      a2 = e3.map((e4) => {
        const t3 = e4.offset + e4.length - 1;
        return { url: this.url + ("/" === this.url[this.url.length - 1] ? "" : "/") + e4.path.replace(this._torrent.path, ""), fileOffsetInRange: Math.max(e4.offset - n2, 0), start: Math.max(n2 - e4.offset, 0), end: Math.min(t3, r2 - e4.offset) };
      });
    }
    try {
      h2 = await Promise.all(a2.map(async ({ start: s3, end: n3, url: r3 }) => {
        _t("Requesting url=%s pieceIndex=%d offset=%d length=%d start=%d end=%d", r3, e2, t2, i2, s3, n3);
        const o3 = await R(r3, { cache: "no-store", method: "GET", headers: { "Cache-Control": "no-store", "user-agent": `WebTorrent/${mt} (https://webtorrent.io)`, range: `bytes=${s3}-${n3}` }, signal: AbortSignal.timeout(6e4) });
        if (!o3.ok) throw new Error(`Unexpected HTTP status code ${o3.status}`);
        const a3 = new Uint8Array(await o3.arrayBuffer());
        return _t("Got data of length %d", a3.length), a3;
      }));
    } catch (e3) {
      return s2(e3);
    }
    s2(null, (0, w.xW)(h2));
  }
  destroy() {
    super.destroy(), this._torrent = null;
  }
};
var yt = class {
  _items = [];
  remove(e2) {
    for (let t2 = 0; t2 < this._items.length; t2++) {
      const i2 = this._items[t2];
      if (!i2.isStreamSelection == !e2.isStreamSelection) if (i2.isStreamSelection) {
        if (i2.from === e2.from && i2.to === e2.to) {
          this._items.splice(t2, 1);
          break;
        }
      } else if (wt(e2, i2)) i2.to = Math.max(e2.from - 1, 0);
      else if (bt(e2, i2)) i2.from = e2.to + 1;
      else if (vt(e2, i2)) {
        const s2 = [], n2 = { ...i2, to: Math.max(e2.from - 1, 0) };
        n2.to - n2.from >= 0 && 0 !== e2.from && s2.push(n2);
        const r2 = { ...i2, from: e2.to + 1 };
        r2.to - r2.from >= 0 && s2.push(r2), this._items.splice(t2, 1, ...s2), t2 = t2 - 1 + s2.length;
      } else kt(e2, i2) && (this._items.splice(t2, 1), t2--);
    }
  }
  _mergePriorityAndNotify(e2, t2) {
    if ((t2.priority ?? 0) > (e2.priority ?? 0) && (e2.priority = t2.priority), e2.notify && t2.notify) {
      const i2 = e2.notify;
      e2.notify = () => {
        i2(), t2.notify?.();
      };
    } else e2.notify = t2.notify || e2.notify;
  }
  concatenate(e2) {
    for (let t2 = 0; t2 < this._items.length; t2++) {
      const i2 = this._items[t2];
      if (!i2.isStreamSelection) {
        if (wt(e2, i2)) e2.from = i2.from;
        else if (bt(e2, i2)) e2.to = i2.to;
        else {
          if (!vt(e2, i2)) {
            if (kt(e2, i2)) continue;
            continue;
          }
          e2.from = i2.from, e2.to = i2.to;
        }
        this._mergePriorityAndNotify(e2, i2);
      }
    }
    this.remove(e2);
  }
  insert(e2) {
    if (e2.from > e2.to) throw new Error("Invalid interval");
    e2.isStreamSelection || this.concatenate(e2), this._items.push(e2);
  }
  sort(e2 = (e3, t2) => e3.from - t2.from) {
    this._items.sort(e2);
  }
  get length() {
    return this._items.length;
  }
  get(e2) {
    return this._items[e2];
  }
  swap(e2, t2) {
    const i2 = this._items[e2];
    this._items[e2] = this._items[t2], this._items[t2] = i2;
  }
  clear() {
    this._items.length = 0;
  }
  *[Symbol.iterator]() {
    for (let e2 = 0; e2 < this._items.length; e2++) {
      const t2 = this._items[e2];
      t2.remove = () => {
        this._items.splice(e2, 1), e2--;
      }, yield t2, delete t2.remove;
    }
  }
};
function wt(e2, t2) {
  return e2.from <= t2.to + 1 && e2.from > t2.from && e2.to > t2.to;
}
function bt(e2, t2) {
  return e2.to >= t2.from - 1 && e2.to < t2.to && e2.from < t2.from;
}
function vt(e2, t2) {
  const i2 = t2.to - t2.from, s2 = e2.to - e2.from;
  return e2.from >= t2.from && e2.to <= t2.to && s2 < i2;
}
function kt(e2, t2) {
  return e2.from <= t2.from && e2.to >= t2.to;
}
var xt = n(717);
var St = T("webtorrent:torrent");
var Et = 5e3;
var Ct = 3 * tt.BLOCK_LENGTH;
var Pt = xt.browser ? me().length : 2;
var At = [1e3, 5e3, 15e3];
var Tt = `WebTorrent/${mt} (https://webtorrent.io)`;
var It = globalThis.navigator?.storage?.getDirectory && globalThis.FileSystemFileHandle?.prototype?.createWritable;
var Lt = !xt.browser || It ? Ge : Qe;
var Ot;
try {
  Ot = h(re.statSync("/tmp") && "/tmp", "webtorrent");
} catch (e2) {
  Ot = h("function" == typeof ae.tmpdir ? ae.tmpdir() : "/", "webtorrent");
}
var Rt = "undefined" != typeof window && "function" == typeof window.requestIdleCallback && window.requestIdleCallback;
var Ht = class extends r {
  constructor(e2, t2, i2) {
    super(), this._debugId = "unknown infohash", this.client = t2, this.announce = i2.announce, this.urlList = i2.urlList, this.path = i2.path || Ot, this.addUID = i2.addUID || false, this.rootDir = i2.rootDir || null, this.skipVerify = !!i2.skipVerify, this._startupBitfield = i2.bitfield, this._store = i2.store || Lt, this._preloadedStore = i2.preloadedStore || null, this._storeCacheSlots = void 0 !== i2.storeCacheSlots ? i2.storeCacheSlots : 20, this._destroyStoreOnDestroy = i2.destroyStoreOnDestroy || false, this.store = null, this.storeOpts = i2.storeOpts, this.alwaysChokeSeeders = i2.alwaysChokeSeeders ?? true, this._getAnnounceOpts = i2.getAnnounceOpts, "boolean" == typeof i2.private && (this.private = i2.private), this.strategy = i2.strategy || "sequential", this.maxWebConns = i2.maxWebConns || 4, this._rechokeNumSlots = false === i2.uploads || 0 === i2.uploads ? 0 : +i2.uploads || 10, this._rechokeOptimisticWire = null, this._rechokeOptimisticTime = 0, this._rechokeIntervalId = null, this._noPeersIntervalId = null, this._noPeersIntervalTime = i2.noPeersIntervalTime ? 1e3 * i2.noPeersIntervalTime : 3e4, this._startAsDeselected = i2.deselect || false, this.ready = false, this.destroyed = false, this.paused = i2.paused || false, this.done = false, this.metadata = null, this.files = [], this.pieces = [], this._amInterested = false, this._selections = new yt(), this._critical = [], this.wires = [], this._queue = [], this._peers = /* @__PURE__ */ new Map(), this._peersLength = 0, this.received = 0, this.uploaded = 0, this._downloadSpeed = te(), this._uploadSpeed = te(), this._servers = [], this._xsRequests = [], this._fileModtimes = i2.fileModtimes, null !== e2 && this._onTorrentId(e2), this._debug("new torrent");
  }
  get timeRemaining() {
    return this.done ? 0 : 0 === this.downloadSpeed ? 1 / 0 : (this.length - this.downloaded) / this.downloadSpeed * 1e3;
  }
  get downloaded() {
    if (!this.bitfield) return 0;
    let e2 = 0;
    for (let t2 = 0, i2 = this.pieces.length; t2 < i2; ++t2) if (this.bitfield.get(t2)) e2 += t2 === i2 - 1 ? this.lastPieceLength : this.pieceLength;
    else {
      const i3 = this.pieces[t2];
      e2 += i3.length - i3.missing;
    }
    return e2;
  }
  get downloadSpeed() {
    return this._downloadSpeed();
  }
  get uploadSpeed() {
    return this._uploadSpeed();
  }
  get progress() {
    return this.length ? this.downloaded / this.length : 0;
  }
  get ratio() {
    return this.uploaded / (this.received || this.length);
  }
  get numPeers() {
    return this.wires.length;
  }
  get torrentFileBlob() {
    return this.torrentFile ? new Blob([this.torrentFile], { type: "application/x-bittorrent" }) : null;
  }
  get _numQueued() {
    return this._queue.length + (this._peersLength - this._numConns);
  }
  _numConns = 0;
  async _onTorrentId(e2) {
    if (this.destroyed) return;
    let t2;
    try {
      t2 = await q(e2);
    } catch (e3) {
    }
    t2 ? (this.infoHash = t2.infoHash, this._debugId = (0, w.V5)(t2.infoHash).substring(0, 7), y(() => {
      this.destroyed || this._onParsedTorrent(t2);
    })) : j(e2, (e3, t3) => {
      if (!this.destroyed) return e3 ? this._destroy(e3) : void this._onParsedTorrent(t3);
    });
  }
  _onParsedTorrent(e2) {
    if (!this.destroyed) {
      if (this._processParsedTorrent(e2), !this.infoHash) return this._destroy(new Error("Malformed torrent data: No info hash"));
      this._rechokeIntervalId = setInterval(() => {
        this._rechoke();
      }, 1e4), this._rechokeIntervalId.unref && this._rechokeIntervalId.unref(), this.emit("_infoHash", this.infoHash), this.destroyed || (this.emit("infoHash", this.infoHash), this.destroyed || (this.client.listening ? this._onListening() : this.client.once("listening", () => {
        this._onListening();
      })));
    }
  }
  _processParsedTorrent(e2) {
    this._debugId = (0, w.V5)(e2.infoHash).substring(0, 7), void 0 !== this.private && (e2.private = this.private), Array.isArray(this.announce) && (e2.announce = e2.announce.concat(this.announce)), this.client.tracker && Array.isArray(this.client.tracker.announce) && !e2.private && (e2.announce = e2.announce.concat(this.client.tracker.announce)), this.client.tracker && globalThis.WEBTORRENT_ANNOUNCE && !e2.private && (e2.announce = e2.announce.concat(globalThis.WEBTORRENT_ANNOUNCE)), this.urlList && (e2.urlList = e2.urlList.concat(this.urlList)), e2.announce = Array.from(new Set(e2.announce)), e2.urlList = Array.from(new Set(e2.urlList)), Object.assign(this, e2), this.magnetURI = W(e2), this.torrentFile = (function(e3) {
      const t2 = { info: e3.info };
      return t2["announce-list"] = (e3.announce || []).map((e4) => (t2.announce || (t2.announce = e4), [e4 = (0, w.L0)(e4)])), t2["url-list"] = e3.urlList || [], void 0 !== e3.private && (t2.private = Number(e3.private)), e3.created && (t2["creation date"] = e3.created.getTime() / 1e3 | 0), e3.createdBy && (t2["created by"] = e3.createdBy), e3.comment && (t2.comment = e3.comment), c.A.encode(t2);
    })(e2);
  }
  _onListening() {
    this.destroyed || (this.info ? this._onMetadata(this) : (this.xs && this._getMetadataFromServer(), this._startDiscovery()));
  }
  _startDiscovery() {
    if (this.discovery || this.destroyed) return;
    let e2 = this.client.tracker;
    e2 && (e2 = Object.assign({}, this.client.tracker, { getAnnounceOpts: () => {
      if (this.destroyed) return;
      const e3 = { uploaded: this.uploaded, downloaded: this.downloaded, left: Math.max(this.length - this.downloaded, 0) };
      return this.client.tracker.getAnnounceOpts && Object.assign(e3, this.client.tracker.getAnnounceOpts()), this._getAnnounceOpts && Object.assign(e3, this._getAnnounceOpts()), e3;
    } })), this.peerAddresses && this.peerAddresses.forEach((e3) => this.addPeer(e3, dt.default.SOURCE_MANUAL)), this.discovery = new Be({ infoHash: this.infoHash, announce: this.announce, peerId: this.client.peerId, dht: !this.private && this.client.dht, tracker: e2, port: this.client.torrentPort, userAgent: Tt, lsd: this.client.lsd }), this.discovery.on("error", (e3) => {
      this._destroy(e3);
    }), this.discovery.on("peer", (e3, t2) => {
      this._debug("peer %s discovered via %s", e3, t2), this.client.seedOutgoingConnections || !this.done ? this.addPeer(e3, t2) : this._debug("discovery ignoring peer %s: torrent is done and seedOutgoingConnections is false", e3);
    }), this.discovery.on("trackerAnnounce", () => {
      this.emit("trackerAnnounce");
    }), this.discovery.on("dhtAnnounce", () => {
      this.emit("dhtAnnounce");
    }), this.discovery.on("warning", (e3) => {
      this.emit("warning", e3);
    }), this._noPeersIntervalId = setInterval(() => {
      if (this.destroyed) return;
      const e3 = { [dt.default.SOURCE_TRACKER]: { enabled: !!this.client.tracker, numPeers: 0 }, [dt.default.SOURCE_DHT]: { enabled: !!this.client.dht, numPeers: 0 }, [dt.default.SOURCE_LSD]: { enabled: !!this.client.lsd, numPeers: 0 }, [dt.default.SOURCE_UT_PEX]: { enabled: this.client.utPex && "function" == typeof ot, numPeers: 0 } };
      for (const t2 of this._peers.values()) {
        const i2 = e3[t2.source];
        void 0 !== i2 && i2.numPeers++;
      }
      for (const t2 of Object.keys(e3)) {
        const i2 = e3[t2];
        i2.enabled && 0 === i2.numPeers && this.emit("noPeers", t2);
      }
    }, this._noPeersIntervalTime), this._noPeersIntervalId.unref && this._noPeersIntervalId.unref();
  }
  _getMetadataFromServer() {
    const e2 = this, t2 = Array.isArray(this.xs) ? this.xs : [this.xs];
    e2._xsRequestsController = new AbortController();
    const i2 = e2._xsRequestsController.signal, s2 = t2.map((t3) => (s3) => {
      !(async function(t4, s4) {
        if (0 !== t4.indexOf("http://") && 0 !== t4.indexOf("https://")) return e2.emit("warning", new Error(`skipping non-http xs param: ${t4}`)), s4(null);
        const n2 = { method: "GET", headers: { "user-agent": Tt }, signal: i2 };
        let r2, o2, a2;
        try {
          r2 = await R(t4, n2);
        } catch (i3) {
          return e2.emit("warning", new Error(`http error from xs param: ${t4}`)), s4(null);
        }
        if (e2.destroyed) return s4(null);
        if (e2.metadata) return s4(null);
        if (200 !== r2.status) return e2.emit("warning", new Error(`non-200 status code ${r2.status} from xs param: ${t4}`)), s4(null);
        try {
          o2 = new Uint8Array(await r2.arrayBuffer());
        } catch (t5) {
          return e2.emit("warning", t5), s4(null);
        }
        try {
          a2 = await q(o2);
        } catch (e3) {
        }
        if (!a2) return e2.emit("warning", new Error(`got invalid torrent file from xs param: ${t4}`)), s4(null);
        if (a2.infoHash !== e2.infoHash) return e2.emit("warning", new Error(`got torrent file with incorrect info hash from xs param: ${t4}`)), s4(null);
        e2._onMetadata(a2), s4(null);
      })(t3, s3);
    });
    g(s2);
  }
  async _onMetadata(e2) {
    if (this.metadata || this.destroyed) return;
    let t2;
    if (this._debug("got metadata"), this._xsRequestsController?.abort(), this._xsRequestsController = null, e2 && e2.infoHash) t2 = e2;
    else try {
      t2 = await q(e2);
    } catch (e3) {
      return this._destroy(e3);
    }
    this._processParsedTorrent(t2), this.metadata = this.torrentFile, this.client.enableWebSeeds && this.urlList.forEach((e3) => {
      this.addWebSeed(e3);
    }), this._rarityMap = new ut(this), this.files = this.files.map((e3) => new ct(this, e3));
    let i2 = this._preloadedStore;
    if (i2 || (i2 = new this._store(this.pieceLength, { ...this.storeOpts, torrent: this, path: this.path, files: this.files, length: this.length, name: this.name + " - " + this.infoHash.slice(0, 8), addUID: this.addUID, rootDir: this.rootDir, max: this._storeCacheSlots })), this._storeCacheSlots > 0 && !(i2 instanceof Qe) && (i2 = new ue(i2, { max: this._storeCacheSlots })), this.store = new Ke(i2), this.so && !this._startAsDeselected ? this.files.forEach((e3, t3) => {
      this.so.includes(t3) && this.files[t3].select();
    }) : 0 === this.pieces.length || this._startAsDeselected || this.select(0, this.pieces.length - 1), this._hashes = this.pieces, this._hasStartupBitfield = this._startupBitfield && this._startupBitfield.length === Math.ceil(this.pieces.length / 8) && !this.skipVerify, this.bitfield = new de.A(this._hasStartupBitfield ? new Uint8Array(this._startupBitfield) : this.pieces.length), this._reservations = this._hasStartupBitfield ? this.pieces.map((e3, t3) => this.bitfield.get(t3) ? null : []) : this.pieces.map(() => []), this.pieces = this.pieces.map((e3, t3) => {
      if (this._hasStartupBitfield && this.bitfield.get(t3)) return null;
      const i3 = t3 === this.pieces.length - 1 ? this.lastPieceLength : this.pieceLength;
      return new tt(i3);
    }), this.emit("metadata"), !this.destroyed) if (this.skipVerify) this._markAllVerified(), this._onStore();
    else {
      const e3 = (e4) => {
        if (e4) return this._destroy(e4);
        this._debug("done verifying"), this._onStore();
      };
      this._debug("verifying existing torrent data"), this._fileModtimes && this._store === Ge ? this.getFileModtimes((t3, i3) => {
        if (t3) return this._destroy(t3);
        this.files.map((e4, t4) => i3[t4] === this._fileModtimes[t4]).every((e4) => e4) ? (this._markAllVerified(), this._onStore()) : this._verifyPieces(e3);
      }) : this._verifyPieces(e3);
    }
  }
  getFileModtimes(e2) {
    const t2 = [];
    Ze(this.files.map((e3, i2) => (s2) => {
      const n2 = this.addUID ? h(this.name + " - " + this.infoHash.slice(0, 8)) : h(this.path, e3.path);
      re.stat(n2, (e4, n3) => {
        if (e4 && "ENOENT" !== e4.code) return s2(e4);
        t2[i2] = n3 && n3.mtime.getTime(), s2(null);
      });
    }), Pt, (i2) => {
      this._debug("done getting file modtimes"), e2(i2, t2);
    });
  }
  _verifyPiece(e2, t2) {
    if (this.destroyed) return t2(new Error("torrent is destroyed"));
    const i2 = {};
    e2 === this.pieces.length - 1 && (i2.length = this.lastPieceLength), this.store.get(e2, i2, async (i3, s2) => {
      if (this.destroyed) return t2(new Error("torrent is destroyed"));
      if (i3) return y(() => t2(null, false));
      const n2 = await (0, w.tW)(s2, "hex");
      if (this.destroyed) return t2(new Error("torrent is destroyed"));
      t2(null, n2 === this._hashes[e2]);
    });
  }
  _verifyPiecesUsingBitfield(e2) {
    const t2 = /* @__PURE__ */ new Set(), i2 = /* @__PURE__ */ new Map();
    for (const e3 of this.files) {
      let s2 = 2, n2 = null;
      for (let t3 = e3._startPiece; t3 <= e3._endPiece; ++t3) this.bitfield.get(t3) && (s2 && (n2 = t3, s2--), i2.has(t3) || i2.set(t3, []), i2.get(t3).push(e3));
      null !== n2 && t2.add(n2);
    }
    this._verifyPiecesUsingHash([...t2], (s2) => {
      if (s2) return e2(s2);
      const n2 = /* @__PURE__ */ new Set();
      for (const e3 of t2) if (!this.bitfield.get(e3)) {
        const t3 = i2.get(e3);
        for (const e4 of t3) n2.add(e4);
      }
      if (n2.size) {
        const t3 = [];
        for (const e3 of n2) for (let i3 = e3._startPiece; i3 <= e3._endPiece; ++i3) -1 === t3.indexOf(i3) && t3.push(i3);
        return this._verifyPiecesUsingHash(t3, e2);
      }
      e2(null);
    });
  }
  _verifyPiecesUsingHash(e2, t2) {
    Ze(e2.map((e3, t3) => (i2) => {
      const s2 = Number.isInteger(e3) ? e3 : t3;
      this._verifyPiece(s2, (e4, t4) => {
        if (e4) return i2(e4);
        t4 ? (this._debug("piece verified %s", s2), this._markVerified(s2)) : (this._markUnverified(s2), this._debug("piece invalid %s", s2)), i2(null);
      });
    }), Pt, t2);
  }
  _verifyPieces(e2) {
    if (this._hasStartupBitfield) return this._verifyPiecesUsingBitfield(e2);
    this._verifyPiecesUsingHash(this.pieces, e2);
  }
  rescanFiles(e2) {
    if (this.destroyed) throw new Error("torrent is destroyed");
    e2 || (e2 = Mt), this._verifyPiecesUsingHash(this.pieces, (t2) => {
      if (t2) return this._destroy(t2), e2(t2);
      this._checkDone(), e2(null);
    });
  }
  _markAllVerified() {
    for (let e2 = 0; e2 < this.pieces.length; e2++) this._markVerified(e2);
  }
  _markVerified(e2) {
    this.pieces[e2] = null, this._reservations[e2] = null, this.bitfield.set(e2, true), this.emit("verified", e2);
  }
  _markUnverified(e2) {
    const t2 = e2 === this.pieces.length - 1 ? this.lastPieceLength : this.pieceLength;
    this.pieces[e2] = new tt(t2), this.bitfield.set(e2, false), this._startAsDeselected || this.select(e2, e2);
    for (const t3 of this.files) t3.done && t3.includes(e2) && (t3.done = false);
  }
  _hasAllPieces() {
    for (let e2 = 0; e2 < this.pieces.length; e2++) if (!this.bitfield.get(e2)) return false;
    return true;
  }
  _hasNoPieces() {
    return !this._hasMorePieces(0);
  }
  _hasMorePieces(e2) {
    let t2 = 0;
    for (let i2 = 0; i2 < this.pieces.length; i2++) if (this.bitfield.get(i2) && (t2 += 1, t2 > e2)) return true;
    return false;
  }
  _onStore() {
    this.destroyed || (this._debug("on store"), this._startDiscovery(), this.ready = true, this.emit("ready"), this._checkDone(), this._updateSelections(), this.wires.forEach((e2) => {
      e2.ut_metadata && e2.ut_metadata.setMetadata(this.metadata), this._onWireWithMetadata(e2);
    }));
  }
  destroy(e2, t2) {
    if ("function" == typeof e2) return this.destroy(null, e2);
    this._destroy(null, e2, t2);
  }
  _destroy(e2, t2, i2) {
    if ("function" == typeof t2) return this._destroy(e2, null, t2);
    if (this.destroyed) return;
    this.destroyed = true, this._debug("destroy"), this.client._remove(this), this._selections.clear(), clearInterval(this._rechokeIntervalId), clearInterval(this._noPeersIntervalId), this._xsRequestsController?.abort(), this._rarityMap && this._rarityMap.destroy();
    for (const e3 of this._peers.keys()) this.removePeer(e3);
    for (const e3 of this.files) e3 instanceof ct && e3._destroy();
    const s2 = this._servers.map((e3) => (t3) => {
      e3.destroy(t3);
    });
    if (this.discovery && s2.push((e3) => {
      this.discovery.destroy(e3);
    }), this.store) {
      let e3 = this._destroyStoreOnDestroy;
      t2 && void 0 !== t2.destroyStore && (e3 = t2.destroyStore), s2.push((t3) => {
        e3 ? this.store.destroy(t3) : this.store.close(t3);
      });
    }
    g(s2, i2), e2 && (0 === this.listenerCount("error") ? this.client.emit("error", e2) : this.emit("error", e2)), this.emit("close"), this.client = null, this.files = [], this.discovery = null, this.store = null, this._rarityMap = null, this._peers.clear(), this._peers = null, this._servers = null, this._xsRequests = null, this._queue = null;
  }
  addPeer(e2, t2) {
    if (this.destroyed) throw new Error("torrent is destroyed");
    if (!this.infoHash) throw new Error("addPeer() must not be called before the `infoHash` event");
    let i2;
    if ("string" == typeof e2) {
      let t3;
      try {
        t3 = ce(e2);
      } catch (t4) {
        return this._debug("ignoring peer: invalid %s", e2), this.emit("invalidPeer", e2), false;
      }
      i2 = t3[0];
    } else "string" == typeof e2.remoteAddress && (i2 = e2.remoteAddress);
    if (this.client.blocked && i2 && this.client.blocked.contains(i2)) return this._debug("ignoring peer: blocked %s", e2), "string" != typeof e2 && e2.destroy(), this.emit("blockedPeer", e2), false;
    const s2 = this.client.utp && this._isIPv4(i2) ? "utp" : "tcp", n2 = !!this._addPeer(e2, s2, t2);
    return n2 ? this.emit("peer", e2) : this.emit("invalidPeer", e2), n2;
  }
  _addPeer(e2, t2, i2) {
    if (this.destroyed) return "string" != typeof e2 && e2.destroy(), null;
    if ("string" == typeof e2 && !this._validAddr(e2)) return this._debug("ignoring peer: invalid %s", e2), null;
    const s2 = e2 && e2.id || e2;
    if (this._peers.has(s2)) return this._debug("ignoring peer: duplicate (%s)", s2), "string" != typeof e2 && e2.destroy(), null;
    if (this.paused) return this._debug("ignoring peer: torrent is paused"), "string" != typeof e2 && e2.destroy(), null;
    let n2;
    return this._debug("add peer %s", s2), n2 = "string" == typeof e2 ? "utp" === t2 ? dt.default.createUTPOutgoingPeer(e2, this, this.client.throttleGroups, i2) : dt.default.createTCPOutgoingPeer(e2, this, this.client.throttleGroups, i2) : dt.default.createWebRTCPeer(e2, this, this.client.throttleGroups, i2), this._registerPeer(n2), "string" == typeof e2 && (this._queue.push(n2), this._drain()), n2;
  }
  addWebSeed(e2) {
    if (this.destroyed) throw new Error("torrent is destroyed");
    let t2, i2;
    if ("string" == typeof e2) {
      if (t2 = e2, !/^https?:\/\/.+/.test(t2)) return this.emit("warning", new Error(`ignoring invalid web seed: ${t2}`)), void this.emit("invalidPeer", t2);
      if (this._peers.has(t2)) return this.emit("warning", new Error(`ignoring duplicate web seed: ${t2}`)), void this.emit("invalidPeer", t2);
      i2 = new gt(t2, this);
    } else {
      if (!e2 || "string" != typeof e2.connId) return void this.emit("warning", new Error("addWebSeed must be passed a string or connection object with id property"));
      if (i2 = e2, t2 = i2.connId, this._peers.has(t2)) return this.emit("warning", new Error(`ignoring duplicate web seed: ${t2}`)), void this.emit("invalidPeer", t2);
    }
    this._debug("add web seed %s", t2);
    const s2 = dt.default.createWebSeedPeer(i2, t2, this, this.client.throttleGroups);
    this._registerPeer(s2), this.emit("peer", t2);
  }
  _addIncomingPeer(e2) {
    return this.destroyed ? e2.destroy(new Error("torrent is destroyed")) : this.paused ? e2.destroy(new Error("torrent is paused")) : (this._debug("add incoming peer %s", e2.id), void this._registerPeer(e2));
  }
  _registerPeer(e2) {
    e2.on("download", (e3) => {
      this.destroyed || (this.received += e3, this._downloadSpeed(e3), this.client._downloadSpeed(e3), this.emit("download", e3), this.destroyed || this.client.emit("download", e3));
    }), e2.on("upload", (e3) => {
      this.destroyed || (this.uploaded += e3, this._uploadSpeed(e3), this.client._uploadSpeed(e3), this.emit("upload", e3), this.destroyed || this.client.emit("upload", e3));
    }), e2.connected ? this._numConns += 1 : e2.once("connect", () => {
      this.destroyed || (this._numConns += 1);
    }), e2.once("disconnect", () => {
      this._numConns -= 1;
    }), this._peers.set(e2.id, e2), this._peersLength += 1;
  }
  removePeer(e2) {
    const t2 = e2?.id || e2;
    e2 && !e2.id && (e2 = this._peers?.get(t2)), e2 && (e2.destroy(), this.destroyed || (this._debug("removePeer %s", t2), this._peers.delete(t2), this._peersLength -= 1, this._drain()));
  }
  _select(e2 = 0, t2 = this.pieces.length - 1, i2, s2, n2 = false) {
    if (this.destroyed) throw new Error("torrent is destroyed");
    if (e2 < 0 || t2 < e2 || this.pieces.length <= t2) throw new Error(`invalid selection ${e2} : ${t2}`);
    i2 = Number(i2) || 0, this._debug("select %s-%s (priority %s)", e2, t2, i2), this._selections.insert({ from: e2, to: t2, offset: 0, priority: i2, notify: s2, isStreamSelection: n2 }), this._selections.sort((e3, t3) => t3.priority - e3.priority), this._updateSelections();
  }
  select(e2, t2, i2, s2) {
    this._select(e2, t2, i2, s2, false);
  }
  _deselect(e2, t2, i2 = false) {
    if (this.destroyed) throw new Error("torrent is destroyed");
    this._debug("deselect %s-%s", e2, t2), this._selections.remove({ from: e2, to: t2, isStreamSelection: i2 }), this._updateSelections();
  }
  deselect(e2, t2) {
    this._deselect(e2, t2, false);
  }
  critical(e2, t2) {
    if (this.destroyed) throw new Error("torrent is destroyed");
    this._debug("critical %s-%s", e2, t2);
    for (let i2 = e2; i2 <= t2; ++i2) this._critical[i2] = true;
    this._updateSelections();
  }
  _onWire(e2, t2) {
    if (this._debug("got wire %s (%s)", e2._debugId, t2 || "Unknown"), this.wires.push(e2), t2) {
      const i2 = ce(t2);
      e2.remoteAddress = i2[0], e2.remotePort = i2[1];
    }
    this.client.dht && this.client.dht.listening && e2.on("port", (i2) => {
      if (!this.destroyed && !this.client.dht.destroyed) {
        if (!e2.remoteAddress) return this._debug("ignoring PORT from peer with no address");
        if (0 === i2 || i2 > 65536) return this._debug("ignoring invalid PORT from peer");
        this._debug("port: %s (from %s)", i2, t2), this.client.dht.addNode({ host: e2.remoteAddress, port: i2 });
      }
    }), e2.on("timeout", () => {
      this._debug("wire timeout (%s)", t2), e2.destroy();
    }), "webSeed" !== e2.type && e2.setTimeout(3e4, true), e2.setKeepAlive(true), e2.use(rt(this.metadata)), e2.ut_metadata.on("warning", (e3) => {
      this._debug("ut_metadata warning: %s", e3.message);
    }), this.metadata || (e2.ut_metadata.on("metadata", (e3) => {
      this._debug("got metadata via ut_metadata"), this._onMetadata(e3);
    }), e2.ut_metadata.fetch()), this.client.utPex && "function" == typeof ot && !this.private && (e2.use(ot()), e2.ut_pex.on("peer", (e3) => {
      this.client.seedOutgoingConnections || !this.done ? (this._debug("ut_pex: got peer: %s (from %s)", e3, t2), this.addPeer(e3, dt.default.SOURCE_UT_PEX)) : this._debug("ut_pex ignoring peer %s: torrent is done and seedOutgoingConnections is false", e3);
    }), e2.ut_pex.on("dropped", (e3) => {
      const i2 = this._peers.get(e3);
      i2 && !i2.connected && (this._debug("ut_pex: dropped peer: %s (from %s)", e3, t2), this.removePeer(e3));
    }), e2.once("close", () => {
      e2.ut_pex.reset();
    })), e2.use(Xe()), this.emit("wire", e2, t2), this.ready && y(() => {
      this._onWireWithMetadata(e2);
    });
  }
  _onWireWithMetadata(e2) {
    let t2 = null;
    const i2 = () => {
      this.destroyed || e2.destroyed || (this._numQueued > 2 * (this._numConns - this.numPeers) && e2.amInterested ? e2.destroy() : (t2 = setTimeout(i2, Et), t2.unref && t2.unref()));
    };
    let s2;
    const n2 = () => {
      if (e2.peerPieces.buffer.length && e2.peerPieces.setAll) {
        if (e2.peerPieces.buffer.length !== this.bitfield.buffer.length) return;
        for (s2 = 0; s2 < this.pieces.length; ++s2) if (!e2.peerPieces.get(s2)) return;
      }
      e2.isSeeder = true, this.alwaysChokeSeeders && e2.choke();
    };
    e2.on("bitfield", () => {
      n2(), this._update(), this._updateWireInterest(e2);
    }), e2.on("have", () => {
      n2(), this._update(), this._updateWireInterest(e2);
    }), e2.lt_donthave.on("donthave", () => {
      n2(), this._update(), this._updateWireInterest(e2);
    }), e2.on("have-all", () => {
      e2.isSeeder = true, this.alwaysChokeSeeders && e2.choke(), this._update(), this._updateWireInterest(e2);
    }), e2.on("have-none", () => {
      e2.isSeeder = false, this._update(), this._updateWireInterest(e2);
    }), e2.on("allowed-fast", (e3) => {
      this._update();
    }), e2.once("interested", () => {
      e2.unchoke();
    }), e2.once("close", () => {
      clearTimeout(t2);
    }), e2.on("choke", () => {
      clearTimeout(t2), t2 = setTimeout(i2, Et), t2.unref && t2.unref();
    }), e2.on("unchoke", () => {
      clearTimeout(t2), this._update();
    }), e2.on("request", (t3, i3, s3, n3) => {
      if (s3 > 131072) return e2.destroy();
      this.pieces[t3] || this.store.get(t3, { offset: i3, length: s3 }, n3);
    }), e2.hasFast && this._hasAllPieces() ? e2.haveAll() : e2.hasFast && this._hasNoPieces() ? e2.haveNone() : e2.bitfield(this.bitfield), this._updateWireInterest(e2), e2.peerExtensions.dht && this.client.dht && this.client.dht.listening && e2.port(this.client.dht.address().port), "webSeed" !== e2.type && (t2 = setTimeout(i2, Et), t2.unref && t2.unref()), e2.isSeeder = false, n2();
  }
  _updateSelections() {
    this.ready && !this.destroyed && (y(() => {
      this._gcSelections();
    }), this._updateInterest(), this._update());
  }
  _gcSelections() {
    for (const e2 of this._selections) {
      const t2 = e2.offset;
      for (; this.bitfield.get(e2.from + e2.offset) && e2.from + e2.offset < e2.to; ) e2.offset += 1;
      t2 !== e2.offset && e2.notify?.(), e2.to === e2.from + e2.offset && (this.bitfield.get(e2.from + e2.offset) && (e2.remove(), e2.notify?.(), this._updateInterest()));
    }
    this._selections.length || this.emit("idle");
  }
  _updateInterest() {
    const e2 = this._amInterested;
    this._amInterested = !!this._selections.length, this.wires.forEach((e3) => this._updateWireInterest(e3)), e2 !== this._amInterested && (this._amInterested ? this.emit("interested") : this.emit("uninterested"));
  }
  _updateWireInterest(e2) {
    let t2 = false;
    for (let i2 = 0; i2 < this.pieces.length; ++i2) if (this.pieces[i2] && e2.peerPieces.get(i2)) {
      t2 = true;
      break;
    }
    t2 ? e2.interested() : e2.uninterested();
  }
  _update() {
    Rt ? Rt(() => this._updateWireWrapper(), { timeout: 250 }) : this._updateWireWrapper();
  }
  _updateWireWrapper() {
    if (this.destroyed) return;
    const e2 = it(this.wires);
    let t2;
    for (; t2 = e2(); ) this._updateWire(t2);
  }
  _updateWire(e2) {
    if (e2.destroyed) return false;
    const t2 = this, i2 = Nt(e2, 0.5);
    if (e2.requests.length >= i2) return;
    const s2 = Nt(e2, 1);
    if (e2.peerChoking) e2.hasFast && e2.peerAllowedFastSet.length > 0 && !this._hasMorePieces(e2.peerAllowedFastSet.length - 1) && (function() {
      if (e2.requests.length >= s2) return false;
      for (const i3 of e2.peerAllowedFastSet) {
        if (e2.peerPieces.get(i3) && !t2.bitfield.get(i3)) for (; t2._request(e2, i3, false) && e2.requests.length < s2; ) ;
        if (!(e2.requests.length < s2)) return true;
      }
    })();
    else {
      if (!e2.downloaded) return (function() {
        if (e2.requests.length) return;
        let i3 = t2._selections.length;
        for (; i3--; ) {
          const s3 = t2._selections.get(i3);
          let r3;
          if ("rarest" === t2.strategy) {
            const i4 = s3.from + s3.offset, o3 = s3.to, a2 = o3 - i4 + 1, h2 = {};
            let l2 = 0;
            const c2 = n2(i4, o3, h2);
            for (; l2 < a2 && (r3 = t2._rarityMap.getRarestPiece(c2), !(r3 < 0)); ) {
              if (t2._request(e2, r3, false)) return;
              h2[r3] = true, l2 += 1;
            }
          } else for (r3 = s3.to; r3 >= s3.from + s3.offset; --r3) if (e2.peerPieces.get(r3) && t2._request(e2, r3, false)) return;
        }
      })();
      o2(false) || o2(true);
    }
    function n2(t3, i3, s3, n3) {
      return (r3) => r3 >= t3 && r3 <= i3 && !(r3 in s3) && e2.peerPieces.get(r3) && (!n3 || n3(r3));
    }
    function r2(e3) {
      let i3 = e3;
      for (let s3 = e3; s3 < t2._selections.length && t2._selections.get(s3).priority; s3++) i3 = s3;
      t2._selections.swap(e3, i3);
    }
    function o2(i3) {
      if (e2.requests.length >= s2) return true;
      const o3 = (function() {
        const i4 = e2.downloadSpeed() || 1;
        if (i4 > Ct) return () => true;
        const s3 = Math.max(1, e2.requests.length) * tt.BLOCK_LENGTH / i4;
        let n3 = 10, r3 = 0;
        return (e3) => {
          if (!n3 || t2.bitfield.get(e3)) return true;
          let o4 = t2.pieces[e3].missing;
          for (; r3 < t2.wires.length; r3++) {
            const a2 = t2.wires[r3], h2 = a2.downloadSpeed();
            if (!(h2 < Ct) && !(h2 <= i4) && a2.peerPieces.get(e3) && !((o4 -= h2 * s3) > 0)) return n3--, false;
          }
          return true;
        };
      })();
      for (let a2 = 0; a2 < t2._selections.length; a2++) {
        const h2 = t2._selections.get(a2);
        let l2;
        if ("rarest" === t2.strategy) {
          const c2 = h2.from + h2.offset, d2 = h2.to, u2 = d2 - c2 + 1, p2 = {};
          let f2 = 0;
          const m2 = n2(c2, d2, p2, o3);
          for (; f2 < u2 && (l2 = t2._rarityMap.getRarestPiece(m2), !(l2 < 0)); ) {
            for (; t2._request(e2, l2, t2._critical[l2] || i3) && e2.requests.length < s2; ) ;
            if (!(e2.requests.length < s2)) return h2.priority && r2(a2), true;
            p2[l2] = true, f2++;
          }
        } else for (l2 = h2.from + h2.offset; l2 <= h2.to; l2++) if (e2.peerPieces.get(l2) && o3(l2)) {
          for (; t2._request(e2, l2, t2._critical[l2] || i3) && e2.requests.length < s2; ) ;
          if (!(e2.requests.length < s2)) return h2.priority && r2(a2), true;
        }
      }
      return false;
    }
  }
  _rechoke() {
    if (!this.ready) return;
    const e2 = this.wires.map((e3) => ({ wire: e3, random: Math.random() })).sort((e3, t3) => {
      const i3 = e3.wire, s2 = t3.wire;
      return i3.downloadSpeed() !== s2.downloadSpeed() ? i3.downloadSpeed() - s2.downloadSpeed() : i3.uploadSpeed() !== s2.uploadSpeed() ? i3.uploadSpeed() - s2.uploadSpeed() : i3.amChoking !== s2.amChoking ? i3.amChoking ? -1 : 1 : e3.random - t3.random;
    }).map((e3) => e3.wire);
    this._rechokeOptimisticTime <= 0 ? this._rechokeOptimisticWire = null : this._rechokeOptimisticTime -= 1;
    let t2 = 0;
    for (; e2.length > 0 && t2 < this._rechokeNumSlots - 1; ) {
      const i3 = e2.pop();
      i3.isSeeder || i3 === this._rechokeOptimisticWire || (i3.unchoke(), i3.peerInterested && t2++);
    }
    if (null === this._rechokeOptimisticWire && this._rechokeNumSlots > 0) {
      const t3 = e2.filter((e3) => e3.peerInterested);
      if (t3.length > 0) {
        const e3 = t3[i2 = t3.length, Math.random() * i2 | 0];
        e3.unchoke(), this._rechokeOptimisticWire = e3, this._rechokeOptimisticTime = 2;
      }
    }
    var i2;
    e2.filter((e3) => e3 !== this._rechokeOptimisticWire).forEach((e3) => e3.choke());
  }
  _hotswap(e2, t2) {
    const i2 = e2.downloadSpeed();
    if (i2 < tt.BLOCK_LENGTH) return false;
    if (!this._reservations[t2]) return false;
    const s2 = this._reservations[t2];
    if (!s2) return false;
    let n2, r2, o2 = 1 / 0;
    for (r2 = 0; r2 < s2.length; r2++) {
      const t3 = s2[r2];
      if (!t3 || t3 === e2) continue;
      const a2 = t3.downloadSpeed();
      a2 >= Ct || (2 * a2 > i2 || a2 > o2 || (n2 = t3, o2 = a2));
    }
    if (!n2) return false;
    for (r2 = 0; r2 < s2.length; r2++) s2[r2] === n2 && (s2[r2] = null);
    for (r2 = 0; r2 < n2.requests.length; r2++) {
      const e3 = n2.requests[r2];
      e3.piece === t2 && this.pieces[t2].cancel(e3.offset / tt.BLOCK_LENGTH | 0);
    }
    return this.emit("hotswap", n2, e2, t2), true;
  }
  _request(e2, t2, i2) {
    const s2 = this, n2 = e2.requests.length, r2 = "webSeed" === e2.type;
    if (s2.bitfield.get(t2)) return false;
    const o2 = r2 ? Math.min((function(e3, t3, i3) {
      return 1 + Math.ceil(t3 * e3.downloadSpeed() / i3);
    })(e2, 1, s2.pieceLength), s2.maxWebConns) : Nt(e2, 1);
    if (n2 >= o2) return false;
    const a2 = s2.pieces[t2];
    let h2 = r2 ? a2.reserveRemaining() : a2.reserve();
    if (-1 === h2 && i2 && s2._hotswap(e2, t2) && (h2 = r2 ? a2.reserveRemaining() : a2.reserve()), -1 === h2) return false;
    let l2 = s2._reservations[t2];
    l2 || (l2 = s2._reservations[t2] = []);
    let c2 = l2.indexOf(null);
    -1 === c2 && (c2 = l2.length), l2[c2] = e2;
    const d2 = a2.chunkOffset(h2), u2 = r2 ? a2.chunkLengthRemaining(h2) : a2.chunkLength(h2);
    function p2() {
      y(() => {
        s2._update();
      });
    }
    return e2.request(t2, d2, u2, async function i3(n3, o3) {
      if (s2.destroyed) return;
      if (!s2.ready) return s2.once("ready", () => {
        i3(n3, o3);
      });
      if (l2[c2] === e2 && (l2[c2] = null), a2 !== s2.pieces[t2]) return p2();
      if (n3) return s2._debug("error getting piece %s (offset: %s length: %s) from %s: %s", t2, d2, u2, `${e2.remoteAddress}:${e2.remotePort}`, n3.message), r2 ? a2.cancelRemaining(h2) : a2.cancel(h2), void p2();
      if (s2._debug("got piece %s (offset: %s length: %s) from %s", t2, d2, u2, `${e2.remoteAddress}:${e2.remotePort}`), !a2.set(h2, o3, e2)) return p2();
      const f2 = a2.flush(), m2 = await (0, w.tW)(f2, "hex");
      s2.destroyed || (m2 === s2._hashes[t2] ? (s2._debug("piece verified %s", t2), s2.store.put(t2, f2, (e3) => {
        e3 ? s2._destroy(e3) : (s2.pieces[t2] = null, s2._markVerified(t2), s2.wires.forEach((e4) => {
          e4.have(t2);
        }), s2._checkDone(), p2());
      })) : (s2.pieces[t2] = new tt(a2.length), s2.emit("warning", new Error(`Piece ${t2} failed verification`)), p2()));
    }), true;
  }
  _checkDone() {
    if (this.destroyed) return;
    this.files.forEach((e3) => {
      if (!e3.done) {
        for (let t2 = e3._startPiece; t2 <= e3._endPiece; ++t2) if (!this.bitfield.get(t2)) return;
        e3.done = true, e3.emit("done"), this._debug(`file done: ${e3.name}`);
      }
    });
    const e2 = this.files.every((e3) => e3.done);
    return !this.done && e2 ? (this.done = true, this._debug(`torrent done: ${this.infoHash}`), this.emit("done"), this.destroyed || this.discovery.complete()) : this.done && !e2 && (this.done = false, this.discovery.tracker?.start()), this._gcSelections(), e2;
  }
  async load(e2, t2) {
    if (this.destroyed) throw new Error("torrent is destroyed");
    if (!this.ready) return this.once("ready", () => {
      this.load(e2, t2);
    });
    Array.isArray(e2) || (e2 = [e2]), t2 || (t2 = Mt);
    try {
      await fe(this.store, _(e2), { chunkLength: this.pieceLength }), this._markAllVerified(), this._checkDone(), t2(null);
    } catch (e3) {
      return t2(e3), e3;
    }
  }
  pause() {
    this.destroyed || (this._debug("pause"), this.paused = true);
  }
  resume() {
    this.destroyed || (this._debug("resume"), this.paused = false, this._drain());
  }
  _debug(...e2) {
    e2[0] = `[${this.client._debugId}] [${this._debugId}] ${e2[0]}`, St(...e2);
  }
  _drain() {
    if (this._debug("_drain numConns %s maxConns %s _peersLength %s", this._numConns, this.client.maxConns, this._peersLength), "function" != typeof oe.connect || this.destroyed || this.paused || this._numConns >= this.client.maxConns) return;
    this._debug("drain (%s queued, %s/%s peers)", this._numQueued, this.numPeers, this.client.maxConns);
    const e2 = this._queue.shift();
    if (!e2) return;
    this._debug("%s connect attempt to %s", e2.type, e2.addr);
    const t2 = ce(e2.addr), i2 = { host: t2[0], port: t2[1] };
    this.client.utp && e2.type === dt.default.TYPE_UTP_OUTGOING ? e2.conn = pt.connect(i2.port, i2.host) : e2.conn = oe.connect(i2);
    const s2 = e2.conn;
    s2.once("connect", () => {
      this.destroyed || e2.onConnect();
    }), s2.once("error", (t3) => {
      e2.destroy(t3);
    }), e2.startConnectTimeout(), s2.on("close", () => {
      if (this.destroyed) return;
      if (e2.retries >= At.length) {
        if (this.client.utp) {
          const t4 = this._addPeer(e2.addr, "tcp", e2.source);
          t4 && (t4.retries = 0);
        } else this._debug("conn %s closed: will not re-add (max %s attempts)", e2.addr, At.length);
        return;
      }
      const t3 = At[e2.retries];
      this._debug("conn %s closed: will re-add to queue in %sms (attempt %s)", e2.addr, t3, e2.retries + 1);
      const i3 = setTimeout(() => {
        if (this.destroyed) return;
        const t4 = ce(e2.addr)[0], i4 = this.client.utp && this._isIPv4(t4) ? "utp" : "tcp", s3 = this._addPeer(e2.addr, i4, e2.source);
        s3 && (s3.retries = e2.retries + 1);
      }, t3);
      i3.unref && i3.unref();
    });
  }
  _validAddr(e2) {
    let t2;
    try {
      t2 = ce(e2);
    } catch (e3) {
      return false;
    }
    const i2 = t2[0], s2 = t2[1];
    return s2 > 0 && s2 < 65535 && !("127.0.0.1" === i2 && s2 === this.client.torrentPort);
  }
  _isIPv4(e2) {
    return /^((?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])[.]){3}(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])$/.test(e2);
  }
};
function Nt(e2, t2) {
  let i2 = 2 + Math.ceil(t2 * e2.downloadSpeed() / tt.BLOCK_LENGTH);
  if (e2.peerExtendedHandshake) {
    const t3 = e2.peerExtendedHandshake.reqq;
    "number" == typeof t3 && t3 > 0 && (i2 = Math.min(i2, t3));
  }
  return i2;
}
function Mt() {
}
var Ft = n(4043);
var Ut = n(580);
var jt = n(815);
var Bt = n(2878);
var Dt = class _Dt {
  constructor(e2, t2 = {}) {
    this.client = e2, t2.origin || (t2.origin = "*"), this.opts = t2, this.pendingReady = /* @__PURE__ */ new Set();
  }
  static serveIndexPage(e2, t2, i2) {
    const s2 = t2.map((e3) => `<li>
        <a href="${Ut(i2)}/${e3.infoHash}">
          ${Ut(e3.name)}
        </a>
        (${Ut(e3.length)} bytes)
      </li>`).join("<br>");
    return e2.status = 200, e2.headers["Content-Type"] = "text/html", e2.body = $t("WebTorrent", `<h1>WebTorrent</h1>
       <ol>${s2}</ol>`), e2;
  }
  isOriginAllowed(e2) {
    return false !== this.opts.origin && ("*" === this.opts.origin || e2.headers.origin === this.opts.origin);
  }
  static serveMethodNotAllowed(e2) {
    return e2.status = 405, e2.headers["Content-Type"] = "text/html", e2.body = $t("405 - Method Not Allowed", "<h1>405 - Method Not Allowed</h1>"), e2;
  }
  static serve404Page(e2) {
    return e2.status = 404, e2.headers["Content-Type"] = "text/html", e2.body = $t("404 - Not Found", "<h1>404 - Not Found</h1>"), e2;
  }
  static serveTorrentPage(e2, t2, i2) {
    const s2 = e2.files.map((t3) => `<li>
        <a href="${Ut(i2)}/${e2.infoHash}/${Ut(t3.path)}">
          ${Ut(t3.path)}
        </a>
        (${Ut(t3.length)} bytes)
      </li>`).join("<br>");
    return t2.status = 200, t2.headers["Content-Type"] = "text/html", t2.body = $t(`${Ut(e2.name)} - WebTorrent`, `<h1>${Ut(e2.name)}</h1>
      <ol>${s2}</ol>`), t2;
  }
  static serveOptionsRequest(e2, t2) {
    return t2.status = 204, t2.headers["Access-Control-Max-Age"] = "600", t2.headers["Access-Control-Allow-Methods"] = "GET,HEAD", e2.headers["access-control-request-headers"] && (t2.headers["Access-Control-Allow-Headers"] = e2.headers["access-control-request-headers"]), t2;
  }
  static serveFile(e2, t2, i2) {
    i2.status = 200, i2.headers.Expires = "0", i2.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0", i2.headers["Accept-Ranges"] = "bytes", i2.headers["Content-Type"] = e2.type, i2.headers["transferMode.dlna.org"] = "Streaming", i2.headers["contentFeatures.dlna.org"] = "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000", "document" === t2.destination ? (i2.headers["Content-Type"] = "application/octet-stream", i2.headers["Content-Disposition"] = `attachment; filename*=UTF-8''${zt(e2.name)}`, i2.body = "DOWNLOAD") : i2.headers["Content-Disposition"] = `inline; filename*=UTF-8''${zt(e2.name)}`;
    let s2 = Bt(e2.length, t2.headers.range || "");
    if (Array.isArray(s2) ? (i2.status = 206, s2 = s2[0], i2.headers["Content-Range"] = `bytes ${s2.start}-${s2.end}/${e2.length}`, i2.headers["Content-Length"] = s2.end - s2.start + 1) : (i2.statusCode = 200, s2 = null, i2.headers["Content-Length"] = e2.length), "GET" === t2.method) {
      const n2 = e2[Symbol.asyncIterator](s2);
      let r2 = null;
      e2.emit("iterator", { iterator: n2, req: t2, file: e2 }, (e3) => {
        r2 = e3;
      });
      const o2 = K.Readable.from(r2 || n2);
      let a2 = null;
      e2.emit("stream", { stream: o2, req: t2, file: e2 }, (e3) => {
        a2 = jt(o2, e3);
      }), i2.body = a2 || o2;
    } else i2.body = false;
    return i2;
  }
  async onRequest(e2, t2) {
    let i2 = new URL(e2.url, "http://example.com").pathname;
    i2 = i2.slice(i2.indexOf(this.pathname) + this.pathname.length + 1);
    const s2 = { headers: { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "base-uri 'none'; frame-ancestors 'none'; form-action 'none';" } };
    if (this.isOriginAllowed(e2) && (s2.headers["Access-Control-Allow-Origin"] = "*" === this.opts.origin ? "*" : e2.headers.origin), "favicon.ico" === i2) return t2(_Dt.serve404Page(s2));
    if ("OPTIONS" === e2.method) return this.isOriginAllowed(e2) ? t2(_Dt.serveOptionsRequest(e2, s2)) : t2(_Dt.serveMethodNotAllowed(s2));
    const n2 = async () => {
      this.pendingReady.delete(n2);
      const e3 = await r2();
      t2(e3);
    }, r2 = async () => {
      if ("" === i2) return _Dt.serveIndexPage(s2, this.client.torrents, this.pathname);
      let [t3, ...n3] = i2.split("/");
      n3 = decodeURI(n3.join("/"));
      const r3 = await this.client.get(t3);
      if (!t3 || !r3) return _Dt.serve404Page(s2);
      if (!n3) return _Dt.serveTorrentPage(r3, s2, this.pathname);
      const o2 = r3.files.find((e3) => e3.path.replace(/\\/g, "/") === n3);
      return o2 ? _Dt.serveFile(o2, e2, s2) : _Dt.serve404Page(s2);
    };
    if ("GET" === e2.method || "HEAD" === e2.method) {
      if (this.client.ready) {
        const e3 = await r2();
        return t2(e3);
      }
      return this.pendingReady.add(n2), void this.client.once("ready", n2);
    }
    return t2(_Dt.serveMethodNotAllowed(s2));
  }
  close(e2 = () => {
  }) {
    this.closed = true, this.pendingReady.forEach((e3) => {
      this.client.removeListener("ready", e3);
    }), this.pendingReady.clear(), y(e2);
  }
  destroy(e2 = () => {
  }) {
    this.closed ? y(e2) : this.close(e2), this.client = null;
  }
};
var qt = class extends Dt {
  constructor(e2, t2) {
    super(e2, t2), this.server = Ft.createServer(), this._listen = this.server.listen, this.server.listen = this.listen.bind(this), this._close = this.server.close, this.server.close = this.close.bind(this), this.sockets = /* @__PURE__ */ new Set(), this.closed = false, this.pathname = t2?.pathname || "/webtorrent";
  }
  wrapRequest(e2, t2) {
    return this.opts.hostname && e2.headers.host !== `${this.opts.hostname}:${this.server.address().port}` ? e2.destroy() : new URL(e2.url, "http://example.com").pathname.startsWith(this.pathname) ? void this.onRequest(e2, ({ status: e3, headers: i2, body: s2 }) => {
      t2.writeHead(e3, i2), s2?._readableState || s2?._writableState ? jt(s2, t2) : t2.end(s2);
    }) : e2.destroy();
  }
  onConnection(e2) {
    e2.setTimeout(36e6), this.sockets.add(e2), e2.once("close", () => {
      this.sockets.delete(e2);
    });
  }
  address() {
    return this.server.address();
  }
  listen(...e2) {
    return this.closed = false, this.server.on("connection", this.onConnection.bind(this)), this.server.on("request", this.wrapRequest.bind(this)), this._listen.apply(this.server, e2);
  }
  close(e2 = () => {
  }) {
    this.server.removeAllListeners("connection"), this.server.removeAllListeners("request"), this.server.removeAllListeners("listening"), super.close(), this._close.call(this.server, e2);
  }
  destroy(e2) {
    this.sockets.forEach((e3) => {
      e3.destroy();
    }), super.destroy(e2);
  }
};
var Wt = class extends Dt {
  constructor(e2, t2) {
    super(e2, t2), this.registration = t2.controller, this.workerKeepAliveInterval = null, this.workerPortCount = 0;
    const i2 = new URL(t2.controller.scope);
    this.pathname = i2.pathname + "webtorrent", this._address = { port: i2.port, family: "IPv4", address: i2.hostname }, this.boundHandler = this.wrapRequest.bind(this), navigator.serviceWorker.addEventListener("message", this.boundHandler), fetch(`${this.pathname}/cancel/`).then((e3) => {
      e3.body.cancel();
    });
  }
  wrapRequest(e2) {
    const t2 = e2.data;
    if ("webtorrent" === !t2?.type || !t2.url) return null;
    const [i2] = e2.ports;
    this.onRequest(t2, ({ status: e3, headers: t3, body: s2 }) => {
      const n2 = s2[Symbol.asyncIterator]?.(), r2 = () => {
        i2.onmessage = null, s2?.destroy && s2.destroy(), this.workerPortCount--, this.workerPortCount || (clearInterval(this.workerKeepAliveInterval), this.workerKeepAliveInterval = null);
      };
      i2.onmessage = async (e4) => {
        if (e4.data) {
          let e5;
          try {
            e5 = (await n2.next()).value;
          } catch (e6) {
          }
          i2.postMessage(e5), e5 || r2(), this.workerKeepAliveInterval || (this.workerKeepAliveInterval = setInterval(() => fetch(`${this.pathname}/keepalive/`), 2e4));
        } else r2();
      }, this.workerPortCount++, i2.postMessage({ status: e3, headers: t3, body: n2 ? "STREAM" : s2 });
    });
  }
  listen(e2, t2) {
    t2();
  }
  address() {
    return this._address;
  }
  close(e2) {
    navigator.serviceWorker.removeEventListener("message", this.boundHandler), super.close(e2);
  }
  destroy(e2) {
    super.destroy(e2);
  }
};
function $t(e2, t2) {
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>${e2}</title>
      </head>
      <body>
        ${t2}
      </body>
    </html>
  `;
}
function zt(e2) {
  return encodeURIComponent(e2).replace(/['()]/g, escape).replace(/\*/g, "%2A").replace(/%(?:7C|60|5E)/g, unescape);
}
var Vt = T("webtorrent");
var Gt = mt.replace(/\d*./g, (e2) => ("0" + e2 % 100).slice(-2)).slice(0, 4);
var Kt = `-WW${Gt}-`;
var Yt = class _Yt extends r {
  constructor(e2 = {}) {
    super(), "string" == typeof e2.peerId ? this.peerId = e2.peerId : ArrayBuffer.isView(e2.peerId) ? this.peerId = (0, w.V5)(e2.peerId) : this.peerId = (0, w.V5)((0, w.L0)(Kt + (0, w.NJ)((0, w.po)(9)))), this.peerIdBuffer = (0, w.fk)(this.peerId), "string" == typeof e2.nodeId ? this.nodeId = e2.nodeId : ArrayBuffer.isView(e2.nodeId) ? this.nodeId = (0, w.V5)(e2.nodeId) : this.nodeId = (0, w.V5)((0, w.po)(20)), this.nodeIdBuffer = (0, w.fk)(this.nodeId), this._debugId = this.peerId.substring(0, 7), this.destroyed = false, this.listening = false, this.torrentPort = e2.torrentPort || 0, this.dhtPort = e2.dhtPort || 0, this.tracker = void 0 !== e2.tracker ? e2.tracker : {}, this.lsd = false !== e2.lsd, this.utPex = false !== e2.utPex, this.natUpnp = e2.natUpnp ?? true, this.natPmp = e2.natPmp ?? true, this.torrents = [], this.maxConns = Number(e2.maxConns) || 55, this.utp = _Yt.UTP_SUPPORT && false !== e2.utp, this.seedOutgoingConnections = e2.seedOutgoingConnections ?? true, this._downloadLimit = Math.max("number" == typeof e2.downloadLimit ? e2.downloadLimit : -1, -1), this._uploadLimit = Math.max("number" == typeof e2.uploadLimit ? e2.uploadLimit : -1, -1), (this.natUpnp || this.natPmp) && "function" == typeof se && (this.natTraversal = new se({ enableUPNP: this.natUpnp, enablePMP: this.natPmp, upnpPermanentFallback: "permanent" === e2.natUpnp })), true === e2.secure && Promise.resolve().then(n.bind(n, 5658)).then(({ enableSecure: e3 }) => e3()), this._debug("new webtorrent (peerId %s, nodeId %s, port %s)", this.peerId, this.nodeId, this.torrentPort), this.throttleGroups = { down: new ie.ThrottleGroup({ rate: Math.max(this._downloadLimit, 0), enabled: this._downloadLimit >= 0 }), up: new ie.ThrottleGroup({ rate: Math.max(this._uploadLimit, 0), enabled: this._uploadLimit >= 0 }) }, this.tracker && ("object" != typeof this.tracker && (this.tracker = {}), globalThis.WRTC && !this.tracker.wrtc && (this.tracker.wrtc = globalThis.WRTC)), "function" == typeof ne ? this._connPool = new ne(this) : y(() => {
      this._onListening();
    }), this._downloadSpeed = te(), this._uploadSpeed = te(), false !== e2.dht && "function" == typeof I.Client ? (this.dht = new I.Client(Object.assign({}, { nodeId: this.nodeId }, e2.dht)), this.dht.once("error", (e3) => {
      this._destroy(e3);
    }), this.dht.once("listening", () => {
      const e3 = this.dht.address();
      e3 && (this.dhtPort = e3.port, this.natTraversal && this.natTraversal.map({ publicPort: this.dhtPort, privatePort: this.dhtPort, protocol: "udp", description: "WebTorrent DHT" }).catch((e4) => {
        Vt("error mapping DHT port via UPnP/PMP: %o", e4);
      }));
    }), this.dht.setMaxListeners(0), this.dht.listen(this.dhtPort)) : this.dht = false, this.enableWebSeeds = false !== e2.webSeeds;
    const t2 = () => {
      this.destroyed || (this.ready = true, this.emit("ready"));
    };
    "function" == typeof L && null != e2.blocklist ? L(e2.blocklist, { headers: { "user-agent": `WebTorrent/${mt} (https://webtorrent.io)` } }, (e3, i2) => {
      if (e3) return console.error(`Failed to load blocklist: ${e3.message}`);
      this.blocked = i2, t2();
    }) : y(t2);
  }
  createServer(e2, t2) {
    if (this.destroyed) throw new Error("torrent is destroyed");
    if (this._server) throw new Error("server already created");
    if ("undefined" != typeof window && "node" !== t2 || "browser" === t2) {
      if (!(e2?.controller instanceof ServiceWorkerRegistration)) throw new Error("Invalid worker registration");
      if ("activated" !== e2.controller.active.state) throw new Error("Worker isn't activated");
      return this._server = new Wt(this, e2), this._server;
    }
    return this._server = new qt(this, e2), this._server;
  }
  get downloadSpeed() {
    return this._downloadSpeed();
  }
  get uploadSpeed() {
    return this._uploadSpeed();
  }
  get progress() {
    const e2 = this.torrents.filter((e3) => 1 !== e3.progress);
    return e2.reduce((e3, t2) => e3 + t2.downloaded, 0) / (e2.reduce((e3, t2) => e3 + (t2.length || 0), 0) || 1);
  }
  get ratio() {
    return this.torrents.reduce((e2, t2) => e2 + t2.uploaded, 0) / (this.torrents.reduce((e2, t2) => e2 + t2.received, 0) || 1);
  }
  async get(e2) {
    if (e2 instanceof Ht) {
      if (this.torrents.includes(e2)) return e2;
    } else {
      const t2 = this.torrents;
      let i2;
      try {
        i2 = await q(e2);
      } catch (e3) {
      }
      if (!i2) return null;
      if (!i2.infoHash) throw new Error("Invalid torrent identifier");
      for (const e3 of t2) if (e3.infoHash === i2.infoHash) return e3;
    }
    return null;
  }
  add(e2, t2 = {}, i2 = () => {
  }) {
    if (this.destroyed) throw new Error("client is destroyed");
    "function" == typeof t2 && ([t2, i2] = [{}, t2]);
    const s2 = () => {
      if (!this.destroyed) {
        for (const e3 of this.torrents) if (e3.infoHash === r2.infoHash && e3 !== r2) return r2._destroy(new Error(`Cannot add duplicate torrent ${r2.infoHash}`)), void i2(e3);
      }
    }, n2 = () => {
      this.destroyed || (i2(r2), this.emit("torrent", r2));
    };
    this._debug("add"), t2 = t2 ? Object.assign({}, t2) : {};
    const r2 = new Ht(e2, this, t2);
    return this.torrents.push(r2), r2.once("_infoHash", s2), r2.once("ready", n2), r2.once("close", function e3() {
      r2.removeListener("_infoHash", s2), r2.removeListener("ready", n2), r2.removeListener("close", e3);
    }), this.emit("add", r2), r2;
  }
  seed(e2, t2, i2) {
    if (this.destroyed) throw new Error("client is destroyed");
    "function" == typeof t2 && ([t2, i2] = [{}, t2]), this._debug("seed"), (t2 = t2 ? Object.assign({}, t2) : {}).skipVerify = true;
    const s2 = "string" == typeof e2;
    s2 && (t2.path = (function(e3) {
      if (o(e3), 0 === e3.length) return ".";
      let t3 = e3.charCodeAt(0);
      const i3 = 47 === t3;
      let s3 = -1, n3 = true;
      for (let i4 = e3.length - 1; i4 >= 1; --i4) if (t3 = e3.charCodeAt(i4), 47 === t3) {
        if (!n3) {
          s3 = i4;
          break;
        }
      } else n3 = false;
      return -1 === s3 ? i3 ? "/" : "." : i3 && 1 === s3 ? "//" : e3.slice(0, s3);
    })(e2)), t2.createdBy || (t2.createdBy = `WebTorrent/${Gt}`);
    const n2 = (e3) => {
      this._debug("on seed"), "function" == typeof i2 && i2(e3), e3.emit("seed"), this.emit("seed", e3);
    }, r2 = this.add(null, t2, (e3) => {
      const i3 = [(i4) => {
        if (s2 || t2.preloadedStore) return i4();
        e3.load(a2, i4);
      }];
      this.dht && i3.push((t3) => {
        e3.once("dhtAnnounce", t3);
      }), g(i3, (t3) => {
        if (!this.destroyed) return t3 ? e3._destroy(t3) : void n2(e3);
      });
    });
    let a2;
    var h2;
    return h2 = e2, "undefined" != typeof FileList && h2 instanceof FileList ? e2 = Array.from(e2) : Array.isArray(e2) || (e2 = [e2]), g(e2.map((e3) => async (i3) => {
      if (!t2.preloadedStore && (function(e4) {
        return "object" == typeof e4 && null != e4 && "function" == typeof e4.pipe;
      })(e3)) {
        const t3 = [];
        try {
          for await (const i4 of e3) t3.push(i4);
        } catch (e4) {
          return i3(e4);
        }
        const s3 = (0, w.xW)(t3);
        s3.name = e3.name, i3(null, s3);
      } else i3(null, e3);
    }), (e3, s3) => {
      if (!this.destroyed) return e3 ? r2._destroy(e3) : void (function(e4, t3, i3) {
        "function" == typeof t3 && ([t3, i3] = [i3, t3]), x(e4, t3 = t3 ? Object.assign({}, t3) : {}, i3);
      })(s3, t2, (e4, n3) => {
        if (!this.destroyed) {
          if (e4) return r2._destroy(e4);
          a2 = n3.map((e5) => e5.getStream), A(s3, t2, async (e5, t3) => {
            if (this.destroyed) return;
            if (e5) return r2._destroy(e5);
            const s4 = await this.get(t3);
            s4 ? (console.warn("A torrent with the same id is already being seeded"), r2._destroy(), "function" == typeof i2 && i2(s4)) : r2._onTorrentId(t3);
          });
        }
      });
    }), r2;
  }
  async remove(e2, t2, i2) {
    if ("function" == typeof t2) return this.remove(e2, null, t2);
    this._debug("remove");
    const s2 = await this.get(e2);
    if (!s2) throw new Error(`No torrent with id ${e2}`);
    this._remove(s2, t2, i2);
  }
  _remove(e2, t2, i2) {
    if (!e2) return;
    if ("function" == typeof t2) return this._remove(e2, null, t2);
    const s2 = this.torrents.indexOf(e2);
    -1 !== s2 && (this.torrents.splice(s2, 1), e2.destroy(t2, i2), this.dht && this.dht._tables.remove(e2.infoHash), this.emit("remove", e2));
  }
  address() {
    return this.listening ? this._connPool ? this._connPool.tcpServer.address() : { address: "0.0.0.0", family: "IPv4", port: 0 } : null;
  }
  throttleDownload(e2) {
    return e2 = Number(e2), !(isNaN(e2) || !isFinite(e2) || e2 < -1) && (this._downloadLimit = e2, this._downloadLimit < 0 ? this.throttleGroups.down.setEnabled(false) : (this.throttleGroups.down.setEnabled(true), void this.throttleGroups.down.setRate(this._downloadLimit)));
  }
  throttleUpload(e2) {
    return e2 = Number(e2), !(isNaN(e2) || !isFinite(e2) || e2 < -1) && (this._uploadLimit = e2, this._uploadLimit < 0 ? this.throttleGroups.up.setEnabled(false) : (this.throttleGroups.up.setEnabled(true), void this.throttleGroups.up.setRate(this._uploadLimit)));
  }
  destroy(e2) {
    if (this.destroyed) throw new Error("client already destroyed");
    this._destroy(null, e2);
  }
  _destroy(e2, t2) {
    this._debug("client destroy"), this.destroyed = true;
    const i2 = this.torrents.map((e3) => (t3) => {
      e3.destroy(t3);
    });
    this._connPool && i2.push((e3) => {
      this._connPool.destroy(e3);
    }), this.dht && i2.push((e3) => {
      this.dht.destroy(e3);
    }), this._server && i2.push((e3) => {
      this._server.destroy(e3);
    }), this.natTraversal && i2.push((e3) => {
      this.natTraversal.destroy().then(() => e3());
    }), g(i2, t2), e2 && this.emit("error", e2), this.torrents = [], this._connPool = null, this.dht = null, this.throttleGroups.down.destroy(), this.throttleGroups.up.destroy();
  }
  _onListening() {
    if (this._debug("listening"), this.listening = true, this._connPool) {
      const e2 = this._connPool.tcpServer.address();
      e2 && (this.torrentPort = e2.port, this.natTraversal && this.natTraversal.map({ publicPort: this.torrentPort, privatePort: this.torrentPort, protocol: this.utp ? null : "tcp", description: "WebTorrent Torrent" }).catch((e3) => {
        Vt("error mapping WebTorrent port via UPnP/PMP: %o", e3);
      }));
    }
    this.emit("listening");
  }
  _debug() {
    const e2 = [].slice.call(arguments);
    e2[0] = `[${this._debugId}] ${e2[0]}`, Vt(...e2);
  }
  async _getByHash(e2) {
    for (const t2 of this.torrents) if (t2.infoHashHash || (t2.infoHashHash = await (0, w.tW)((0, w.fk)("72657132" + t2.infoHash), "hex")), e2 === t2.infoHashHash) return t2;
    return null;
  }
};
Yt.WEBRTC_SUPPORT = ee.WEBRTC_SUPPORT, Yt.UTP_SUPPORT = ne.UTP_SUPPORT, Yt.VERSION = mt;

// src/torrent-client.ts
var import_idb_chunk_store = __toESM(require_idb_chunk_store(), 1);
var import_buffer = __toESM(require_buffer(), 1);
globalThis.Buffer ??= import_buffer.Buffer;
async function downloadTorrentZips(id, source, index, options, write) {
  const client = new Yt();
  let torrent = null;
  const stop = () => {
    torrent?.destroy({ destroyStore: true });
    client.destroy();
  };
  try {
    const ready = await new Promise((resolve, reject) => {
      client.on("error", (error) => reject(error));
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      torrent = client.add(id, { store: import_idb_chunk_store.default, deselect: true }, resolve);
    });
    const zips = ready.files.filter((file) => file.name.toLowerCase().endsWith(".zip"));
    if (zips.length === 0) throw new Error("the torrent has no ZIP files");
    const totalBytes = zips.reduce((sum, file) => sum + file.length, 0);
    for (const file of zips) file.select();
    let before = 0;
    const files = [];
    for (const [n2, zip] of zips.entries()) {
      const done = before;
      files.push(
        await write(
          `${index}-${n2}-${zip.name.replace(/[^\w.\- ]/g, "_")}`,
          zip.stream(),
          (received) => options.onProgress({
            source,
            receivedBytes: done + received,
            totalBytes,
            detail: `${ready.numPeers} peers`
          }),
          options.signal
        )
      );
      before += zip.length;
    }
    return files;
  } finally {
    stop();
  }
}
export {
  downloadTorrentZips
};
/*! Bundled license information:

queue-microtask/index.js:
  (*! queue-microtask. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> *)

ieee754/index.js:
  (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)

buffer/index.js:
  (*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   *)
*/
