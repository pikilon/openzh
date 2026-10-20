// GeneralsX @performance Claude 20/10/2026 Under JSPI, emscripten's run() awaits main, and main runs the frame
// loop forever, so the module factory would never resolve. With ASYNCIFY the factory resolves as soon as main
// first sleeps; this keeps that contract: main is started from the first postRun callback, without waiting for
// it, and the factory resolves once main first suspends. The page's own postRun callbacks still run after it.
Module['noInitialRun'] = true;
{
  const pagePostRun = Module['postRun'];
  Module['postRun'] = [
    () => { callMain(programArgs); },
    ...(typeof pagePostRun == 'function' ? [pagePostRun] : pagePostRun ?? []),
  ];
}
