import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { IconCopy, IconKey, IconPlus, IconUserPlus } from "@tabler/icons-react";
import { Button } from "@ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@ui/components/card";
import { Field, FieldError, FieldLabel } from "@ui/components/field";
import { Input } from "@ui/components/input";
import { Skeleton, SkeletonText } from "@ui/components/skeleton";
import { usePending } from "@ui/hooks/use-pending";
import { api } from "../../convex/_generated/api";
import { MAX_TAG_NAME_LENGTH } from "../../convex/tagLimits";
import { ConfirmDialog, useConfirmTarget } from "../ConfirmDialog";
import { loginProblem } from "../mods";
import type { Role } from "../routes";
import { useAttempt } from "../useAttempt";

type Mod = FunctionReturnType<typeof api.mods.list>[number];
type Tag = FunctionReturnType<typeof api.tags.list>[number];

// Mods manage only Tags here.
export function Settings({ role }: { role: Role }) {
  return (
    <>
      {role === "owner" && <Mods />}
      {role === "owner" && <Watcher />}
      <Tags />
    </>
  );
}

// Settings with what's the channel's yet to come. While who's viewing isn't
// known, `role` is who it was last time.
export function SettingsSkeleton({ role }: { role: Role }) {
  return (
    <>
      {role === "owner" && (
        <Card aria-busy="true" aria-label="Loading">
          <CardHeader>
            <CardTitle>Mods</CardTitle>
          </CardHeader>
          <CardContent>
            <ListSkeleton rows={2} lines={2} />
          </CardContent>
          <CardFooter>
            <AddMod />
          </CardFooter>
        </Card>
      )}
      {role === "owner" && (
        <Card aria-busy="true" aria-label="Loading">
          <CardHeader>
            <CardTitle>Watcher</CardTitle>
            <CardDescription>
              <SkeletonText className="w-4/5" />
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Skeleton className="h-11 w-36 rounded-full sm:h-9" />
          </CardFooter>
        </Card>
      )}
      <Card aria-busy="true" aria-label="Loading">
        <CardHeader>
          <CardTitle>Tags</CardTitle>
        </CardHeader>
        <CardContent>
          <ListSkeleton rows={2} lines={1} />
        </CardContent>
        <CardFooter>
          <AddTag />
        </CardFooter>
      </Card>
    </>
  );
}

// Rows like a Mod's or a Tag's, with a Remove at the end.
function ListSkeleton({ rows, lines }: { rows: number; lines: 1 | 2 }) {
  return (
    <ol aria-busy="true" aria-label="Loading" className="flex flex-col rounded-2xl border">
      {Array.from({ length: rows }, (_, row) => (
        <li key={row} className="flex min-h-14 items-center gap-2 border-b px-4 py-2 last:border-b-0">
          {lines === 2 ? (
            <span className="flex min-w-0 flex-1 flex-col">
              <SkeletonText className={row % 2 ? "w-16" : "w-24"} />
              <SkeletonText className={row % 2 ? "w-28" : "w-20"} />
            </span>
          ) : (
            <Skeleton className="h-11 min-w-0 flex-1 rounded-full sm:h-9" />
          )}
          <span className="flex h-11 w-[4.75rem] items-center justify-center sm:h-8">
            <SkeletonText className="w-12" />
          </span>
        </li>
      ))}
    </ol>
  );
}

// The Watcher token makes the channel Watched: the App on the Streamer's PC
// reports with it. It's shown once, when it's created, and replacing or
// revoking it stops the App reporting with the old one, so both ask first.
function Watcher() {
  const watched = useQuery(api.watcher.hasToken);
  const createToken = useAction(api.watcher.createToken);
  const revokeToken = useMutation(api.watcher.revokeToken);
  const attempt = useAttempt();
  const [creating, track] = usePending();
  const [token, setToken] = useState<string>();
  const create = () =>
    track(() => attempt(async () => setToken(await createToken({}))));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Watcher</CardTitle>
        <CardDescription>
          {watched === undefined ? (
            <SkeletonText aria-busy="true" aria-label="Loading" className="w-4/5" />
          ) : watched
            ? "This channel is Watched. The App on your PC reports from the save with its Watcher token."
            : "This channel is Manual. To have the App on your PC report from the save, create a Watcher token and paste it into the App."}
        </CardDescription>
      </CardHeader>
      {token && (
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">
            Paste these into the App. The token is shown only now.
          </p>
          <CopyField id="panel-address" label="Panel address" value={window.location.origin} />
          <CopyField id="watcher-token" label="Watcher token" value={token} />
        </CardContent>
      )}
      <CardFooter className="flex flex-wrap gap-2">
        {watched === undefined ? (
          <Skeleton className="h-11 w-36 rounded-full sm:h-9" />
        ) : watched ? (
          <>
            <ConfirmDialog
              trigger={
                <Button variant="outline" className="h-11 sm:h-9" pending={creating}>
                  <IconKey data-icon="inline-start" />
                  Replace token
                </Button>
              }
              title="Replace the Watcher token?"
              description="The App stops reporting until you paste the new token into it."
              confirm="Replace token"
              onConfirm={create}
            />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" className="h-11 text-destructive sm:h-9">
                  Revoke token
                </Button>
              }
              title="Revoke the Watcher token?"
              description="The App stops reporting, and the channel is Manual again."
              confirm="Revoke token"
              onConfirm={() =>
                attempt(async () => {
                  await revokeToken({});
                  setToken(undefined);
                })
              }
            />
          </>
        ) : (
          <Button className="h-11 sm:h-9" pending={creating} onClick={create}>
            <IconKey data-icon="inline-start" />
            Create Watcher token
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input
          id={id}
          readOnly
          spellCheck={false}
          className="h-11 min-w-0 flex-1 font-mono sm:h-9"
          value={value}
          onFocus={(event) => event.target.select()}
        />
        <Button
          variant="outline"
          className="h-11 sm:h-9"
          onClick={() =>
            void navigator.clipboard.writeText(value).then(() => setCopied(true))
          }
        >
          <IconCopy data-icon="inline-start" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Field>
  );
}

