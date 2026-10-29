import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { IconBroadcast } from "@tabler/icons-react";
import { SkeletonText } from "@ui/components/skeleton";
import { cn } from "@ui/lib/utils";
import { api } from "../convex/_generated/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAttempt } from "./useAttempt";

// Starts and ends the Stream, in the sidebar's status card so it's in reach
// from every page. While one is going, it shows how long for and its Deaths.
// Both ask first, since what the Overlay shows changes on stream, and a
// Stream started again counts from 0.
export function StreamControl() {
  const stream = useQuery(api.streams.current);
  const start = useMutation(api.streams.start);
  const end = useMutation(api.streams.end);
  const attempt = useAttempt();
  if (stream === undefined) {
    return <SkeletonText className="w-32" />;
  }
  if (stream === null) {
    return (
      <ConfirmDialog
        trigger={
          <button
            type="button"
            className="tap-target -m-1 flex items-center gap-2 rounded-lg p-1 font-medium outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <IconBroadcast className="size-4 text-muted-foreground" />
            Start the Stream
          </button>
        }
        title="Start the Stream?"
        description="The Overlay starts counting this Stream's Deaths from 0."
        confirm="Start the Stream"
        destructive={false}
        onConfirm={() => attempt(() => start({}))}
      />
    );
  }
  const deaths = `${stream.deaths} ${stream.deaths === 1 ? "Death" : "Deaths"}`;
  return (
    <div>
      <div className="flex items-center gap-2">
        <LiveDot />
        <span className="font-semibold">Live</span>
        <span className="text-muted-foreground tabular-nums">
          <Elapsed since={stream.startedAt} />
        </span>
        <ConfirmDialog
          trigger={
            <button
              type="button"
              className="tap-target ml-auto rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              End
            </button>
          }
          title="End the Stream?"
          description={`The Overlay stops showing its ${deaths}. Starting another counts from 0.`}
          confirm="End the Stream"
          onConfirm={() => attempt(() => end({}))}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">{deaths} this Stream</p>
    </div>
  );
}

// Live, as a red dot with a slow ring around it.
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-2 shrink-0", className)}>
      <span className="absolute inset-0 rounded-full bg-red-500 motion-safe:animate-ping motion-safe:[animation-duration:2s]" />
      <span className="relative size-full rounded-full bg-red-500" />
    </span>
  );
}

// The time since `since`, as h:mm:ss, ticking on every second.
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
