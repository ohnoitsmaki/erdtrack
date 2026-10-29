import { useMutation, useQuery } from "convex/react";
import { IconUserPlus, IconUsers } from "@tabler/icons-react";
import { Spinner } from "@ui/components/spinner";
import { usePending } from "@ui/hooks/use-pending";
import { cn } from "@ui/lib/utils";
import { api } from "../convex/_generated/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAttempt } from "./useAttempt";

// Whether the App on the Streamer's PC is reporting, and which character is
// being played, in the sidebar's status card so it's seen from every page.
// A Manual channel shows nothing. A character with no Run is offered as one
// to create, as nothing is reported for it until there's one. Another
// character of a Run's name, in another slot, is shown as such, with the
// Run offered to rebind to it.
export function WatcherStatus({ className }: { className?: string }) {
  const status = useQuery(api.watcher.status);
  const createRun = useMutation(api.runs.createRun);
  const rebind = useMutation(api.watcher.rebind);
  const attempt = useAttempt();
  const [pending, track] = usePending();
  if (!status) {
    return null;
  }
  const offered = status.needsRun ? status.characterName : null;
  const rebindable = status.otherCharacterRunId;
  return (
    <div role="status" className={cn("flex flex-col gap-2 text-xs", className)}>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            status.online ? "bg-emerald-400" : "bg-zinc-500",
          )}
        />
        <span className={status.online ? "text-foreground" : "text-muted-foreground"}>
          {status.online ? "Watcher online" : "Watcher offline"}
        </span>
        {status.characterName && (
          <span className="ml-auto truncate text-muted-foreground">
            {rebindable
              ? `Another ${status.characterName}`
              : `${status.online ? "" : "Last played "}${status.characterName}`}
          </span>
        )}
      </div>
      {offered && (
        <CardAction
          disabled={pending}
          onClick={() => track(() => attempt(() => createRun({ characterName: offered })))}
        >
          {pending ? <Spinner /> : <IconUserPlus />}
          Create {offered}'s Run
        </CardAction>
      )}
      {rebindable && (
        <ConfirmDialog
          trigger={
            <CardAction>
              <IconUsers />
              This one is the real {status.characterName}
            </CardAction>
          }
          title={`Follow this ${status.characterName}?`}
          description={`${status.characterName}'s Run follows the character being played from now on, and becomes the active Run. The one it followed becomes the other character. Its next report brings in this character's beaten bosses. No Deaths are removed, and it can be undone in History.`}
          confirm="Follow this one"
          destructive={false}
          onConfirm={() => attempt(() => rebind({ runId: rebindable }))}
        />
      )}
    </div>
  );
}

function CardAction(props: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className="tap-target flex h-8 items-center gap-1.5 rounded-lg bg-secondary px-2.5 text-meta font-medium outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0"
    />
  );
}
