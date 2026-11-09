import { useMutation, useQuery } from "convex/react";
import { IconSpeakerphone } from "@tabler/icons-react";
import { Button } from "@ui/components/button";
import { usePending } from "@ui/hooks/use-pending";
import { api } from "../convex/_generated/api";
import { parseStyle } from "./overlay/style";
import { useAttempt } from "./useAttempt";

type Counted = { name: string; deathCount: number };

// The boss the Overlay pops out by hand: the one with the most Deaths of
// those on its lists but Overworld. There's none before one has a Death.
export function toughestOf<E extends Counted>(encounters: E[]): E | null {
  return encounters.reduce<E | null>(
    (most, encounter) =>
      encounter.deathCount > (most?.deathCount ?? 0) ? encounter : most,
    null,
  );
}

// Whether the Overlay's style has a Popout line: only the Banner and the
// Framed banner do.
export function useHasPopouts() {
  const saved = useQuery(api.overlayStyle.current);
  if (saved === undefined) {
    return false;
  }
  const { layout } = parseStyle(saved);
  return layout === "banner" || layout === "framed";
}

// Pops out the boss with the most Deaths on the Overlay, such as when chat
// asks. `name` is how the Overlay shows it. With `labelled`, it says so in
// words, for the Overview; otherwise it's an icon, beside the Preview.
export function PopOutButton({
  name,
  labelled = false,
}: {
  name: string | null;
  labelled?: boolean;
}) {
  const popOut = useMutation(api.overlay.popOut);
  const attempt = useAttempt();
  const [popping, track] = usePending();
  const label = name
    ? `Pop out ${name}, the boss with the most Deaths`
    : "Pop out the boss with the most Deaths";
  const press = () => track(() => attempt(() => popOut({})));
  return labelled ? (
    <Button
      variant="ghost"
      size="sm"
      className="text-meta text-muted-foreground"
      title={label}
      disabled={!name}
      pending={popping}
      onClick={press}
    >
      <IconSpeakerphone data-icon="inline-start" />
      Pop out
    </Button>
  ) : (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={!name}
      pending={popping}
      onClick={press}
    >
      <IconSpeakerphone />
    </Button>
  );
}
