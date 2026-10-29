import { describe, expect, test } from "vitest";
import { navFor, routeFor } from "./routes";

describe("the Panel's routes", () => {
  test("each page has its own path and title", () => {
    expect(routeFor("/")).toEqual({ page: "overview", title: "Overview" });
    expect(routeFor("/runs")).toEqual({ page: "runs", title: "Runs" });
    expect(routeFor("/history")).toEqual({
      page: "history",
      title: "History",
    });
  });

  test("a Run opens at its own path", () => {
    expect(routeFor("/runs/abc123")).toEqual({
      page: "run",
      title: "Run",
      runId: "abc123",
    });
  });

  test("the Overlay's style has a page of its own, apart from the Overlay", () => {
    expect(routeFor("/style")).toEqual({ page: "style", title: "Overlay" });
  });

  test("the Streamer and Mods can open Settings", () => {
    expect(routeFor("/settings")).toEqual({
      page: "settings",
      title: "Settings",
    });
  });

  test("an unknown path is sent to the Overview", () => {
    expect(routeFor("/nope")).toEqual({ redirect: "/" });
    expect(routeFor("/runs/abc/deaths")).toEqual({ redirect: "/" });
  });

  test("a trailing slash still finds the page", () => {
    expect(routeFor("/runs/")).toEqual({ page: "runs", title: "Runs" });
  });
});

describe("the sidebar's nav", () => {
  test("the Streamer and Mods see the same pages, Settings last", () => {
    expect(navFor()).toEqual([
      { page: "overview", path: "/", title: "Overview" },
      { page: "runs", path: "/runs", title: "Runs" },
      { page: "history", path: "/history", title: "History" },
      { page: "style", path: "/style", title: "Overlay" },
      { page: "settings", path: "/settings", title: "Settings" },
    ]);
  });
});
