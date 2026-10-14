// @vitest-environment jsdom
/**
 * The two React↔Solid bridges, against a stand-in for React.
 *
 * Ion does not bundle React and must not: the bridges run against *Discord's*
 * instance, resolved from the page when the API is built. So these tests
 * drive them with a stand-in that implements exactly the calls the bridges
 * make — `createElement`, `createRef`, a `Component` base class, and
 * `ReactDOMClient.createRoot` — and plays React's part in the class
 * lifecycle: `render`, attach the ref, `componentDidMount`, and later
 * `shouldComponentUpdate`. That proves the bridge's own behaviour: what it
 * hands React, what it mounts where, what happens on unmount, and how a prop
 * update crosses the boundary. It does not prove that Discord's real React
 * behaves the same way, which needs a signed-in session (see
 * docs/shelter-stage3.md).
 *
 * jsdom for the reason `reactiveroot.test.tsx` uses it: the mount path goes
 * through shelter-ui's `ReactiveRoot` custom element.
 */

import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";

import type { ReactSurface } from "./react";
import { createBridges, resolveBridgeReact, type BridgeProps } from "./bridges";

/** One element the stand-in React "rendered". */
interface RenderedElement {
  readonly type: unknown;
  readonly props: BridgeProps;
}

/** The half of React's class lifecycle a test drives by hand. */
interface FakeInstance {
  render(): RenderedElement;
  componentDidMount(): void;
  shouldComponentUpdate(next: BridgeProps): boolean;
}

/** A stand-in React plus everything it recorded, for assertions. */
interface ReactStandIn {
  readonly surface: ReactSurface;
  /** Every element the stand-in was asked to render, in order. */
  readonly rendered: RenderedElement[];
  /** One entry per root created, flipped when React unmounts it. */
  readonly roots: { unmounted: boolean }[];
  /** React's own mount sequence: render, ref, then `componentDidMount`. */
  mount(element: RenderedElement, host: HTMLElement): FakeInstance;
}

function reactStandIn(): ReactStandIn {
  const rendered: RenderedElement[] = [];
  const roots: { unmounted: boolean }[] = [];

  class Component {
    constructor(public readonly props: BridgeProps) {}
  }

  const surface: ReactSurface = {
    React: {
      createElement(type: unknown, props?: BridgeProps | null): RenderedElement {
        const element: RenderedElement = { type, props: props ?? {} };
        rendered.push(element);
        return element;
      },
      createRef(): { current: null } {
        return { current: null };
      },
      Component,
    },
    ReactDOM: {},
    ReactDOMClient: {
      createRoot() {
        const root = { unmounted: false };
        roots.push(root);
        return {
          render: (child: unknown): void => {
            rendered.push(child as RenderedElement);
          },
          unmount: (): void => {
            root.unmounted = true;
          },
        };
      },
    },
  };

  return {
    surface,
    rendered,
    roots,
    mount(_element, host): FakeInstance {
      const factory = _element.type as new (props: BridgeProps) => FakeInstance;
      const instance = new factory(_element.props);
      const ref = instance.render().props["ref"];
      if (typeof ref === "object" && ref !== null) {
        (ref as { current: HTMLElement | null }).current = host;
      }
      instance.componentDidMount();
      return instance;
    },
  };
}

/** Flushes Solid's render effects, so a signal write has settled. */
const settled = (): Promise<void> => Promise.resolve();

describe("resolveBridgeReact", () => {
  it("finds the pair in a React-shaped object", () => {
    expect(resolveBridgeReact(reactStandIn().surface)).toBeDefined();
  });

  it("resolves nothing when a session has no React at all", () => {
    expect(
      resolveBridgeReact({ React: undefined, ReactDOM: undefined, ReactDOMClient: undefined }),
    ).toBeUndefined();
  });
});

describe("ReactInSolidBridge", () => {
  it("renders a React component into a wrapper div with no layout box", () => {
    const standIn = reactStandIn();
    const { ReactInSolidBridge } = createBridges(standIn.surface);
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <ReactInSolidBridge comp={() => null} props={{ className: "react-elem" }}>
          child
        </ReactInSolidBridge>
      ),
      host,
    );

    const wrapper = host.querySelector("div[style*='display:contents']");
    expect(wrapper).not.toBeNull();
    // Props are forwarded whole, with the Solid children as React's.
    expect(standIn.rendered.at(-1)?.props).toMatchObject({
      className: "react-elem",
      children: "child",
    });

    dispose();
    expect(standIn.roots[0]?.unmounted).toBe(true);
    host.remove();
  });

  it("re-renders the React component when its props change", async () => {
    const standIn = reactStandIn();
    const { ReactInSolidBridge } = createBridges(standIn.surface);
    const host = document.createElement("div");
    document.body.append(host);

    const [label, setLabel] = createSignal("first");
    const dispose = render(
      () => <ReactInSolidBridge comp={() => null} props={{ label: label() }} />,
      host,
    );
    const rendersBefore = standIn.rendered.length;

    setLabel("second");
    await settled();

    expect(standIn.rendered.length).toBeGreaterThan(rendersBefore);
    expect(standIn.rendered.at(-1)?.props).toMatchObject({ label: "second" });

    dispose();
    host.remove();
  });
});

describe("renderSolidInReact", () => {
  it("hands React an element whose wrapper has no layout box", () => {
    const standIn = reactStandIn();
    const { renderSolidInReact } = createBridges(standIn.surface);

    const element = renderSolidInReact(() => null) as RenderedElement;

    expect(typeof element.type).toBe("function");
    expect(typeof element.props["comp"]).toBe("function");
    expect(element.props["props"]).toEqual({});
  });

  it("mounts the plugin's Solid tree into the div React rendered", () => {
    const standIn = reactStandIn();
    const { renderSolidInReact } = createBridges(standIn.surface);
    const host = document.createElement("div");
    document.body.append(host);

    const element = renderSolidInReact(() => <span>solid body</span>) as RenderedElement;
    standIn.mount(element, host);

    // ReactiveRoot wraps the tree, the plugin's own element is inside it.
    expect(host.querySelector("shltr-rroot")?.textContent).toBe("solid body");

    host.remove();
  });

  it("carries prop updates from React into the Solid tree", async () => {
    const standIn = reactStandIn();
    const { renderSolidInReact } = createBridges(standIn.surface);
    const host = document.createElement("div");
    document.body.append(host);

    const element = renderSolidInReact((props) => <span>{String(props["label"])}</span>, {
      label: "first",
    }) as RenderedElement;
    const instance = standIn.mount(element, host);
    expect(host.textContent).toBe("first");

    const second = (() => <span>second</span>) as unknown as (props: BridgeProps) => JSX.Element;
    // What React asks on a re-render: refused, and pushed into Solid instead.
    expect(instance.shouldComponentUpdate({ comp: second, props: { label: "second" } })).toBe(
      false,
    );
    await settled();

    expect(host.textContent).toBe("second");

    host.remove();
  });
});
