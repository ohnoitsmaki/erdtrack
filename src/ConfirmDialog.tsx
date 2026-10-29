import { useState, type ReactElement, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ui/components/alert-dialog";
import { Button } from "@ui/components/button";
import { usePending } from "@ui/hooks/use-pending";

// Asks before a destructive action, or any other worth a second look, whose
// button isn't then red. Cancelling, Escape or clicking outside
// does nothing; confirming stays open with a spinner until the action is
// done, then closes. Opened by its trigger, or by the caller through open
// (see useConfirmTarget).
export function ConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  confirm,
  onConfirm,
  destructive = true,
}: {
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirm: string;
  onConfirm: () => Promise<unknown>;
  destructive?: boolean;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const [pending, track] = usePending();
  const change = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  return (
    <AlertDialog
      open={open ?? ownOpen}
      // It can't be dismissed while the action runs.
      onOpenChange={(next) => !pending && change(next)}
    >
      {trigger && <AlertDialogTrigger render={trigger} />}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            pending={pending}
            onClick={() =>
              track(async () => {
                await onConfirm();
                change(false);
              })
            }
          >
            {confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// What a ConfirmDialog opened for a row is about. The target is kept after
// the dialog closes, so its text doesn't change as it fades.
export function useConfirmTarget<T>() {
  const [target, setTarget] = useState<T>();
  const [open, setOpen] = useState(false);
  return {
    target,
    open,
    setOpen,
    ask: (item: T) => {
      setTarget(item);
      setOpen(true);
    },
  };
}
