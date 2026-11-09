import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { ConfirmDialog, useConfirmTarget } from "./ConfirmDialog";
import { useAttempt } from "./useAttempt";

type Target = { _id: Id<"runs">; characterName: string };

// Makes a Run the active one, which the Overlay switches to at once. While a
// Stream is live that's in front of viewers, so it asks first; off stream
// it's one click, as when setting up. Render `dialog` alongside the menu.
export function useMakeActive() {
  const setActive = useMutation(api.runs.setActive);
  const stream = useQuery(api.streams.current);
  const attempt = useAttempt();
  const { target, open, setOpen, ask } = useConfirmTarget<Target>();
  const activate = (run: Target) => attempt(() => setActive({ runId: run._id }));
  const makeActive = async (run: Target) => {
    if (stream) {
      ask(run);
      return;
    }
    await activate(run);
  };
  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={`Switch the Overlay to ${target?.characterName ?? "this Run"}?`}
      description="The Stream is live, so viewers see the switch straight away."
      confirm="Switch Run"
      destructive={false}
      onConfirm={() => (target ? activate(target) : Promise.resolve())}
    />
  );
  return { makeActive, dialog };
}
