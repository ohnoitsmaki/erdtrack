import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@ui/components/brand-mark";
import { Button } from "@ui/components/button";
import { Checkbox } from "@ui/components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@ui/components/field";
import { Input } from "@ui/components/input";
import {
  describeDelivery,
  panelAddress,
  sendReport,
  type Delivery,
} from "./reporter";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { describeWatcher, onWatcherEvent, type WatcherState } from "./status";
import { watchSave, type Report } from "./watcher";

export function App() {
  const [state, setState] = useState<WatcherState>({});
  // Undefined until loaded from next to the exe.
  const [settings, setSettings] = useState<Settings>();
  const [delivery, setDelivery] = useState<Delivery>();
  // The Watcher's channel outlives renders, so it reads these through refs.
  const settingsRef = useRef<Settings>(undefined);
  const lastReport = useRef<Report>(undefined);

  // Each report the Watcher hands over is sent as it comes, heartbeats
  // included. Until both are set, nothing is sent.
  async function send(report: Report) {
    const current = settingsRef.current;
    if (current?.panelAddress && current.token) {
      const result = await sendReport(current, report);
      // A report sent before the settings changed says nothing about them.
      if (settingsRef.current === current) {
        setDelivery(result);
      }
    }
  }

  useEffect(() => {
    let current = true;
    void loadSettings().then((loaded) => {
      if (current) {
        settingsRef.current = loaded;
        setSettings(loaded);
      }
    });
    void watchSave((event) => {
      if (!current) {
        return;
      }
      setState((state) => onWatcherEvent(state, event));
      if (event.kind === "report") {
        lastReport.current = event.report;
        void send(event.report);
      }
    });
    return () => {
      current = false;
    };
  }, []);

  // Sent again at once with the new settings, so the window doesn't wait for
  // the next heartbeat to say whether they work.
  async function save(saved: Settings) {
    await saveSettings(saved);
    settingsRef.current = saved;
    setSettings(saved);
    setDelivery(undefined);
    if (lastReport.current) {
      await send(lastReport.current);
    }
  }

  const { game, character } = describeWatcher(state);
  const configured = Boolean(settings?.panelAddress && settings.token);

  return (
    <main className="flex min-h-svh flex-col gap-6 p-6">
      <BrandMark />
      <p className="text-sm text-muted-foreground" role="status">
        {game}
      </p>
      {character && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Character</dt>
          <dd>
            {character.name}{" "}
            <span className="text-muted-foreground">(slot {character.slot})</span>
          </dd>
          <dt className="text-muted-foreground">Save Total</dt>
          <dd className="tabular-nums">{character.total}</dd>
          <dt className="text-muted-foreground">Bosses beaten</dt>
          <dd className="tabular-nums">{character.bossesBeaten}</dd>
        </dl>
      )}
      {configured && (
        <p className="text-sm" role="status">
          {describeDelivery(delivery)}
        </p>
      )}
      {settings && <SettingsForm settings={settings} onSave={save} />}
    </main>
  );
}

// Both come from the Panel: its address, and the Watcher token the Streamer
// created in its Settings. Play Time is the Streamer's to turn on, here
// only, since it's more of the save than the Watcher needs.
function SettingsForm({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
}) {
  const [address, setAddress] = useState(settings.panelAddress);
  const [token, setToken] = useState(settings.token);
  const [sendPlayTime, setSendPlayTime] = useState(settings.sendPlayTime);
  const [problem, setProblem] = useState<string>();
  const [saving, setSaving] = useState(false);
  const changed =
    address.trim() !== settings.panelAddress ||
    token.trim() !== settings.token ||
    sendPlayTime !== settings.sendPlayTime;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const origin = panelAddress(address);
        if (!origin) {
          setProblem(
            "That isn't a Panel's address. It looks like https://happy-otter-123.convex.site.",
          );
          return;
        }
        if (!token.trim()) {
          setProblem("Paste the Watcher token from the Panel's Settings.");
          return;
        }
        setProblem(undefined);
        setSaving(true);
        onSave({ panelAddress: origin, token: token.trim(), sendPlayTime })
          .then(() => {
            setAddress(origin);
            setToken(token.trim());
          })
          .catch((error: unknown) => setProblem(String(error)))
          .finally(() => setSaving(false));
      }}
    >
      <Field className="gap-1.5">
        <FieldLabel htmlFor="panel-address">Panel address</FieldLabel>
        <Input
          id="panel-address"
          placeholder="https://happy-otter-123.convex.site"
          autoComplete="off"
          spellCheck={false}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </Field>
      <Field className="gap-1.5">
        <FieldLabel htmlFor="watcher-token">Watcher token</FieldLabel>
        <Input
          id="watcher-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </Field>
      <Field orientation="horizontal">
        <Checkbox
          id="play-time"
          checked={sendPlayTime}
          onCheckedChange={(checked) => setSendPlayTime(checked)}
        />
        <FieldContent>
          <FieldLabel htmlFor="play-time">Send the Play Time</FieldLabel>
          <FieldDescription>
            So the Overlay can show it. Turning it off makes the Panel forget
            it.
          </FieldDescription>
        </FieldContent>
      </Field>
      {problem && <FieldError>{problem}</FieldError>}
      <Button type="submit" disabled={!changed} pending={saving}>
        Save
      </Button>
    </form>
  );
}
