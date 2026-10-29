import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { components } from "./_generated/api";
import { setup, stubAuthEnv, type T } from "./signIn.testing";

beforeEach(() => {
  stubAuthEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const PANEL = "<!doctype html><title>Panel</title>";
const OVERLAY = "<!doctype html><title>Overlay</title>";

// Uploads files as `static-hosting deploy` would, at the paths the build
// writes them.
async function deployFiles(t: T, files: Record<string, string>) {
  // The upload functions are internal to the component, so its API doesn't
  // list them, but convex-test can still call them.
  const lib = components.staticHosting.lib as unknown as {
    recordAsset: Parameters<T["mutation"]>[0];
  };
  for (const [path, body] of Object.entries(files)) {
    const contentType = path.endsWith(".html")
      ? "text/html; charset=utf-8"
      : "text/javascript; charset=utf-8";
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob([body], { type: contentType })),
    );
    await t.mutation(lib.recordAsset, {
      path,
      storageId,
      contentType,
      deploymentId: "deploy-1",
    });
  }
}

async function deployBuild(t: T) {
  await deployFiles(t, {
    "/index.html": PANEL,
    "/overlay/index.html": OVERLAY,
    "/overlay/list/index.html": OVERLAY,
    "/overlay/demo/index.html": OVERLAY,
    "/files/overlay.js": "console.log('Overlay')",
  });
}

// The Panel and auth share this origin. The auth routes have
// their own tests.
describe("the Convex site", () => {
  test("its root serves the Panel", async () => {
    const t = setup();
    await deployBuild(t);

    const response = await t.fetch("/");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(PANEL);
  });

  // OBS and StreamElements load these addresses. Without its own
  // routes, each would fall back to the Panel's index.html.
  test.each([
    "/overlay",
    "/overlay/",
    "/overlay/list",
    "/overlay/list/",
    "/overlay/demo",
    "/overlay/demo/",
  ])("%s serves the Overlay", async (path) => {
    const t = setup();
    await deployBuild(t);

    const response = await t.fetch(path);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(OVERLAY);
  });

  test("the Panel's own routes serve the Panel", async () => {
    const t = setup();
    await deployBuild(t);

    for (const path of ["/runs", "/runs/abc", "/overlay/style", "/overlays"]) {
      const response = await t.fetch(path);
      expect(await response.text()).toBe(PANEL);
    }
  });

  // No analytics or third-party scripts, and no one may frame a page that
  // can be signed in to.
  test("the Panel comes with its CSP and safety headers", async () => {
    const t = setup();
    await deployBuild(t);

    for (const path of ["/", "/runs"]) {
      const response = await t.fetch(path);
      const directives = directivesOf(
        response.headers.get("content-security-policy")!,
      );
      expect(directives.get("default-src")).toEqual(["'none'"]);
      expect(directives.get("script-src")).toEqual(["'self'"]);
      expect(directives.get("style-src")).toEqual(["'self'"]);
      expect(directives.get("img-src")).toEqual(["'self'"]);
      // Geist is self-hosted, so fonts come from the Panel's own files,
      // besides a Google Font in the Overlay's preview.
      expect(directives.get("font-src")).toEqual([
        "'self'",
        "https://fonts.gstatic.com",
      ]);
      expect(directives.get("connect-src")).toEqual([
        "'self'",
        "https://test.convex.cloud",
        "wss://test.convex.cloud",
        // Where the Panel looks up a Google Font's files.
        "https://fonts.googleapis.com",
      ]);
      expect(directives.get("base-uri")).toEqual(["'none'"]);
      expect(directives.get("form-action")).toEqual(["'self'"]);
      expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  // StreamElements shows it in a frame, which the Panel's frame-ancestors
  // 'none' would refuse. Its own CSP is a meta tag in the page.
  test("the Overlay can be framed", async () => {
    const t = setup();
    await deployBuild(t);

    for (const path of ["/overlay", "/overlay/list/", "/overlay/demo"]) {
      const response = await t.fetch(path);
      expect(response.headers.get("content-security-policy")).toBeNull();
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  // A StreamElements widget is sandboxed, so the Overlay framed in it has an
  // opaque origin, and the browser fetches its scripts, stylesheets and
  // fonts, which the build marks crossorigin, as cross-origin requests.
  test("anyone may load the files, as a framed Overlay does", async () => {
    const t = setup();
    await deployBuild(t);

    for (const path of ["/overlay", "/files/overlay.js"]) {
      const response = await t.fetch(path, { headers: { origin: "null" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  // The Panel calls auth on its own origin, so auth answers no CORS at all.
  test("no other origin may call auth from the browser", async () => {
    const t = setup();

    const response = await t.fetch("/api/auth/get-session", {
      headers: { origin: "https://evil.example" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

function directivesOf(csp: string) {
  return new Map(
    csp.split(";").map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name!, sources];
    }),
  );
}
