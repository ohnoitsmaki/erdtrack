import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Link } from "wouter";
import {
  IconArchive,
  IconDots,
  IconListDetails,
  IconPlayerPlay,
  IconTrash,
} from "@tabler/icons-react";
import { Badge } from "@ui/components/badge";
import { Button } from "@ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ui/components/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ui/components/empty";
import { SkeletonText } from "@ui/components/skeleton";
import { usePending } from "@ui/hooks/use-pending";
import { api } from "../../convex/_generated/api";
import { ConfirmDialog, useConfirmTarget } from "../ConfirmDialog";
import { CreateRun } from "../CreateRun";
import type { Role } from "../routes";
import { runActions } from "../runs";
import { useAttempt } from "../useAttempt";

type RunRow = FunctionReturnType<typeof api.runs.list>[number];

// Every Run, and a new one for another character. A Mod switches the active
// Run by hand. Each Run opens at its own page.
export function Runs({ role }: { role: Role }) {
  const runs = useQuery(api.runs.list);
  const deleteRun = useMutation(api.runs.deleteRun);
  const attempt = useAttempt();
  const deleting = useConfirmTarget<RunRow>();
  if (!runs) {
    return <RunsSkeleton />;
  }
  return (
    <>
      <CreateRun />
      {runs.length ? (
        <ol className="flex flex-col rounded-2xl border bg-card text-card-foreground">
          {runs.map((run) => (
            <RunItem
              key={run._id}
              run={run}
              role={role}
              onDelete={() => deleting.ask(run)}
            />
          ))}
        </ol>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconListDetails />
            </EmptyMedia>
            <EmptyTitle>No Runs yet</EmptyTitle>
            <EmptyDescription>Create one for a character above.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ConfirmDialog
        open={deleting.open}
        onOpenChange={deleting.setOpen}
        title={`Delete ${deleting.target?.characterName}?`}
        description="This deletes the Run and its whole history and can't be undone."
        confirm="Delete"
        onConfirm={() => attempt(() => deleteRun({ runId: deleting.target!._id }))}
      />
    </>
  );
}

// The Runs page with its Runs yet to come, as rows like RunItem's.
export function RunsSkeleton() {
  return (
    <>
      <CreateRun />
      <ol
        aria-busy="true"
        aria-label="Loading"
        className="flex flex-col rounded-2xl border bg-card text-card-foreground"
      >
        {["w-28", "w-20", "w-24"].map((width) => (
          <li key={width} className="flex min-h-16 items-center gap-2 border-b px-4 py-2 last:border-b-0">
            <span className="flex min-w-0 flex-1 flex-col gap-1 py-1 sm:flex-row sm:items-center sm:gap-4">
              <span className="flex min-w-0 sm:flex-1">
                <SkeletonText className={width} />
              </span>
              <span className="flex text-sm sm:w-24 sm:justify-end">
                <SkeletonText className="w-16" />
              </span>
            </span>
            <span className="size-11 shrink-0 sm:size-9" />
          </li>
        ))}
      </ol>
    </>
  );
}

// On desktop, name and Total line up as columns; on a phone they stack.
function RunItem({
  run,
  role,
  onDelete,
}: {
  run: RunRow;
  role: Role;
  onDelete: () => void;
}) {
  const setActive = useMutation(api.runs.setActive);
  const archive = useMutation(api.runs.archive);
  const attempt = useAttempt();
  // The menu closes as an action is picked, so its button shows the spinner.
  const [pending, track] = usePending();
  const actions = runActions(run, role);
  return (
    <li className="flex min-h-16 items-center gap-2 border-b px-4 py-2 last:border-b-0">
      <Link
        href={`/runs/${run._id}`}
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/30 sm:flex-row sm:items-center sm:gap-4"
      >
        <span className="flex min-w-0 items-center gap-2 sm:flex-1">
          <span className="truncate font-medium">{run.characterName}</span>
          {run.active && <Badge>Active</Badge>}
          {run.archived && <Badge variant="secondary">Archived</Badge>}
        </span>
        <span className="flex gap-3 text-sm text-muted-foreground sm:contents">
          <span className="sm:w-24 sm:text-right">
            Total{" "}
            <span className="font-mono text-foreground tabular-nums">{run.total}</span>
          </span>
        </span>
      </Link>
      {actions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-11 sm:size-9"
                pending={pending}
                aria-label={`Actions for ${run.characterName}`}
              />
            }
          >
            <IconDots />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {actions.includes("makeActive") && (
              <DropdownMenuItem
                onClick={() => track(() => attempt(() => setActive({ runId: run._id })))}
              >
                <IconPlayerPlay />
                Make active
              </DropdownMenuItem>
            )}
            {actions.includes("archive") && (
              <DropdownMenuItem
                onClick={() => track(() => attempt(() => archive({ runId: run._id })))}
              >
                <IconArchive />
                Archive
              </DropdownMenuItem>
            )}
            {actions.includes("delete") && (
              <>
                {actions.length > 1 && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <IconTrash />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
