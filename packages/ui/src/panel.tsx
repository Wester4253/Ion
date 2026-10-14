import { h, render, type ComponentChildren, type VNode } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type {
  IonPluginInfo,
  IonPluginsApi,
  IonWebpackStatus,
  ShellSettingsApi,
  CatalogEntry,
  CatalogFile,
  StageResult,
} from "@ion/core";
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
  /** Catalog API for browsing and installing plugins/themes. */
  readonly catalog: {
    fetchAll(): Promise<readonly CatalogEntry[]>;
    fetchSource(source: string): Promise<readonly CatalogEntry[]>;
    download(entry: CatalogEntry): Promise<CatalogFile>;
    stage(file: CatalogFile): Promise<StageResult>;
  };
}

interface PanelProps {
  readonly ports: PanelPorts;
}

/**
 * Renders the panel's markup into `host`'s shadow root. Shadow DOM keeps
 * Discord's document styles (and user themes) out of Ion's UI and vice versa;
 * everything visual comes from PANEL_CSS over Discord's own design tokens.
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

/**
 * Discord's switch anatomy: a 48x24 pill with a 16px thumb that slides
 * between the two ends. State reads from aria-checked, like Discord's own.
 */
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
      <span class="ion-switch-thumb" />
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
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M9.55 18.2 3.4 12.05l1.4-1.4 4.75 4.75L19.2 5.8l1.4 1.4L9.55 18.2Z"
    />
  </svg>
);

/** Menu placement, in the fixed coordinate system's own units, measured from the trigger. */
interface MenuPosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

/**
 * Finds the origin of the coordinate system `position: fixed` resolves
 * against. Inside Discord's settings modal that is not the viewport: the
 * modal root carries an identity transform, which makes it the containing
 * block for fixed descendants (the observed cause of menus rendering ~40px
 * off their anchors). Walks up through shadow boundaries to the first
 * ancestor that establishes such a containing block.
 */
function fixedOrigin(element: Element): { left: number; top: number } {
  const view = element.ownerDocument.defaultView;
  let node: Element | null = element;
  while (node !== null) {
    const style = view?.getComputedStyle(node);
    if (style) {
      const willChange = style.willChange;
      const establishes =
        style.transform !== "none" ||
        style.filter !== "none" ||
        style.perspective !== "none" ||
        willChange.includes("transform") ||
        willChange.includes("filter") ||
        willChange.includes("perspective");
      if (establishes) {
        const rect = node.getBoundingClientRect();
        return { left: rect.left + node.clientLeft, top: rect.top + node.clientTop };
      }
    }
    const parent: Element | null = node.parentElement;
    if (parent !== null) {
      node = parent;
      continue;
    }
    const root: Node = node.getRootNode();
    node = root instanceof ShadowRoot ? root.host : null;
  }
  return { left: 0, top: 0 };
}

/**
 * Discord's select: a borderless trigger whose menu renders at a fixed
 * viewport position anchored below it — immune to the settings scroller's
 * clipping. Arrow keys move between options, Enter picks, Escape cancels,
 * and the menu closes on outside clicks and on any scroll (matching how
 * Discord dismisses its own popouts).
 */
