// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { build } from "vite";

// Each test runs a whole build, which can take longer than the default
// while other test files run alongside.
vi.setConfig({ testTimeout: 30_000 });

const outDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(outDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

// Builds with a Vite config as the package scripts do, into a scratch folder.
async function buildFrom(configFile: string) {
  const outDir = await mkdtemp(join(tmpdir(), "build-"));
  outDirs.push(outDir);
  await build({
    configFile,
    logLevel: "silent",
    build: { outDir, emptyOutDir: true },
  });
  return outDir;
}

// Builds the Panel as `pnpm build` does.
async function buildPanel(convexUrl: string) {
  vi.stubEnv("VITE_CONVEX_URL", convexUrl);
  return buildFrom("vite.config.ts");
}

// Every stylesheet the build wrote, joined.
async function builtCss(outDir: string) {
  const files = await readdir(join(outDir, "files"));
  const css = files.filter((file) => file.endsWith(".css"));
  expect(css).not.toEqual([]);
  const contents = await Promise.all(
    css.map((file) => readFile(join(outDir, "files", file), "utf8")),
  );
  return contents.join("\n");
}

// The CSPs refuse data: URLs, so a font inlined as one wouldn't load.
async function expectFontsAsFiles(outDir: string) {
  const css = await builtCss(outDir);
  expect(css).toMatch(/url\([^)]*geist[^)]*\.woff2\)/);
  expect(css).not.toMatch(/url\(\s*["']?data:/);
}

describe("the built Panel", () => {
  // Convex serves the Panel's headers itself.
  test("it has no _headers file", async () => {
    const outDir = await buildPanel("https://happy-otter-123.convex.cloud");

    expect(await readdir(outDir)).not.toContain("_headers");
  });

  test("its index.html has no CSP meta tag, so the header's frame-ancestors holds", async () => {
    const outDir = await buildPanel("https://happy-otter-123.convex.cloud");

    const html = await readFile(join(outDir, "index.html"), "utf8");
    expect(html).not.toMatch(/content-security-policy/i);
  });

  test("its fonts are files, not data: URLs", async () => {
    const outDir = await buildPanel("https://happy-otter-123.convex.cloud");

    await expectFontsAsFiles(outDir);
  });

  test("it has no favicon", async () => {
    const outDir = await buildPanel("https://happy-otter-123.convex.cloud");

    const html = await readFile(join(outDir, "index.html"), "utf8");
    expect(html).not.toMatch(/rel="icon"/);
    expect(await readdir(outDir)).not.toContain("favicon.svg");
  });

  // Browsers and Convex's cache keep each file for a year. The ones served
  // from /assets/ before Convex sent CORS headers have none, so a framed
  // Overlay can't load them.
  test("its pages link no file under /assets/", async () => {
    const outDir = await buildPanel("https://happy-otter-123.convex.cloud");

    for (const page of ["index.html", "overlay/index.html"]) {
      const html = await readFile(join(outDir, page), "utf8");
      expect(html).toMatch(/(src|href)="\/files\//);
      expect(html).not.toMatch(/\/assets\//);
    }
    expect(await readdir(outDir)).not.toContain("assets");
  });

  test("it won't build without VITE_CONVEX_URL", async () => {
    await expect(buildPanel("")).rejects.toThrow("VITE_CONVEX_URL");
  });
});

// The stylesheets an HTML page of the build links, joined.
async function linkedCss(outDir: string, page: string) {
  const html = await readFile(join(outDir, page), "utf8");
  const hrefs = [...html.matchAll(/<link[^>]+href="\/([^"]+\.css)"/g)].map(
    ([, href]) => href!,
  );
  expect(hrefs).not.toEqual([]);
  const contents = await Promise.all(
    hrefs.map((href) => readFile(join(outDir, href), "utf8")),
  );
  return contents.join("\n");
}

function directivesOf(csp: string) {
  return new Map(
    csp.split(";").map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name!, sources];
    }),
  );
}

describe("the built Overlay", () => {
  test("it's written for /overlay, /overlay/list and /overlay/demo", async () => {
    const outDir = await buildPanel("https://happy-otter-123.convex.cloud");

    const page = await readFile(join(outDir, "overlay/index.html"), "utf8");
    expect(await readFile(join(outDir, "overlay/list/index.html"), "utf8")).toBe(page);
    expect(await readFile(join(outDir, "overlay/demo/index.html"), "utf8")).toBe(page);
    expect(await readdir(outDir, { recursive: true })).not.toContain(
      join("src", "overlay", "index.html"),
    );
  });

  // Tailwind's preflight and the theme would change what viewers see on
  // stream.
  test("it has none of ui/'s styles", async () => {
    const outDir = await buildPanel("https://happy-otter-123.convex.cloud");

    const css = await linkedCss(outDir, "overlay/index.html");
    expect(css).not.toMatch(/tailwindcss/);
    expect(css).not.toMatch(/--color-primary|base-ui-disable-scrollbar|Geist/);
    expect(css).toMatch(/\.overlay-frame/);
  });

  // The Overlay's rules only reach the Preview's shadow root, as a
  // constructed stylesheet the CSP allows.
  test("the Panel's stylesheets have none of its rules", async () => {
    const outDir = await buildPanel("https://happy-otter-123.convex.cloud");

    expect(await linkedCss(outDir, "index.html")).not.toMatch(/\.overlay-frame/);
  });

  // StreamElements shows it in a frame, which the Panel's frame-ancestors
  // 'none' would refuse, so its CSP is in the page and Convex sends none.
  test("it can be framed, with its own CSP", async () => {
    const outDir = await buildPanel("https://happy-otter-123.convex.cloud");

    const html = await readFile(join(outDir, "overlay/index.html"), "utf8");
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(
      html,
    )?.[1];
    expect(csp).toBeDefined();
    const directives = directivesOf(csp!.replaceAll("&#39;", "'"));
    expect(directives.get("connect-src")).toEqual([
      "https://happy-otter-123.convex.cloud",
      "wss://happy-otter-123.convex.cloud",
    ]);
    expect(directives.get("default-src")).toEqual(["'none'"]);
    expect(directives.get("script-src")).toEqual(["'self'"]);
    expect(directives.get("font-src")).toEqual(["'self'", "https://fonts.gstatic.com"]);
    expect(directives.has("frame-ancestors")).toBe(false);
  });
});
