import { useMutation, useQuery } from "convex/react";
import { Link, useLocation } from "wouter";
import { IconLayoutDashboard, IconMoodEmpty, IconPlayerPlay } from "@tabler/icons-react";
import { Badge } from "@ui/components/badge";
import { Button } from "@ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ui/components/empty";
import { Skeleton, SkeletonText } from "@ui/components/skeleton";
import { usePending } from "@ui/hooks/use-pending";
import { api } from "../../convex/_generated/api";
import { Counts, Tallies } from "../Counts";
import { useAttempt } from "../useAttempt";
import { History } from "./History";

// A Run's name over what's below it, which isn't known until it's here:
// most Runs opened aren't archived, so it's shaped like the card they show.
export function RunSkeleton() {
  return (
    <>
      <SkeletonText aria-busy="true" aria-label="Loading" className="w-32 text-lg" />
      <Skeleton className="h-[230px] w-full rounded-2xl" />
    </>
  );
}

// Archived Runs are read-only. Undoing the archiving in its history brings it
// back. A Run that isn't archived is worked on from the Overview.
export function Run({ runId }: { runId: string }) {
  const run = useQuery(api.runs.run, { runId });
  const setActive = useMutation(api.runs.setActive);
  const attempt = useAttempt();
  const [activating, track] = usePending();
  const [, navigate] = useLocation();
  if (run === undefined) {
    return <RunSkeleton />;
  }
  if (run === null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconMoodEmpty />
          </EmptyMedia>
          <EmptyTitle>No such Run</EmptyTitle>
          <EmptyDescription>This Run doesn't exist, or was deleted.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" nativeButton={false} render={<Link href="/runs" />}>
            All Runs
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  const heading = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <h2 className="truncate text-lg font-medium">{run.characterName}</h2>
      {run.active && <Badge>Active</Badge>}
      {run.archived && <Badge variant="secondary">Archived</Badge>}
    </div>
  );
  if (!run.archived) {
    return (
      <>
        {heading}
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLayoutDashboard />
            </EmptyMedia>
            <EmptyTitle>
              {run.active ? "This is the active Run" : "This Run isn't archived"}
            </EmptyTitle>
            <EmptyDescription>
              {run.active
                ? "Its Deaths, Counts and History are on the Overview."
                : "Make it active to work on it from the Overview."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {run.active ? (
              <Button nativeButton={false} render={<Link href="/" />}>
                <IconLayoutDashboard data-icon="inline-start" />
                Open the Overview
              </Button>
            ) : (
              <Button
                pending={activating}
                onClick={() =>
                  track(() =>
                    attempt(async () => {
                      await setActive({ runId: run._id });
                      navigate("/");
                    }),
                  )
                }
              >
                <IconPlayerPlay data-icon="inline-start" />
                Make active
              </Button>
            )}
          </EmptyContent>
        </Empty>
      </>
    );
  }
  return (
    <>
      {heading}
      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4 text-card-foreground">
        <Tallies run={run} />
        <Counts run={run} />
      </section>
      <History runId={run._id} />
    </>
  );
}
