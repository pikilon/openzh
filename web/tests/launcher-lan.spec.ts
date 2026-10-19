import { test, expect, type Page } from "@playwright/test";

// Network games without internet (src/lan.ts, src/lan-ui.ts): two tabs in
// separate profiles connect over a real WebRTC data channel with pasted codes
// (the QR codes carry the same text), and the engine's sockets reach each
// other through the host tab's relay.

const SHELL = "/app/index.html";

function globals(page: Page) {
  return page.evaluate(() => {
    const g = globalThis as Record<string, unknown>;
    return { relay: g.generalsXLanRelay, ip: g.generalsXLanVirtualIP, name: g.generalsXPlayerName, action: g.generalsXLanAction, connect: typeof g.generalsXLanConnect };
  });
}

/** Opens an engine-like socket on `port`, registered as this tab's address. */
function openSocket(page: Page, port: number) {
  return page.evaluate(async (port) => {
    const g = globalThis as unknown as {
      generalsXLanConnect: (url: string) => WebSocket;
      generalsXLanVirtualIP: number;
      received?: string[];
    };
    g.received = [];
    const socket = g.generalsXLanConnect("webrtc:");
    await new Promise((resolve) => socket.addEventListener("open", resolve));
    const frame = new DataView(new ArrayBuffer(7));
    frame.setUint8(0, 1);
    frame.setUint32(1, g.generalsXLanVirtualIP);
    frame.setUint16(5, port);
    socket.send(frame.buffer);
    socket.addEventListener("message", (event) => {
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      const view = new DataView(bytes.buffer);
      g.received!.push(`${view.getUint32(1).toString(16)}:${view.getUint16(5)}:${new TextDecoder().decode(bytes.subarray(7))}`);
    });
    (g as unknown as { socket: WebSocket }).socket = socket;
  }, port);
}

function sendTo(page: Page, ip: number, port: number, text: string) {
  return page.evaluate(
    ([ip, port, text]) => {
      const socket = (globalThis as unknown as { socket: WebSocket }).socket;
      const payload = new TextEncoder().encode(text as string);
      const frame = new Uint8Array(7 + payload.length);
      const view = new DataView(frame.buffer);
      view.setUint8(0, 2);
      view.setUint32(1, ip as number);
      view.setUint16(5, port as number);
      frame.set(payload, 7);
      socket.send(frame);
    },
    [ip, port, text] as const,
  );
}

function received(page: Page) {
  return page.evaluate(() => (globalThis as unknown as { received: string[] }).received);
}

test("a host and a guest connect with two codes and their sockets talk", async ({ browser }) => {
  const hostContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto(SHELL);
  await host.locator("#mp-button").click();
  await host.locator("#mp-lan").click();
  await expect(host.locator("#lan-dialog")).toBeVisible();
  await host.locator("#lan-name").fill("Ana");
  await host.locator("#lan-host").click();
  await expect(host.locator("#lan-code-text")).toHaveValue(/#l=[A-Za-z0-9_-]+$/);
  await expect(host.locator("#lan-qr svg")).toHaveCount(1);
  const offer = await host.locator("#lan-code-text").inputValue();
  expect(offer.length).toBeLessThan(400);
  expect(await globals(host)).toMatchObject({ relay: "webrtc:", ip: 0x0a000001, name: "Ana", action: "host", connect: "function" });

  // The guest opens the offer as a link: no name yet, so it asks first.
  await guest.goto(SHELL + offer.slice(offer.indexOf("#")));
  await expect(guest.locator("#lan-dialog")).toBeVisible();
  await expect(guest.locator("#lan-status")).toContainText("Enter the name");
  await guest.locator("#lan-name").fill("Bea");
  await guest.locator("#lan-read-go").click();
  await expect(guest.locator("#lan-code-text")).toHaveValue(/^OZA1\.[A-Za-z0-9_-]+$/);
  const answer = await guest.locator("#lan-code-text").inputValue();
  expect(answer.length).toBeLessThan(400);

  await host.locator("#lan-paste").fill(answer);
  await host.locator("#lan-read-go").click();
  await expect(host.locator("#lan-status")).toHaveText("The player is connected.");
  await expect(host.locator("#lan-lede")).toContainText("1 player connected");
  await expect(host.locator("#lan-add")).toBeVisible();

  await expect(guest.locator("#lan-dialog")).toBeHidden();
  expect(await globals(guest)).toMatchObject({ relay: "webrtc:", ip: 0x0a000002, name: "Bea", action: "join", connect: "function" });

  // Engine sockets: a broadcast from the guest reaches the host, a reply comes back.
  await openSocket(host, 8086);
  await openSocket(guest, 8086);
  await sendTo(guest, 0xffffffff, 8086, "lobby");
  await expect.poll(() => received(host)).toEqual(["a000002:8086:lobby"]);
  await sendTo(host, 0x0a000002, 8086, "join");
  await expect.poll(() => received(guest)).toEqual(["a000001:8086:join"]);

  // The host's tab goes away: the guest is told.
  await host.close();
  await expect(guest.locator("#lan-dialog")).toBeVisible({ timeout: 30_000 });
  await expect(guest.locator("#lan-status")).toContainText("network game ended");
  expect((await globals(guest)).connect).toBe("undefined");
  await hostContext.close();
  await guestContext.close();
});

test("codes that are not codes are refused", async ({ page }) => {
  await page.goto(SHELL);
  await page.locator("#mp-button").click();
  await page.locator("#mp-lan").click();
  await page.locator("#lan-name").fill("Ana");
  await page.locator("#lan-join").click();
  await page.locator("#lan-paste").fill("https://example.com/#j=abc");
  await page.locator("#lan-read-go").click();
  await expect(page.locator("#lan-status")).toContainText("not a host's code");
});
