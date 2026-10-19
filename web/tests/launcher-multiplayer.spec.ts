import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

// Online games by invite (src/multiplayer.ts, src/multiplayer-ui.ts): the
// Multiplayer dialog makes a private room on the relay and shows its link;
// opening the link asks for a name once and points the engine at the room.
// The relay is a mock: it leases 10.0.0.<n> like server/src/relay.rs.

const SHELL = "/app/index.html";
const RELAY = "ws://relay.test/GeneralsXLan";

interface Relay {
  urls: string[];
}

async function mockRelay(page: Page, options: { refuse?: boolean; ip?: number } = {}): Promise<Relay> {
  const relay: Relay = { urls: [] };
  await page.routeWebSocket(/^ws:\/\/relay\.test\//, (ws: WebSocketRoute) => {
    relay.urls.push(ws.url());
    if (options.refuse) {
      void ws.close({ code: 1008 });
      return;
    }
    ws.onMessage((message) => {
      const bytes = new Uint8Array(message as Buffer);
      if (bytes.length !== 7 || bytes[0] !== 1) return;
      const reply = Buffer.alloc(7);
      reply[0] = 1;
      reply.writeUInt32BE((0x0a000000 | (options.ip ?? 5)) >>> 0, 1);
      reply.writeUInt16BE(0, 5);
      ws.send(reply);
    });
  });
  return relay;
}

function globals(page: Page) {
  return page.evaluate(() => {
    const g = globalThis as Record<string, unknown>;
    return {
      relay: g.generalsXLanRelay,
      room: g.generalsXLanRoom,
      token: g.generalsXLanToken,
      ip: g.generalsXLanVirtualIP,
      name: g.generalsXPlayerName,
      action: g.generalsXLanAction,
      connect: typeof g.generalsXLanConnect,
    };
  });
}

function decode(link: string): Record<string, unknown> {
  const payload = link.split("#j=")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

test("the host creates a private game and gets its link, QR code and copy buttons", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const relay = await mockRelay(page);
  await page.goto(`${SHELL}?relay=${encodeURIComponent(RELAY)}`);
  await expect(page.locator("#mp-copy-link")).toBeHidden();

  await page.locator("#mp-button").click();
  await expect(page.locator("#mp-dialog")).toBeVisible();
  await page.locator("#mp-name").fill("  Ana:,;  ");
  await page.locator("#mp-go").click();

  await expect(page.locator("#mp-invite")).toBeVisible();
  await expect(page.locator("#mp-qr svg")).toHaveCount(1);
  const link = await page.locator("#mp-link").inputValue();
  expect(link.startsWith(`${new URL(page.url()).origin}/#j=`)).toBe(true);
  const invite = decode(link);
  expect(invite).toMatchObject({ v: 1, t: "relay", u: RELAY, h: "Ana" });
  expect(invite.r).toMatch(/^[a-z0-9]{16}$/);
  expect(invite.k).toMatch(/^[A-Za-z0-9_-]{16,64}$/);

  // The address lease and the direct links' signalling (src/mesh.ts), both in the room.
  await expect.poll(() => relay.urls.length).toBe(2);
  expect(new Set(relay.urls)).toEqual(new Set([`${RELAY}?room=${invite.r}&token=${invite.k}`]));
  expect(await globals(page)).toEqual({
    relay: RELAY,
    room: invite.r,
    token: invite.k,
    ip: 0x0a000005,
    name: "Ana",
    action: "host",
    connect: "function",
  });

  await page.locator("#mp-close").click();
  await expect(page.locator("#mp-copy-link")).toBeVisible();
  await page.locator("#mp-copy-link").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
});

test("a link asks for a name once, then joins by itself", async ({ page }) => {
  await mockRelay(page, { ip: 9 });
  const link = "/#j=" + Buffer.from(JSON.stringify({ v: 1, t: "relay", u: RELAY, r: "sala1", k: "0123456789abcdef", h: "Ana" })).toString("base64url");
  await page.goto(SHELL + link.slice(1));

  await expect(page.locator("#mp-dialog")).toBeVisible();
  await expect(page.locator("#mp-lede")).toContainText("Ana invited you");
  await expect(page.locator("#mp-go")).toHaveText("Join game");
  await page.locator("#mp-name").fill("Bea");
  await page.locator("#mp-name").press("Enter");
  await expect(page.locator("#mp-dialog")).toBeHidden();
  expect(await globals(page)).toMatchObject({ room: "sala1", token: "0123456789abcdef", ip: 0x0a000009, name: "Bea", action: "join" });

  // The remembered name joins without asking.
  await page.reload();
  await expect.poll(async () => (await globals(page)).action).toBe("join");
  await expect(page.locator("#mp-dialog")).toBeHidden();
  expect((await globals(page)).name).toBe("Bea");
});

