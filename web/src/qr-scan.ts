// Reads a QR code from the camera: the browser's BarcodeDetector where it has
// one, else jsQR (bundled, so it works offline) on the video's frames.

import jsQR from "jsqr";

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

async function nativeDetector(): Promise<Detector | null> {
  const Native = (globalThis as { BarcodeDetector?: DetectorClass & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (Native === undefined) return null;
  try {
    const formats = (await Native.getSupportedFormats?.()) ?? ["qr_code"];
    return formats.includes("qr_code") ? new Native({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

/**
 * Shows the camera in `video` until a QR code is read or `signal` aborts.
 * Resolves with the code's text, or null when aborted.
 */
export async function scanQr(video: HTMLVideoElement, signal: AbortSignal): Promise<string | null> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  const stop = () => {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  if (signal.aborted) {
    stop();
    return null;
  }
  signal.addEventListener("abort", stop, { once: true });
  video.srcObject = stream;
  await video.play().catch(() => undefined);

  const detector = await nativeDetector();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  try {
    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (video.readyState < 2 || video.videoWidth === 0) continue;
      if (detector) {
        const codes = await detector.detect(video).catch(() => []);
        if (codes.length > 0) return codes[0].rawValue;
        continue;
      }
      if (context === null) continue;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
      if (code) return code.data;
    }
    return null;
  } finally {
    stop();
  }
}
