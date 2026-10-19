import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// Issue #188: the launcher is an installable web app and a shared link has a
// real thumbnail. The manifest, its icons and the Open Graph image are plain
// files next to the page, so the same relative URLs work from the development
// server (/app/) and from the published site root (/). No EA asset is involved:
// the icons and the card are OpenZH artwork.

const MANIFEST_PATH = "/app/manifest.webmanifest";
const PAGE_PATH = "/app/index.html";

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

type Manifest = {
  name: string;
  short_name: string;
  description?: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
  screenshots?: { src: string; sizes: string; type: string; form_factor?: string }[];
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Width and height from the IHDR chunk of a PNG.
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, PNG_SIGNATURE.length), "PNG signature").toEqual(PNG_SIGNATURE);
  expect(bytes.toString("ascii", 12, 16), "IHDR chunk").toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function readManifest(request: APIRequestContext): Promise<Manifest> {
  const response = await request.get(MANIFEST_PATH);
  expect(response.status()).toBe(200);
  const type = response.headers()["content-type"] ?? "";
  expect(type).toContain("application/manifest+json");
  const text = await response.text();
  return JSON.parse(text) as Manifest;
}

// The manifest is served at /app/ in tests and at / when published: every
// relative URL is resolved against the manifest itself, never the page.
function resolvedFromManifest(src: string, origin: string, manifestPath = MANIFEST_PATH): string {
  return new URL(src, `${origin}${manifestPath}`).pathname;
}

async function linkPaths(page: Page, selector: string): Promise<(string | null)[]> {
  return page.evaluate((query: string) => {
    return [...document.querySelectorAll(query)].map((element) => {
      const href = element.getAttribute("href");
      return href === null ? null : new URL(href, document.baseURI).pathname;
    });
  }, selector);
}

test("1: the page links an installable manifest with the PWA fields", async ({ page, request }) => {
  await page.goto(PAGE_PATH);

  const paths = await linkPaths(page, 'link[rel="manifest"]');
  expect(paths.length, "the page has no manifest link").toBe(1);
  expect(paths[0]).toBe(MANIFEST_PATH);

  const manifest = await readManifest(request);
  expect(manifest.name).toBe("OpenZH");
  expect(manifest.short_name).toBe("OpenZH");
  expect(manifest.description ?? "").not.toBe("");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("./");
  expect(manifest.scope).toBe("./");
  expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);

  // From the development server the manifest lives under /app/; when published
  // it moves to the site root and the same relative URLs follow it.
  expect(resolvedFromManifest(manifest.start_url, "http://127.0.0.1")).toBe("/app/");
  expect(resolvedFromManifest(manifest.start_url, "https://openzh.pikilon.com", "/manifest.webmanifest")).toBe("/");
});

test("2: the manifest declares 192, 512 and maskable icons that are real PNGs", async ({
  request,
}) => {
  const manifest = await readManifest(request);
  const bySize = new Map<string, ManifestIcon[]>();
  for (const icon of manifest.icons) {
    const list = bySize.get(icon.sizes) ?? [];
    list.push(icon);
    bySize.set(icon.sizes, list);
  }

  for (const [size, expected] of [
    ["192x192", 192],
    ["512x512", 512],
  ] as const) {
    const icons = bySize.get(size) ?? [];
    expect(icons.length, `no ${size} icon`).toBeGreaterThanOrEqual(1);
    const any = icons.find((icon) => (icon.purpose ?? "any").includes("any"));
    expect(any, `no ${size} icon usable as "any"`).toBeDefined();
    expect(any?.type).toBe("image/png");

    const path = resolvedFromManifest(any!.src, "http://127.0.0.1");
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    const dimensions = pngSize(await response.body());
    expect(dimensions).toEqual({ width: expected, height: expected });
  }

  const maskable = manifest.icons.filter((icon) => (icon.purpose ?? "").includes("maskable"));
  expect(maskable.length, "no maskable icon").toBeGreaterThanOrEqual(1);
  const maskableResponse = await request.get(resolvedFromManifest(maskable[0].src, "http://127.0.0.1"));
  expect(maskableResponse.status()).toBe(200);
  expect(pngSize(await maskableResponse.body())).toEqual({ width: 512, height: 512 });
});

test("3: the manifest screenshots and every asset stay inside the app folder", async ({
  request,
}) => {
  const manifest = await readManifest(request);
  const screenshots = manifest.screenshots ?? [];
  expect(screenshots.length, "the manifest has no screenshot").toBeGreaterThanOrEqual(1);
  const wide = screenshots.find((shot) => shot.form_factor === "wide") ?? screenshots[0];
  expect(wide.sizes).toBe("1280x720");
  expect(wide.type).toBe("image/png");

  for (const asset of [...manifest.icons.map((icon) => icon.src), ...screenshots.map((shot) => shot.src)]) {
    expect(asset, `external asset ${asset}`).not.toMatch(/^[a-z]+:/i);
    const path = resolvedFromManifest(asset, "http://127.0.0.1");
    expect(path.startsWith("/app/"), path).toBe(true);
  }

  const screenshot = await request.get(resolvedFromManifest(wide.src, "http://127.0.0.1"));
  expect(screenshot.status()).toBe(200);
  expect(pngSize(await screenshot.body())).toEqual({ width: 1280, height: 720 });
});

test("4: the Apple and link-preview metadata point at real images", async ({ page, request }) => {
  await page.goto(PAGE_PATH);

  expect(await linkPaths(page, 'link[rel="apple-touch-icon"]')).toEqual([
    "/app/icons/apple-touch-icon.png",
  ]);
  const apple = await request.get("/app/icons/apple-touch-icon.png");
  expect(apple.status()).toBe(200);
  expect(pngSize(await apple.body())).toEqual({ width: 180, height: 180 });

  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", /^#[0-9a-f]{6}$/i);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /OpenZH/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://openzh.pikilon.com/og.png",
  );
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
  await expect(page.locator('meta[property="og:image:alt"]')).not.toHaveAttribute("content", "");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
    "content",
    "https://openzh.pikilon.com/og.png",
  );

  const og = await request.get("/app/og.png");
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toBe("image/png");
  expect(pngSize(await og.body())).toEqual({ width: 1200, height: 630 });
});

test("5: the manifest and the page's app metadata carry no EA trademark", async ({ page, request }) => {
  const manifest = await readManifest(request);
  const text = JSON.stringify(manifest);

  await page.goto(PAGE_PATH);
  const metadata = await page.evaluate(() => {
    const metas = [...document.querySelectorAll("meta")].map((meta) => meta.getAttribute("content") ?? "");
    return [document.title, ...metas].join(" ");
  });

  for (const value of [text, metadata]) {
    expect(value).not.toMatch(/Command\s*&\s*Conquer/i);
    expect(value).not.toMatch(/Generals|Zero Hour/i);
  }
});
