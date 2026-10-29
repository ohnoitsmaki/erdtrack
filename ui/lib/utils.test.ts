import { expect, test } from "vitest";
import { cn } from "./utils";

test("the theme's own text sizes stay beside a text colour", () => {
  expect(cn("text-body", "text-muted-foreground")).toBe("text-body text-muted-foreground");
  expect(cn("text-meta text-muted-foreground")).toBe("text-meta text-muted-foreground");
});

test("they replace another text size, like any size does", () => {
  expect(cn("text-sm", "text-body")).toBe("text-body");
  expect(cn("text-meta", "text-xs")).toBe("text-xs");
});
