import { cn } from "@ui/lib/utils";
import { nicknamed } from "./overview";

// A name, then any Nickname in a quieter style, over where it is, each cut
// short with the full name on hover.
export function Lines({
  title,
  nickname,
  detail,
  className,
  titleClassName,
}: {
  title: string;
  nickname?: string;
  detail?: string;
  className?: string;
  titleClassName?: string;
}) {
  const named = nicknamed(title, nickname);
  return (
    <span
      className={cn("flex min-w-0 flex-col", className)}
      title={detail ? `${named} — ${detail}` : named}
    >
      <span className="flex min-w-0 items-baseline gap-1">
        <span className={cn("truncate", titleClassName)}>{title}</span>
        {nickname && <Nickname nickname={nickname} />}
      </span>
      {detail && (
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      )}
    </span>
  );
}

// Takes at most half the line, so the boss's name still shows.
export function Nickname({ nickname }: { nickname: string }) {
  return (
    <span className="max-w-1/2 shrink-0 truncate text-sm font-normal text-muted-foreground">
      · “{nickname}”
    </span>
  );
}
