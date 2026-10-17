// Browser features the launcher needs before it reads several GB of game data
// (docs/briefs/30-browser-features.md): WebGPU for rendering, cross-origin
// isolation for SharedArrayBuffer and OPFS for the archive store.

export interface FeatureEnv {
  gpu: unknown; // navigator.gpu
  crossOriginIsolated: boolean; // window.crossOriginIsolated
  getDirectory: unknown; // navigator.storage?.getDirectory
}

export function currentEnv(): FeatureEnv {
  return {
    gpu: navigator.gpu,
    crossOriginIsolated: window.crossOriginIsolated,
    getDirectory: navigator.storage?.getDirectory,
  };
}

// The names the launcher shows, in the contract order. Pure: no DOM access.
export function missingFeatures(env: FeatureEnv): string[] {
  const missing: string[] = [];
  if (env.gpu === undefined || env.gpu === null) missing.push("WebGPU");
  if (env.crossOriginIsolated !== true) missing.push("Cross-origin isolation");
  if (typeof env.getDirectory !== "function") missing.push("Origin private file system");
  return missing;
}
