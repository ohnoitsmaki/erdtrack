import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The Overlay's page, built alongside the Panel but on its own, with none of
// the Panel's styles.
const OVERLAY_HTML = "src/overlay/index.html";

// Where the Overlay loads a Google Font's files from.
const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [
      react(),
      tailwindcss(),
      overlayPages(),
      overlayPolicy(env.VITE_CONVEX_URL),
    ],
    server: {
      // In production the Panel and /api/auth share the Convex site's origin.
      // The proxy keeps that true in development, so auth
      // cookies are first-party everywhere.
      proxy: env.VITE_CONVEX_SITE_URL
        ? { "/api/auth": { target: env.VITE_CONVEX_SITE_URL, changeOrigin: true } }
        : undefined,
    },
    resolve: { alias: { "@ui": fileURLToPath(new URL("./ui", import.meta.url)) } },
    // The Panel has no favicon, nor any other public files.
    publicDir: false,
    build: {
      // Not Vite's default, assets/. Browsers and Convex's cache keep each
      // file for a year, and the ones served from there before Convex sent
      // CORS headers have none, so a framed Overlay couldn't load them.
      assetsDir: "files",
      // Fonts and images are files, never data: URLs, which the Content
      // Security Policy refuses.
      assetsInlineLimit: 0,
      rollupOptions: { input: { panel: "index.html", overlay: OVERLAY_HTML } },
    },
  };
});

// Serves the Overlay's page at /overlay, for the List view at
// /overlay/list, and for the demo at /overlay/demo. In the build it's
// written at each, and convex/http.ts serves each rather than falling back
// to the Panel's index.html. Its assets are linked from the
// root, so the copies need no changes.
function overlayPages(): Plugin {
  return {
    name: "overlay-pages",
    // After Vite has written the HTML.
    enforce: "post",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (
          request.url &&
          /^\/overlay(\/list|\/demo)?\/?(\?.*)?$/.test(request.url)
        ) {
          request.url = `/${OVERLAY_HTML}`;
        }
        next();
      });
    },
    generateBundle(_options, bundle) {
      const page = bundle[OVERLAY_HTML];
      if (page?.type !== "asset") {
        return;
      }
      delete bundle[OVERLAY_HTML];
      for (const fileName of [
        "overlay/index.html",
        "overlay/list/index.html",
        "overlay/demo/index.html",
      ]) {
        this.emitFile({ type: "asset", fileName, source: page.source });
      }
    },
  };
}

// The Overlay's pages are public and read-only, so they can be framed, as
// StreamElements does. Convex sends the Panel's CSP as a header, but none
// with them, so their policy comes in a meta tag instead:
// frame-ancestors can't be set there, so it allows any frame. Build only,
// because the dev server injects inline scripts for hot reload. The Panel's
// own index.html has no meta tag, which would add to the header's policy.
function overlayPolicy(convexUrl: string | undefined): Plugin {
  let convexOrigin: string;
  return {
    name: "overlay-policy",
    apply: "build",
    buildStart() {
      if (!convexUrl) {
        throw new Error("VITE_CONVEX_URL must be set to build the Panel");
      }
      convexOrigin = new URL(convexUrl).origin;
    },
    transformIndexHtml(html, { path }) {
      if (!path.endsWith(OVERLAY_HTML)) {
        return html;
      }
      const policy = [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self'",
        `font-src 'self' ${GOOGLE_FONTS_FILES}`,
        `connect-src ${convexOrigin} ${convexOrigin.replace(/^http/, "ws")}`,
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; ");
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: policy },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}
