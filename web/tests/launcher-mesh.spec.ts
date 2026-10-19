import { test, expect, type Page, type WebSocketRoute, type BrowserContext } from "@playwright/test";

// Online games link players directly (src/mesh.ts): two tabs in separate
// profiles join one room of a relay simulated here (the rules of
// server/src/relay.rs), signal over it, open a real WebRTC data channel, and
// the engine-like sockets' unicast datagrams then skip the relay.

const RELAY = "ws://relay.test/GeneralsXLan";

class FakeRelay {
  private readonly sockets = new Map<string, WebSocketRoute>();
  /** Unicast datagrams the relay carried, per destination port. */
  readonly carried = new Map<number, number>();

  async attach(context: BrowserContext): Promise<void> {
    await context.routeWebSocket(/^ws:\/\/relay\.test\//, (ws) => {
      let address: [number, number] | null = null;
      ws.onMessage((message) => {
        const bytes = Buffer.from(message as Buffer);
        if (address === null) {
          if (bytes.length !== 7 || bytes[0] !== 1) return;
          let ip = bytes.readUInt32BE(1);
          const port = bytes.readUInt16BE(5);
          if (port === 0) {
            for (let n = 1; ; n++) {
              const candidate = (0x0a000000 | n) >>> 0;
              if (![...this.sockets.keys()].some((key) => key.startsWith(`${candidate}:`))) {
                ip = candidate;
                break;
              }
            }
            const reply = Buffer.alloc(7);
            reply[0] = 1;
            reply.writeUInt32BE(ip, 1);
            ws.send(reply);
          }
          address = [ip, port];
          this.sockets.set(`${ip}:${port}`, ws);
          return;
        }
        if (bytes.length < 7 || bytes[0] !== 2) return;
        const ip = bytes.readUInt32BE(1);
        const port = bytes.readUInt16BE(5);
        const out = Buffer.from(bytes);
        out.writeUInt32BE(address[0], 1);
        out.writeUInt16BE(address[1], 5);
        if ((ip & 0xff) === 0xff) {
          for (const [key, other] of this.sockets) {
            if (other !== ws && key.endsWith(`:${port}`)) other.send(out);
          }
        } else {
          this.carried.set(port, (this.carried.get(port) ?? 0) + 1);
          this.sockets.get(`${ip}:${port}`)?.send(out);
        }
      });
      ws.onClose(() => {
        if (address) this.sockets.delete(`${address[0]}:${address[1]}`);
      });
    });
  }
}

async function enginePort(page: Page, port: number): Promise<void> {
  await page.evaluate(async (port) => {
    const g = globalThis as unknown as Record<string, unknown> & { received: string[]; socket: WebSocket };
    g.received = [];
    const url = `${g.generalsXLanRelay as string}?room=${g.generalsXLanRoom as string}&token=${g.generalsXLanToken as string}`;
    const socket = (g.generalsXLanConnect as (url: string) => WebSocket)(url);
    await new Promise((resolve) => socket.addEventListener("open", resolve));
    const frame = new DataView(new ArrayBuffer(7));
    frame.setUint8(0, 1);
    frame.setUint32(1, g.generalsXLanVirtualIP as number);
    frame.setUint16(5, port);
    socket.send(frame.buffer);
    socket.addEventListener("message", (event) => {
      const view = new DataView(event.data as ArrayBuffer);
      g.received.push(`${view.getUint32(1).toString(16)}:${view.getUint16(5)}:${new TextDecoder().decode(new Uint8Array(event.data as ArrayBuffer, 7))}`);
    });
    g.socket = socket;
  }, port);
}

function sendTo(page: Page, ip: number, port: number, text: string) {
  return page.evaluate(
    ([ip, port, text]) => {
      const payload = new TextEncoder().encode(text as string);
      const frame = new Uint8Array(7 + payload.length);
      const view = new DataView(frame.buffer);
      frame[0] = 2;
      view.setUint32(1, ip as number);
      view.setUint16(5, port as number);
      frame.set(payload, 7);
      (globalThis as unknown as { socket: WebSocket }).socket.send(frame);
    },
    [ip, port, text] as const,
  );
}

const received = (page: Page) => page.evaluate(() => (globalThis as unknown as { received: string[] }).received);
const direct = (page: Page) => page.evaluate(() => (globalThis as unknown as { generalsXLanMesh: { stats: { direct: number[] } } }).generalsXLanMesh.stats.direct);

test("players in a room link directly and their datagrams skip the relay", async ({ browser }) => {
  const relay = new FakeRelay();
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  await relay.attach(hostContext);
  await relay.attach(guestContext);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto(`/app/index.html?relay=${encodeURIComponent(RELAY)}`);
  await host.locator("#mp-button").click();
  await host.locator("#mp-name").fill("Ana");
  await host.locator("#mp-go").click();
  const link = await host.locator("#mp-link").inputValue();
  await guest.goto("/app/index.html" + link.slice(link.indexOf("#")));
  await guest.locator("#mp-name").fill("Bea");
  await guest.locator("#mp-go").click();
  await expect(guest.locator("#mp-dialog")).toBeHidden();

  await enginePort(host, 8086);
  await enginePort(guest, 8086);

  // The direct link comes up on both sides.
  await expect.poll(() => direct(host), { timeout: 20_000 }).toEqual([0x0a000002]);
  await expect.poll(() => direct(guest), { timeout: 20_000 }).toEqual([0x0a000001]);

  // Broadcasts still use the relay; unicast goes direct, both ways.
  await sendTo(guest, 0xffffffff, 8086, "lobby");
  await expect.poll(() => received(host)).toEqual(["a000002:8086:lobby"]);
  const before = relay.carried.get(8086) ?? 0;
  await sendTo(host, 0x0a000002, 8086, "join");
  await sendTo(guest, 0x0a000001, 8086, "ok");
  await expect.poll(() => received(guest)).toEqual(["a000001:8086:join"]);
  await expect.poll(() => received(host)).toEqual(["a000002:8086:lobby", "a000002:8086:ok"]);
  expect(relay.carried.get(8086) ?? 0).toBe(before);

  // Without the direct link the relay takes over.
  await guestContext.close();
  await expect.poll(() => direct(host), { timeout: 30_000 }).toEqual([]);
  await hostContext.close();
});

test("?p2p=0 keeps every datagram on the relay", async ({ page }) => {
  const relay = new FakeRelay();
  await relay.attach(page.context());
  await page.goto(`/app/index.html?p2p=0&relay=${encodeURIComponent(RELAY)}`);
  await page.locator("#mp-button").click();
  await page.locator("#mp-name").fill("Ana");
  await page.locator("#mp-go").click();
  await expect(page.locator("#mp-invite")).toBeVisible();
  expect(await page.evaluate(() => [typeof (globalThis as Record<string, unknown>).generalsXLanConnect, (globalThis as Record<string, unknown>).generalsXLanMesh])).toEqual(["undefined", null]);
});
