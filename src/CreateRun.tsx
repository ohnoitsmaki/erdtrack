import { useState } from "react";
import { useMutation } from "convex/react";
import { IconUserPlus } from "@tabler/icons-react";
import { Button } from "@ui/components/button";
import { Field, FieldLabel } from "@ui/components/field";
import { Input } from "@ui/components/input";
import { usePending } from "@ui/hooks/use-pending";
import { api } from "../convex/_generated/api";
import { MAX_CHARACTER_NAME_LENGTH } from "../convex/runLimits";
import { useAttempt } from "./useAttempt";

// A new Run for a character, which becomes the active Run.
export function CreateRun() {
  const createRun = useMutation(api.runs.createRun);
  const attempt = useAttempt();
  const [pending, track] = usePending();
  const [name, setName] = useState("");
  return (
    <form
      className="flex w-full flex-col gap-2 sm:flex-row sm:items-start"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) {
          return;
        }
        track(() =>
          attempt(async () => {
            await createRun({ characterName: name });
            setName("");
          }),
        );
      }}
    >
      <Field className="flex-1 gap-1.5">
        <FieldLabel htmlFor="character-name" className="sr-only">
          Character name
        </FieldLabel>
        <Input
          id="character-name"
          placeholder="Character name"
          autoComplete="off"
          maxLength={MAX_CHARACTER_NAME_LENGTH}
          className="h-11 sm:h-9"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Button
        type="submit"
        className="h-11 sm:h-9"
        disabled={!name.trim()}
        pending={pending}
      >
        <IconUserPlus data-icon="inline-start" />
        Create Run
      </Button>
    </form>
  );
}
