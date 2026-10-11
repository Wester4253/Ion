import { h, render, type ComponentChildren, type VNode } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { IonPluginInfo, IonPluginsApi, IonWebpackStatus, ShellSettingsApi } from "@ion/core";
import { PANEL_CSS } from "./styles";

export interface PanelPorts {
  readonly plugins: IonPluginsApi;
  readonly shellSettings: ShellSettingsApi;
  /** Ion's own version string. */
  readonly version: string;
  /** Electron/Chromium version reported by the shell. */
  readonly shellVersion: string;
  readonly webpackStatus: () => IonWebpackStatus | undefined;
  readonly openExternal: (url: string) => Promise<void>;
}

interface PanelProps {
  readonly ports: PanelPorts;
}

/**
 * Renders the panel's markup into `host`'s shadow root. Shadow DOM keeps
 * Discord's document styles (and user themes) out of Ion's UI and vice versa;
 * everything visual comes from PANEL_CSS over Discord's own CSS variables.
 */
export function mountPanel(host: HTMLElement, ports: PanelPorts): () => void {
  const doc = host.ownerDocument;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });

  const style = doc.createElement("style");
  style.textContent = PANEL_CSS;
  const root = doc.createElement("div");
  root.className = "ion-root";
  shadow.append(style, root);

  render(h(Panel, { ports }), root);
  return () => {
    render(null, root);
    root.remove();
    style.remove();
  };
}

function Switch(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (next: boolean) => void;
}): VNode {
  return (
    <button
      type="button"
      class="ion-switch"
      role="switch"
      aria-label={props.label}
      aria-checked={props.checked}
      disabled={props.disabled ?? false}
      onClick={() => {
        props.onChange(!props.checked);
      }}
    >
      <span class="ion-switch-knob" />
    </button>
  );
}

const CHEVRON_SVG = (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M5.3 3.3a1 1 0 0 0-1.4 1.4l7 7a1 1 0 0 0 1.4 0l7-7a1 1 0 1 0-1.4-1.4L12 9.6 5.3 3.3Z"
    />
  </svg>
);

const CHECK_SVG = (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M9.55 18.2 3.4 12.05l1.4-1.4 4.75 4.75L19.2 5.8l1.4 1.4L9.55 18.2Z"
    />
  </svg>
);

