// Dev only: watches the page's layout shifts while in the preview, for
// finding where a skeleton isn't the shape of what replaces it. A chip in
// the corner keeps the score, Cumulative Layout Shift as Lighthouse counts
// it, and each shift is logged to the console with the elements that moved
// and from where to where. The score is on <html data-cls>, and the shifts
// on <html data-shifts>, for a script to read. While the preview holds its
// data back, the chip releases it.

type Shift = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
  sources: { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
};

// Below this a shift isn't worth a line in the console.
const NOTICEABLE = 0.001;

export function watchLayoutShifts({ onRelease }: { onRelease?: () => void } = {}) {
  if (!PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) {
    return;
  }
  // As wide whatever it says, so it doesn't shift itself.
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className =
    "fixed right-2 bottom-2 z-[9999] w-28 rounded-full border bg-card/90 py-1 text-center font-mono text-xs text-muted-foreground tabular-nums shadow-lg backdrop-blur enabled:cursor-pointer enabled:text-foreground enabled:hover:bg-secondary";
  let held = onRelease !== undefined;
  chip.disabled = !held;
  chip.addEventListener("click", () => {
    held = false;
    chip.disabled = true;
    onRelease?.();
    show();
  });
  document.body.append(chip);

  // Shifts within a second of each other, over five seconds at most, are a
  // session; the score is the worst session's.
  let score = 0;
  let session = 0;
  let first = 0;
  let last = 0;
  const logged: string[] = [];
  const show = () => {
    const text = score.toFixed(3);
    chip.textContent = held ? "Release ▶" : `CLS ${text}`;
    chip.classList.toggle("text-emerald-400", score < 0.1);
    chip.classList.toggle("text-amber-400", score >= 0.1 && score < 0.25);
    chip.classList.toggle("text-red-400", score >= 0.25);
    document.documentElement.dataset.cls = text;
  };
  show();

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as Shift[]) {
      if (entry.hadRecentInput) {
        continue;
      }
      if (session && entry.startTime - last < 1000 && entry.startTime - first < 5000) {
        session += entry.value;
      } else {
        session = entry.value;
        first = entry.startTime;
      }
      last = entry.startTime;
      score = Math.max(score, session);
      show();
      if (entry.value >= NOTICEABLE) {
        console.groupCollapsed(
          `%cLayout shift ${entry.value.toFixed(4)} at ${Math.round(entry.startTime)}ms`,
          "color: #faed76",
        );
        logged.push(`${entry.value.toFixed(4)} at ${Math.round(entry.startTime)}ms`);
        for (const { node, previousRect: was, currentRect: now } of entry.sources) {
          console.log(node, `${rect(was)} → ${rect(now)}`);
          logged.push(`  ${describe(node)}: ${rect(was)} → ${rect(now)}`);
        }
        console.groupEnd();
        document.documentElement.dataset.shifts = logged.join("\n");
      }
    }
  }).observe({ type: "layout-shift", buffered: true });
}

function rect({ x, y, width, height }: DOMRectReadOnly) {
  return `${Math.round(width)}×${Math.round(height)} at ${Math.round(x)},${Math.round(y)}`;
}

function describe(node: Node | null) {
  if (!(node instanceof Element)) {
    return node?.nodeName ?? "?";
  }
  const label = node.getAttribute("aria-label") ?? node.textContent?.trim().slice(0, 30);
  return `<${node.localName} ${node.className.toString().slice(0, 60)}> "${label}"`;
}