function Select(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [value: string, label: string])[];
  readonly onChange: (value: string) => void;
}): VNode {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const selectedIndex = Math.max(
    0,
    props.options.findIndex(([value]) => value === props.value),
  );

  const openMenu = (): void => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const view = trigger.ownerDocument.defaultView;
    const rect = trigger.getBoundingClientRect();
    const origin = fixedOrigin(trigger);
    const width = Math.max(Math.round(rect.width), 200);
    // Options never wrap, so the menu's height is known before rendering:
    // flip above the trigger when the list would not fit below it.
    const height = props.options.length * 40 + 10;
    const belowTop = rect.bottom + 4;
    const top =
      belowTop + height > (view?.innerHeight ?? Number.POSITIVE_INFINITY) &&
      rect.top - 4 - height >= 0
        ? rect.top - 4 - height
        : belowTop;
    // Keep the menu inside the viewport horizontally.
    const viewportLeft = Math.max(8, Math.min(rect.left, (view?.innerWidth ?? 0) - width - 8));
    setPosition({
      left: Math.round(viewportLeft) - Math.round(origin.left),
      top: Math.round(top) - Math.round(origin.top),
      width,
    });
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: Event): void => {
      // At document level a shadow click retargets to the host, so inspect
      // the composed path — it reaches back through the shadow tree.
      const inside = event
        .composedPath()
        .some((node) => node instanceof Element && node.classList.contains("ion-select-wrap"));
      if (!inside) close(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close(true);
      else if (event.key === "Tab") close(false);
    };
    // A scrolled page moves the trigger; drop the menu rather than let it
    // drift, which is how Discord treats its own anchored popouts.
    const onScroll = (): void => {
      close(false);
    };
    const onResize = (): void => {
      close(false);
    };
    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("click", onDocumentClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const option =
      menuRef.current?.querySelectorAll<HTMLButtonElement>(".ion-select-option")[activeIndex];
    option?.focus({ preventScroll: true });
  }, [open, activeIndex]);

  const onMenuKeyDown = (event: KeyboardEvent): void => {
    const count = props.options.length;
    if (count === 0) return;
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (activeIndex + 1) % count;
    else if (event.key === "ArrowUp") next = (activeIndex - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    setActiveIndex(next);
  };

  const current = props.options[selectedIndex]?.[1] ?? props.value;

  return (
    <div class="ion-select-wrap">
      <button
        type="button"
        class="ion-select"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.label}
        ref={triggerRef}
        onClick={() => {
          if (open) close(false);
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span class="ion-select-label">{current}</span>
        <span class="ion-select-chevron">{CHEVRON_SVG}</span>
      </button>
      {open && position && (
        <ul
          class="ion-select-menu"
          role="listbox"
          aria-label={props.label}
          ref={menuRef}
          style={{
            left: `${String(position.left)}px`,
            top: `${String(position.top)}px`,
            minWidth: `${String(position.width)}px`,
          }}
          onKeyDown={onMenuKeyDown}
        >
          {props.options.map(([value, label]) => (
            <li key={value}>
              <button
                type="button"
                class="ion-select-option"
                role="option"
                aria-selected={value === props.value}
                onClick={() => {
                  props.onChange(value);
                  close(true);
                }}
              >
                <span class="ion-select-label">{label}</span>
                {value === props.value && CHECK_SVG}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Section(props: { readonly title: string; readonly children: ComponentChildren }): VNode {
  return (
    <section class="ion-section">
      <h2 class="ion-section-title">{props.title}</h2>
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

function PluginsSection({ ports }: PanelProps): VNode {
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
    <>
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
    </>
  );
}

function CatalogSection({ ports }: PanelProps): VNode {
  const [entries, setEntries] = useState<readonly CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    ports.catalog
      .fetchAll()
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ports]);

  const install = (entry: CatalogEntry): void => {
    setInstalling(entry.id);
    setInstallError(null);
    ports.catalog
      .download(entry)
      .then((file) => ports.catalog.stage(file))
      .then((result) => {
        if (!result.ok) {
          setInstallError(`${entry.name}: ${result.error}`);
        }
      })
      .catch((err: unknown) => {
        setInstallError(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        setInstalling(null);
      });
  };

  const filtered = filter
    ? entries.filter(
        (e) =>
          e.name.toLowerCase().includes(filter.toLowerCase()) ||
          e.author.toLowerCase().includes(filter.toLowerCase()),
      )
    : entries;

  if (loading) return <div class="ion-empty">Loading catalog…</div>;
  if (error) return <div class="ion-row-error ion-empty">{error}</div>;
  if (entries.length === 0) return <div class="ion-empty">No catalog entries found.</div>;

  return (
    <>
      <div class="ion-catalog-search">
        <input
          type="text"
          class="ion-catalog-input"
          placeholder="Search plugins and themes…"
          value={filter}
          onInput={(e) => {
            setFilter((e.target as HTMLInputElement).value);
          }}
        />
      </div>
      {filtered.map((entry) => (
        <div key={entry.id} class="ion-catalog-item">
          <div class="ion-catalog-info">
            <span class="ion-catalog-name">{entry.name}</span>
            <span class="ion-catalog-meta">
              by {entry.author}
              {entry.version ? ` · v${entry.version}` : ""} · {entry.ecosystem}
            </span>
            {entry.description && <span class="ion-catalog-desc">{entry.description}</span>}
          </div>
          <button
            class="ion-catalog-install"
            disabled={installing === entry.id}
            onClick={() => {
              install(entry);
            }}
          >
            {installing === entry.id ? "Installing…" : "Install"}
          </button>
        </div>
      ))}
      {installError && <div class="ion-row-error ion-empty">{installError}</div>}
      <div class="ion-catalog-note">
        Plugins are staged and will be available after restarting Ion.
      </div>
    </>
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
      {row.restart && <span class="ion-restart"> · Restart to apply</span>}
    </>
  );
}

function AppSection({ ports }: PanelProps): VNode {
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
    <>
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
    </>
  );
}

const ION_REPOSITORY = "https://github.com/Wester4253/Ion";

function AboutSection({ ports }: PanelProps): VNode {
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
    <>
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
    </>
  );
}

function Panel({ ports }: PanelProps): VNode {
  return (
    <div class="ion-page">
      <h1 class="ion-heading">Ion</h1>
      <Section title="Plugins">
        <PluginsSection ports={ports} />
      </Section>
      <hr class="ion-divider" />
      <Section title="Catalog">
        <CatalogSection ports={ports} />
      </Section>
      <hr class="ion-divider" />
      <Section title="App">
        <AppSection ports={ports} />
      </Section>
      <hr class="ion-divider" />
      <Section title="About">
        <AboutSection ports={ports} />
      </Section>
    </div>
  );
}