function Select(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [value: string, label: string])[];
  readonly onChange: (value: string) => void;
}): VNode {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event): void => {
      // At document level a shadow click retargets to the host, so inspect
      // the composed path — it reaches back through the shadow tree.
      const inside = event
        .composedPath()
        .some((node) => node instanceof Element && node.classList.contains("ion-select-wrap"));
      if (inside) return;
      setOpen(false);
    };
    document.addEventListener("click", close, true);
    return () => {
      document.removeEventListener("click", close, true);
    };
  }, [open]);

  const current = props.options.find(([value]) => value === props.value)?.[1] ?? props.value;

  return (
    <div class="ion-select-wrap">
      <button
        type="button"
        class="ion-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.label}
        onClick={() => {
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <span class="ion-select-label">{current}</span>
        <span class="ion-select-chevron">{CHEVRON_SVG}</span>
      </button>
      {open && (
        <ul class="ion-select-menu" role="listbox" aria-label={props.label}>
          {props.options.map(([value, label]) => (
            <li key={value}>
              <button
                type="button"
                class="ion-select-option"
                role="option"
                aria-selected={value === props.value}
                onClick={() => {
                  props.onChange(value);
                  setOpen(false);
                }}
              >
                <span>{label}</span>
                {value === props.value && CHECK_SVG}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Card(props: { readonly title: string; readonly children: ComponentChildren }): VNode {
  return (
    <section class="ion-card">
      <h2 class="ion-card-title">{props.title}</h2>
      {props.children}
    </section>
  );
}

function Row(props: {
  readonly label: string;
  readonly description?: ComponentChildren;
  readonly trailing: ComponentChildren;
}): VNode {
  return (
    <div class="ion-row">
      <div class="ion-row-main">
        <div class="ion-row-label">{props.label}</div>
        {props.description !== undefined && <div class="ion-row-desc">{props.description}</div>}
      </div>
      {props.trailing}
    </div>
  );
}

function PluginsCard({ ports }: PanelProps): VNode {
  const [plugins, setPlugins] = useState<readonly IonPluginInfo[]>(() => ports.plugins.list());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = (): void => {
      setPlugins(ports.plugins.list());
    };
    refresh();
    return ports.plugins.subscribe(refresh);
  }, [ports]);

  const toggle = (plugin: IonPluginInfo, next: boolean): void => {
    setPendingId(plugin.id);
    setToggleError(null);
    ports.plugins
      .setEnabled(plugin.id, next)
      .catch((error: unknown) => {
        setToggleError(`${plugin.name}: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        setPendingId(null);
      });
  };

  return (
    <Card title="Plugins">
      {plugins.length === 0 && <div class="ion-empty">No plugins registered.</div>}
      {plugins.map((plugin) => (
        <Row
          key={plugin.id}
          label={plugin.name}
          description={
            plugin.state === "failed" && plugin.error ? (
              <span class="ion-row-error">{plugin.error}</span>
            ) : (
              <>
                <span class={`ion-state ion-state-${plugin.state}`}>{plugin.state}</span>
                <span> · </span>
                {plugin.description}
                {plugin.version ? ` · v${plugin.version}` : ""}
                {pendingId === plugin.id ? " · applying…" : ""}
              </>
            )
          }
          trailing={
            <Switch
              label={plugin.name}
              checked={plugin.enabled}
              disabled={pendingId === plugin.id}
              onChange={(next) => {
                toggle(plugin, next);
              }}
            />
          }
        />
      ))}
      {toggleError && <div class="ion-row-error ion-empty">{toggleError}</div>}
    </Card>
  );
}

interface AppSettingRow {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** True when the value only takes effect after a restart. */
  readonly restart: boolean;
}

const TOGGLE_SETTINGS: readonly AppSettingRow[] = [
  {
    key: "closeToTray",
    label: "Close button minimizes to tray",
    description: "Closing the window keeps Ion running in the tray.",
    restart: false,
  },
  {
    key: "trayEnabled",
    label: "Tray icon",
    description: "Show Ion in the system tray while it runs.",
    restart: true,
  },
  {
    key: "hardwareAcceleration",
    label: "Hardware acceleration",
    description: "Render the window with the GPU.",
    restart: true,
  },
];

interface AppSelectRow extends AppSettingRow {
  readonly options: readonly (readonly [value: string, label: string])[];
}

const SELECT_SETTINGS: readonly AppSelectRow[] = [
  {
    key: "gpuMode",
    label: "Graphics",
    description: "How Electron uses the GPU.",
    restart: true,
    options: [
      ["auto", "Automatic"],
      ["disabled", "Disabled (software)"],
    ],
  },
  {
    key: "ozonePlatform",
    label: "Display server",
    description: "Wayland, X11, or automatic selection at launch.",
    restart: true,
    options: [
      ["auto", "Automatic"],
      ["x11", "X11"],
      ["wayland", "Wayland"],
    ],
  },
  {
    key: "webRTCIPHandlingPolicy",
    label: "WebRTC IP handling",
    description: "Which local interfaces screen sharing may advertise.",
    restart: true,
    options: [
      ["default", "Browser default"],
      ["default_public_and_private_interfaces", "Public and private interfaces"],
      ["default_public_interface_only", "Public interface only"],
      ["disable_non_proxied_udp", "Disable non-proxied UDP"],
    ],
  },
];

function restartHint(row: AppSettingRow): ComponentChildren {
  return (
    <>
      {row.description}
      {row.restart && <span class="ion-restart">· Restart to apply</span>}
    </>
  );
}

function AppCard({ ports }: PanelProps): VNode {
  const [values, setValues] = useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    ports.shellSettings.getAll().then(
      (loaded) => {
        if (live) setValues(loaded);
      },
      (error: unknown) => {
        if (live) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      },
    );
    return () => {
      live = false;
    };
  }, [ports]);

  const update = (key: string, value: unknown): void => {
    setValues((previous) => (previous ? { ...previous, [key]: value } : previous));
    setLoadError(null);
    ports.shellSettings.set(key, value).then(
      (accepted) => {
        if (accepted) return undefined;
        // Refused: reload so the row reflects what is actually stored.
        return ports.shellSettings.getAll().then((loaded) => {
          setValues(loaded);
        });
      },
      (error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      },
    );
  };

  const disabled = values === null;

  return (
    <Card title="App">
      {loadError && <div class="ion-row-error ion-empty">{loadError}</div>}
      {TOGGLE_SETTINGS.map((row) => (
        <Row
          key={row.key}
          label={row.label}
          description={restartHint(row)}
          trailing={
            <Switch
              label={row.label}
              checked={values?.[row.key] === true}
              disabled={disabled}
              onChange={(next) => {
                update(row.key, next);
              }}
            />
          }
        />
      ))}
      {SELECT_SETTINGS.map((row) => (
        <Row
          key={row.key}
          label={row.label}
          description={restartHint(row)}
          trailing={
            <Select
              label={row.label}
              value={typeof values?.[row.key] === "string" ? (values[row.key] as string) : ""}
              options={row.options}
              onChange={(next) => {
                update(row.key, next);
              }}
            />
          }
        />
      ))}
    </Card>
  );
}

const ION_REPOSITORY = "https://github.com/Wester4253/Ion";

function AboutCard({ ports }: PanelProps): VNode {
  const [linkError, setLinkError] = useState<string | null>(null);
  const webpack = ports.webpackStatus();

  const open = async (url: string): Promise<void> => {
    try {
      await ports.openExternal(url);
      setLinkError(null);
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Card title="About">
      <Row label="Ion" description={`Version ${ports.version}`} trailing={<span />} />
      <Row label="Shell" description={`Electron ${ports.shellVersion}`} trailing={<span />} />
      <Row
        label="Webpack"
        description={
          webpack
            ? `${String(webpack.factories)} factories · ${webpack.ready ? "discovery ready" : "starting"}`
            : "Not observed yet"
        }
        trailing={<span />}
      />
      <Row
        label="Source"
        description={
          <>
            <button type="button" class="ion-link" onClick={() => void open(ION_REPOSITORY)}>
              GitHub repository
            </button>
            {linkError && <div class="ion-row-error">{linkError}</div>}
          </>
        }
        trailing={<span />}
      />
    </Card>
  );
}

function Panel({ ports }: PanelProps): VNode {
  return (
    <div class="ion-page">
      <h1 class="ion-title">Ion</h1>
      <PluginsCard ports={ports} />
      <AppCard ports={ports} />
      <AboutCard ports={ports} />
    </div>
  );
}