function Tags() {
  const tags = useQuery(api.tags.list);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tags</CardTitle>
      </CardHeader>
      <CardContent>
        {tags === undefined ? (
          <ListSkeleton rows={2} lines={1} />
        ) : (
          <ol className="flex flex-col rounded-2xl border">
            {tags.map((tag) => (
              // Keyed by name too, so a rename by someone else shows.
              <TagRow key={`${tag._id}:${tag.name}`} tag={tag} />
            ))}
          </ol>
        )}
      </CardContent>
      <CardFooter>
        <AddTag />
      </CardFooter>
    </Card>
  );
}

// Renamed by editing its name, which is saved once it's changed and
// submitted.
function TagRow({ tag }: { tag: Tag }) {
  const rename = useMutation(api.tags.rename);
  const remove = useMutation(api.tags.remove);
  const attempt = useAttempt();
  const [renaming, trackRename] = usePending();
  const [removing, trackRemove] = usePending();
  const [name, setName] = useState(tag.name);
  const changed = name.trim() !== tag.name;
  return (
    <li className="flex min-h-14 items-center gap-2 border-b px-4 py-2 last:border-b-0">
      <form
        className="flex min-w-0 flex-1 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && name.trim()) {
            trackRename(() => attempt(() => rename({ tagId: tag._id, name })));
          }
        }}
      >
        <Input
          aria-label={`Rename ${tag.name}`}
          autoComplete="off"
          maxLength={MAX_TAG_NAME_LENGTH}
          className="h-11 min-w-0 flex-1 sm:h-9"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {changed && (
          <Button
            type="submit"
            variant="outline"
            className="h-11 sm:h-9"
            disabled={!name.trim()}
            pending={renaming}
          >
            Rename
          </Button>
        )}
      </form>
      <Button
        variant="ghost"
        size="sm"
        className="h-11 text-destructive sm:h-8"
        pending={removing}
        onClick={() => trackRemove(() => attempt(() => remove({ tagId: tag._id })))}
      >
        Remove
      </Button>
    </li>
  );
}

function AddTag() {
  const create = useMutation(api.tags.create);
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
            await create({ name });
            setName("");
          }),
        );
      }}
    >
      <Field className="flex-1 gap-1.5">
        <FieldLabel htmlFor="tag-name" className="sr-only">
          Tag name
        </FieldLabel>
        <Input
          id="tag-name"
          placeholder="Tag name"
          autoComplete="off"
          maxLength={MAX_TAG_NAME_LENGTH}
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
        <IconPlus data-icon="inline-start" />
        Create Tag
      </Button>
    </form>
  );
}

// Removing a Mod signs them out at once, so it asks before it does.
function Mods() {
  const mods = useQuery(api.mods.list);
  const remove = useMutation(api.mods.remove);
  const attempt = useAttempt();
  const removing = useConfirmTarget<Mod>();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mods</CardTitle>
      </CardHeader>
      <CardContent>
        {mods === undefined ? (
          <ListSkeleton rows={2} lines={2} />
        ) : mods.length ? (
          <ol className="flex flex-col rounded-2xl border">
            {mods.map((mod) => (
              <li
                key={mod._id}
                className="flex min-h-14 items-center gap-2 border-b px-4 py-2 last:border-b-0"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">
                    {mod.displayName ?? mod.login}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {mod.displayName ? mod.login : "hasn't signed in yet"}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 text-destructive sm:h-8"
                  onClick={() => removing.ask(mod)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground">No Mods yet.</p>
        )}
      </CardContent>
      <CardFooter>
        <AddMod />
      </CardFooter>
      <ConfirmDialog
        open={removing.open}
        onOpenChange={removing.setOpen}
        title={`Remove ${removing.target?.displayName ?? removing.target?.login}?`}
        description="They'll be signed out straight away."
        confirm="Remove"
        onConfirm={() => attempt(() => remove({ modId: removing.target!._id }))}
      />
    </Card>
  );
}

// A login that can't be a Twitch login is caught here as it's typed; the
// backend's other refusals, like an existing Mod, are toasts.
function AddMod() {
  const add = useMutation(api.mods.add);
  const attempt = useAttempt();
  const [pending, track] = usePending();
  const [login, setLogin] = useState("");
  const problem = login.trim() ? loginProblem(login) : undefined;
  return (
    <form
      className="flex w-full flex-col gap-2 sm:flex-row sm:items-start"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!login.trim() || problem) {
          return;
        }
        track(() =>
          attempt(async () => {
            await add({ login });
            setLogin("");
          }),
        );
      }}
    >
      <Field data-invalid={problem !== undefined} className="flex-1 gap-1.5">
        <FieldLabel htmlFor="mod-login" className="sr-only">
          Twitch login
        </FieldLabel>
        <Input
          id="mod-login"
          placeholder="Twitch login"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="h-11 sm:h-9"
          aria-invalid={problem !== undefined}
          value={login}
          onChange={(event) => setLogin(event.target.value)}
        />
        <FieldError>{problem}</FieldError>
      </Field>
      <Button
        type="submit"
        className="h-11 sm:h-9"
        disabled={!login.trim() || !!problem}
        pending={pending}
      >
        <IconUserPlus data-icon="inline-start" />
        Add Mod
      </Button>
    </form>
  );
}
