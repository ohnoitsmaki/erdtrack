import type { Settings } from "./settings";
import type { Report } from "./watcher";

// What became of the latest report.
export type Delivery = "accepted" | "tokenRefused" | "rejected" | "unreachable";

// One label, then convex.site. The App's CSP allows only these hosts.
const CONVEX_SITE = /^[a-z0-9-]+\.convex\.site$/;

// The Panel's origin, from its address as pasted, which may be any page of
// it. Null unless it's a Convex site, over https.
export function panelAddress(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    !CONVEX_SITE.test(url.hostname) ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }
  return url.origin;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// The Watcher hands over a report on every change, and the last one again
// every 30 seconds as a heartbeat, so each is sent as it comes. While Play
// Time is off, it's left out, and the backend forgets any it was sent.
export async function sendReport(
  { panelAddress, token, sendPlayTime }: Settings,
  { playTime, ...report }: Report,
  fetch: Fetch = window.fetch.bind(window),
): Promise<Delivery> {
  let response: Response;
  try {
    response = await fetch(`${panelAddress}/api/watcher/report`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sendPlayTime ? { ...report, playTime } : report),
    });
  } catch {
    return "unreachable";
  }
  if (response.ok) {
    return "accepted";
  }
  if (response.status === 401) {
    return "tokenRefused";
  }
  // Refused as malformed: this App and the Panel disagree on what a report
  // is. Anything else isn't a Panel answering.
  return response.status === 400 ? "rejected" : "unreachable";
}

const DELIVERY: Record<Delivery, string> = {
  accepted: "Connected. The Panel accepted the last report.",
  tokenRefused:
    "The Panel refused the Watcher token. Create a new one in the Panel's Settings and paste it here.",
  rejected: "The Panel refused the report. This App may need an update.",
  unreachable: "Couldn't reach the Panel at this address.",
};

export function describeDelivery(delivery: Delivery | undefined) {
  return delivery ? DELIVERY[delivery] : "Waiting for the first report to send.";
}