test("a room the relay refuses shows why and points the engine nowhere", async ({ page }) => {
  await mockRelay(page, { refuse: true });
  await page.goto(`${SHELL}?relay=${encodeURIComponent(RELAY)}`);
  await page.locator("#mp-button").click();
  await page.locator("#mp-name").fill("Ana");
  await page.locator("#mp-go").click();
  await expect(page.locator("#mp-status")).toContainText("Could not create the game");
  await expect(page.locator("#mp-invite")).toBeHidden();
  expect((await globals(page)).action).toBeUndefined();
});

test("a broken link is ignored", async ({ page }) => {
  await page.goto(`${SHELL}#j=not-json`);
  await expect(page.locator("body")).toHaveAttribute("data-state", "no-assets");
  await expect(page.locator("#mp-dialog")).toBeHidden();
});

test("the engine's Multiplayer button opens the dialog, which joins from a pasted link", async ({ page }) => {
  await mockRelay(page, { ip: 3 });
  await page.goto(SHELL);
  await page.evaluate(() => (globalThis as { generalsXLanNotify?: (e: string) => void }).generalsXLanNotify?.("open"));
  await expect(page.locator("#mp-dialog")).toBeVisible();
  await expect(page.locator("#mp-join")).toBeVisible();
  await expect(page.locator("#mp-go")).toHaveText("Create game");

  await page.locator("#mp-name").fill("Bea");
  await page.locator("#mp-paste").fill("https://example.com/whatever");
  await page.locator("#mp-join-go").click();
  await expect(page.locator("#mp-status")).toContainText("not an OpenZH invite");

  const payload = Buffer.from(JSON.stringify({ v: 1, t: "relay", u: RELAY, r: "sala2", k: "0123456789abcdef", h: "Ana" })).toString("base64url");
  await page.locator("#mp-paste").fill(`  https://openzh.pikilon.com/#j=${payload} `);
  await page.locator("#mp-paste").press("Enter");
  await expect(page.locator("#mp-dialog")).toBeHidden();
  expect(await globals(page)).toMatchObject({ room: "sala2", ip: 0x0a000003, name: "Bea", action: "join" });
});

test("in a room the dialog plays again or leaves it", async ({ page }) => {
  await mockRelay(page);
  await page.goto(`${SHELL}?relay=${encodeURIComponent(RELAY)}`);
  await page.locator("#mp-button").click();
  await page.locator("#mp-name").fill("Ana");
  await page.locator("#mp-go").click();
  await expect(page.locator("#mp-go")).toHaveText("Play again");
  await expect(page.locator("#mp-join")).toBeHidden();
  const room = (await globals(page)).room;

  // The engine took the action, the game ended; the same room again.
  await page.evaluate(() => ((globalThis as { generalsXLanAction?: string }).generalsXLanAction = undefined));
  await page.locator("#mp-go").click();
  await expect(page.locator("#mp-dialog")).toBeHidden();
  expect(await globals(page)).toMatchObject({ room, ip: 0x0a000005, action: "host" });

  await page.locator("#mp-button").click();
  await page.locator("#mp-leave").click();
  await expect(page.locator("#mp-go")).toHaveText("Create game");
  await expect(page.locator("#mp-copy-link")).toBeHidden();
  expect((await globals(page)).action).toBeUndefined();
});

test("a guest who finds no game is told so", async ({ page }) => {
  await page.goto(SHELL);
  await page.evaluate(() => (globalThis as { generalsXLanNotify?: (e: string) => void }).generalsXLanNotify?.("no-game"));
  await expect(page.locator("#mp-dialog")).toBeVisible();
  await expect(page.locator("#mp-status")).toContainText("No game is open in this room");
});

test("typing, deleting and pasting reach the dialog while the engine holds the keyboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(SHELL);
  // What SDL does with the engine running: every key on the window is cancelled.
  await page.evaluate(() => {
    for (const type of ["keydown", "keyup", "keypress"]) {
      window.addEventListener(type, (event) => event.preventDefault(), true);
      document.addEventListener(type, (event) => event.preventDefault(), true);
    }
  });
  await page.locator("#mp-button").click();
  const name = page.locator("#mp-name");
  await name.click();
  await page.keyboard.type("Anaa");
  await page.keyboard.press("Backspace");
  await expect(name).toHaveValue("Ana");
  await page.evaluate(() => navigator.clipboard.writeText("https://openzh.pikilon.com/#j=abc"));
  await page.locator("#mp-paste").click();
  await page.keyboard.press("ControlOrMeta+V");
  await expect(page.locator("#mp-paste")).toHaveValue("https://openzh.pikilon.com/#j=abc");
});
