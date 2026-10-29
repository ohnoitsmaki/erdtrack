import { httpRouter, type PublicHttpAction } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { allowReports, reportFromWatcher } from "./watcher";

type Handler = Parameters<typeof httpAction>[0];

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);
http.route({
  path: "/api/watcher/report",
  method: "POST",
  handler: reportFromWatcher,
});
http.route({
  path: "/api/watcher/report",
  method: "OPTIONS",
  handler: allowReports,
});

// The static-hosting component serves the Panel's files, but
// can't be told which headers to send. Its routes go on a router of their
// own, so ours can call its handler and change the request and the response
// around it.
const staticRoutes = httpRouter();
registerStaticRoutes(staticRoutes, components.staticHosting);
const [staticRoute] = staticRoutes.lookup("/", "GET")!;
const serveStaticFile = (staticRoute as PublicHttpAction & { _handler: Handler })
  ._handler;

// Google's font hosts. The Panel looks a Google Font's files up on the first,
// and the Overlay and the Panel's preview load them from the second.
const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com";

// No analytics or third-party scripts: the Panel may only load its own
// files, including its self-hosted fonts, Google Fonts' files for the
// Overlay's preview, and talk to its own origin, where auth is, and the
// Convex deployment. No one may frame it, since it can be signed in to.
function panelPolicy() {
  const convexOrigin = new URL(process.env.CONVEX_CLOUD_URL!).origin;
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    `font-src 'self' ${GOOGLE_FONTS_FILES}`,
    `connect-src 'self' ${convexOrigin} ${convexOrigin.replace(/^http/, "ws")} ${GOOGLE_FONTS_CSS}`,
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Every file is public. A StreamElements widget is sandboxed, so the
// Overlay framed in it has an opaque origin, and its scripts, stylesheets
// and fonts, which the build marks crossorigin, only load if any origin may
// read them. "*" never lets a request carry cookies.
const FILE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

// The headers are worked out per request, since the Panel's policy reads
// the deployment's URL from the environment.
function withHeaders(
  handler: Handler,
  headers: () => Record<string, string> = () => ({}),
): Handler {
  return async (ctx, request) => {
    const response = await handler(ctx, request);
    for (const [name, value] of Object.entries({ ...FILE_HEADERS, ...headers() })) {
      response.headers.set(name, value);
    }
    return response;
  };
}

// The build writes the Overlay's page as a directory index at each of its
// addresses. The component only matches files exactly, and would
// send these to the Panel's index.html. The Overlay is public and read-only,
// so StreamElements may frame it: its CSP is a meta tag in the page, with no
// frame-ancestors.
for (const page of ["/overlay", "/overlay/list", "/overlay/demo"]) {
  const servePage = withHeaders((ctx, request) => {
    const url = new URL(request.url);
    url.pathname = `${page}/index.html`;
    return serveStaticFile(ctx, new Request(url, request));
  });
  for (const path of [page, `${page}/`]) {
    http.route({ path, method: "GET", handler: httpAction(servePage) });
  }
}

// The Panel is a catch-all, so every exact route wins over it.
http.route({
  pathPrefix: "/",
  method: "GET",
  handler: httpAction(
    withHeaders(serveStaticFile, () => ({
      "Content-Security-Policy": panelPolicy(),
    })),
  ),
});

export default http;
