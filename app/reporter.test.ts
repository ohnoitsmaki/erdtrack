import { describe, expect, test } from "vitest";
import { describeDelivery, panelAddress, sendReport } from "./reporter";
import type { Report } from "./watcher";

const yawn: Report = {
  slot: 0,
  characterName: "Yawn",
  total: 42,
  defeatFlags: [10000800],
  playTime: { seconds: 187_651, running: false },
};

const settings = {
  panelAddress: "https://happy-otter-123.convex.site",
  token: "secret-token",
  sendPlayTime: false,
};

describe("the Panel's address", () => {
  test.each([
    ["https://happy-otter-123.convex.site", "https://happy-otter-123.convex.site"],
    ["  https://happy-otter-123.convex.site/  ", "https://happy-otter-123.convex.site"],
    // Pasted from the Panel's address bar.
    ["https://happy-otter-123.convex.site/settings", "https://happy-otter-123.convex.site"],
    ["HTTPS://Happy-Otter-123.Convex.Site", "https://happy-otter-123.convex.site"],
  ])("%j is %s", (input, address) => {
    expect(panelAddress(input)).toBe(address);
  });

  // The App may only talk to Convex site hosts.
  test.each([
    ["", "nothing"],
    ["happy-otter-123.convex.site", "no https"],
    ["http://happy-otter-123.convex.site", "plain http"],
    ["https://happy-otter-123.convex.cloud", "the deployment, not the site"],
    ["https://convex.site", "no deployment"],
    ["https://evil.example/happy-otter-123.convex.site", "another host"],
    ["https://happy-otter-123.convex.site.evil.example", "a lookalike host"],
    ["https://a.b.convex.site", "a nested host"],
    ["https://user@happy-otter-123.convex.site", "a user name"],
    ["https://happy-otter-123.convex.site:8443", "a port"],
  ])("%j isn't one (%s)", (input) => {
    expect(panelAddress(input)).toBeNull();
  });
});

// Stands in for the network, recording what was sent.
function network(answer: () => Promise<Response>) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetch = (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return answer();
  };
  return { sent, fetch };
}

describe("sending a report", () => {
  test("posts it to the Panel with the token", async () => {
    const { sent, fetch } = network(async () => new Response(null, { status: 200 }));

    expect(await sendReport(settings, yawn, fetch)).toBe("accepted");
    expect(sent).toEqual([
      {
        url: "https://happy-otter-123.convex.site/api/watcher/report",
        init: {
          method: "POST",
          headers: {
            Authorization: "Bearer secret-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            slot: 0,
            characterName: "Yawn",
            total: 42,
            defeatFlags: [10000800],
          }),
        },
      },
    ]);
  });

  test("carries the Play Time only while the Streamer has it on", async () => {
    const { sent, fetch } = network(async () => new Response(null, { status: 200 }));

    await sendReport({ ...settings, sendPlayTime: true }, yawn, fetch);
    await sendReport(settings, yawn, fetch);

    expect(sent.map(({ init }) => JSON.parse(init.body as string).playTime)).toEqual([
      { seconds: 187_651, running: false },
      undefined,
    ]);
  });

  test.each([
    [401, "tokenRefused"],
    [400, "rejected"],
    [404, "unreachable"],
    [500, "unreachable"],
  ] as const)("a %i answer is %s", async (status, delivery) => {
    const { fetch } = network(async () => new Response(null, { status }));

    expect(await sendReport(settings, yawn, fetch)).toBe(delivery);
  });

  test("a failed request is unreachable", async () => {
    const { fetch } = network(() => Promise.reject(new TypeError("Failed to fetch")));

    expect(await sendReport(settings, yawn, fetch)).toBe("unreachable");
  });
});

describe("what the window says about reporting", () => {
  test.each([
    [undefined, "Waiting for the first report to send."],
    ["accepted", "Connected. The Panel accepted the last report."],
    ["tokenRefused", "The Panel refused the Watcher token. Create a new one in the Panel's Settings and paste it here."],
    ["rejected", "The Panel refused the report. This App may need an update."],
    ["unreachable", "Couldn't reach the Panel at this address."],
  ] as const)("after %s: %s", (delivery, text) => {
    expect(describeDelivery(delivery)).toBe(text);
  });
});
