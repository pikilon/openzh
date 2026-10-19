import { test, expect, chromium, type Browser } from "@playwright/test";
import { writeFileSync } from "node:fs";
import qrcode from "qrcode-generator";

// Joining by scanning the host's QR code (src/qr-scan.ts). The camera is
// Chromium's fake capture device playing a Y4M picture of an invite's QR
// code; the relay is a mock that leases 10.0.0.7.

const RELAY = "ws://relay.test/GeneralsXLan";
const INVITE = Buffer.from(JSON.stringify({ v: 1, t: "relay", u: RELAY, r: "qrsala", k: "0123456789abcdef", h: "Ana" })).toString("base64url");
const LINK = `https://openzh.pikilon.com/#j=${INVITE}`;

/** A 640x480 4:2:0 Y4M file: one frame showing `text` as a QR code. */
function qrVideo(text: string): Buffer {
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  const width = 640;
  const height = 480;
  const modules = code.getModuleCount();
  const cell = Math.floor((height - 40) / (modules + 8));
  const size = cell * (modules + 8);
  const left = Math.floor((width - size) / 2);
  const top = Math.floor((height - size) / 2);
  const y = Buffer.alloc(width * height, 255);
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!code.isDark(row, col)) continue;
      for (let dy = 0; dy < cell; dy++) {
        const offset = (top + (row + 4) * cell + dy) * width + left + (col + 4) * cell;
        y.fill(0, offset, offset + cell);
      }
    }
  }
  const chroma = Buffer.alloc((width / 2) * (height / 2) * 2, 128);
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`);
  return Buffer.concat([header, Buffer.from("FRAME\n"), y, chroma]);
}

let browser: Browser;

test.beforeAll(async ({}, testInfo) => {
  const video = testInfo.outputPath("invite.y4m");
  writeFileSync(video, qrVideo(LINK));
  browser = await chromium.launch({
    executablePath: process.env.BRAVE_PATH ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${video}`],
  });
});

test.afterAll(async () => {
  await browser?.close();
});

for (const detector of ["BarcodeDetector", "jsQR"] as const) {
  test(`scanning the host's QR code joins the game (${detector})`, async ({ baseURL }) => {
    const context = await browser.newContext({ baseURL, permissions: ["camera"] });
    const page = await context.newPage();
    if (detector === "jsQR") await page.addInitScript(() => delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector);
    await page.routeWebSocket(/^ws:\/\/relay\.test\//, (ws) => {
      ws.onMessage((message) => {
        const bytes = new Uint8Array(message as Buffer);
        if (bytes.length !== 7 || bytes[0] !== 1) return;
        ws.send(Buffer.from([1, 10, 0, 0, 7, 0, 0]));
      });
    });
    await page.goto("/app/index.html");
    await page.locator("#mp-button").click();
    await page.locator("#mp-name").fill("Bea");
    await page.locator("#mp-scan").click();
    await expect(page.locator("#mp-dialog")).toBeHidden({ timeout: 15_000 });
    const state = await page.evaluate(() => {
      const g = globalThis as Record<string, unknown>;
      return [g.generalsXLanRoom, g.generalsXLanVirtualIP, g.generalsXLanAction];
    });
    expect(state).toEqual(["qrsala", 0x0a000007, "join"]);
    // The camera is off once the code is read.
    expect(await page.evaluate(() => (document.getElementById("mp-video") as HTMLVideoElement).srcObject)).toBeNull();
    await context.close();
  });
}
