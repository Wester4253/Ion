/**
 * Upstream's two React↔Solid bridges, running on Ion's host.
 *
 * A strict-types port of uwu/shelter's `src/bridges.tsx` (CC0-1.0 — see
 * THIRD_PARTY.md), with the two signatures shelter's own UI docs promise
 * (shelter.uwu.network/ui):
 *
 * - `<ReactInSolidBridge comp={DiscordComponent} props={…} />` renders a
 *   React component inside a Solid tree, in a `display: contents` div, and
 *   re-renders it from an effect so prop updates cross the boundary.
 * - `renderSolidInReact(MySolidComponent, props)` hands React an element it
 *   renders once and never updates: the wrapper's `shouldComponentUpdate`
 *   returns `false` and pushes new props into a Solid signal instead, because
 *   React re-rendering our subtree would fight the Solid renderer over the
 *   same DOM nodes.
 *
 * Both need *Discord's* React instances, and deliberately so: a Discord
 * component rendered inside a Shelter settings section then shares
 * Discord's tree — portals, context and patches compose instead of forking a
 * second React. `resolveBridgeReact` is where that instance is narrowed to
 * the handful of calls the bridges make; when discovery misses it, both
 * bridges fail naming themselves, because a plugin that gets `undefined`
 * instead would report "X is not a function", which says nothing.
 *
 * (uwu/shelter is CC0-1.0; see THIRD_PARTY.md.)
 */

import type { Component } from "solid-js";
import { createEffect, createRoot, createSignal, onCleanup } from "solid-js";
import { ReactiveRoot } from "@uwu/shelter-ui";

import type { ReactSurface } from "./react";

/** Open prop objects, the shape both sides of the boundary pass around. */
export type BridgeProps = Record<string, unknown>;

/** The ref object React fills in when it mounts the element it was given. */
export interface BridgeRef<T> {
  current: T | null;
}

/** The React API the Solid→React bridge calls. */
export interface BridgeReact {
  createElement(
    type: unknown,
    props?: BridgeProps | null,
    ...children: readonly unknown[]
  ): unknown;
  createRef<T>(): BridgeRef<T>;
  /** Discord's component base class; the bridge subclasses it. */
  readonly Component: BridgeComponentClass;
}

/** The instance surface a class-component bridge relies on. */
export interface BridgeComponentInstance {
  readonly props: BridgeProps;
  render(): unknown;
  componentDidMount?(): void;
  componentWillUnmount?(): void;
  shouldComponentUpdate?(nextProps: BridgeProps): boolean;
}

/** A class-component constructor: `React.Component`, as subclassed here. */
export interface BridgeComponentClass {
  new (props: BridgeProps): BridgeComponentInstance;
  readonly prototype: BridgeComponentInstance;
}

/** The React root API the React→Solid bridge mounts into. */
export interface BridgeRootApi {
  createRoot(element: Element): BridgeRoot;
}

/** A mounted React root: render again, or unmount for good. */
export interface BridgeRoot {
  render(element: unknown): void;
  unmount(): void;
}

/** Discord's React pair, resolved to the calls the bridges make. */
export interface BridgeReactPair {
  readonly react: BridgeReact;
  readonly client: BridgeRootApi;
}

/** A Solid component in the shape plugins hand their sections over. */
export type SolidComponent = (props: BridgeProps) => unknown;

/** The props upstream's `ReactInSolidBridge` takes. */
export interface ReactInSolidBridgeProps {
  readonly comp: (props: BridgeProps) => unknown;
  readonly props?: BridgeProps | undefined;
  readonly children?: unknown;
}

/** Upstream's `shelter.ui` bridges, as this adapter implements them. */
export interface ShelterBridges {
  readonly ReactInSolidBridge: Component<ReactInSolidBridgeProps>;
  readonly renderSolidInReact: (component: SolidComponent, props?: BridgeProps) => unknown;
}

/** Narrows one of the three React objects to the calls the bridges make. */
function narrow<T extends object>(
  value: object | undefined,
  members: readonly (keyof T)[],
): T | undefined {
  if (value === undefined) return undefined;
  const candidate = value as Partial<T>;
  if (!members.every((member) => typeof candidate[member] === "function")) return undefined;
  return candidate as T;
}

/**
 * Discord's React, or undefined when discovery did not find it. Both halves
 * are required: one bridge renders into Discord's tree, the other mounts a
 * Discord component into ours, so half a pair is not usable.
 */
export function resolveBridgeReact(surface: ReactSurface): BridgeReactPair | undefined {
  const react = narrow<BridgeReact>(surface.React, ["createElement", "createRef", "Component"]);
  const client = narrow<BridgeRootApi>(surface.ReactDOMClient, ["createRoot"]);
  if (react === undefined || client === undefined) return undefined;
  return { react, client };
}

/** A bridge that names itself in its own error, however it is used. */
function unavailable(member: string): never {
  throw new Error(
    `shelter.ui.${member} needs Discord's React instance, which this session's module ` +
      `discovery could not resolve; see docs/shelter-stage3.md`,
  );
}

/**
 * Builds the two bridges against `surface`. When Discord's React is not in
 * it, both are functions that fail naming themselves, so a plugin that
 * reaches for one learns why rather than seeing a TypeError.
 */
export function createBridges(surface: ReactSurface): ShelterBridges {
  const pair = resolveBridgeReact(surface);
  if (pair === undefined) {
    // One implementation for both: the only difference is the name in the
    // error. A `never` return satisfies any signature the caller expects.
    const missing = (member: string) => (): never => unavailable(member);
    return {
      ReactInSolidBridge: missing("ReactInSolidBridge"),
      renderSolidInReact: missing("renderSolidInReact"),
    };
  }

  const { react, client } = pair;

  const ReactInSolidBridge: Component<ReactInSolidBridgeProps> = (props) => {
    const rootDiv = (<div style="display:contents" />) as HTMLDivElement;
    const clientRoot = client.createRoot(rootDiv);

    // Re-render on every prop change: React unmounts and remounts its
    // subtree each time, which is the only way its reconciler accepts new
    // props for a tree it did not own when it rendered last.
    createEffect(() => {
      const forwarded: BridgeProps = { ...(props.props ?? {}), children: props.children };
      clientRoot.render(react.createElement(props.comp, forwarded));
    });

    onCleanup(() => {
      clientRoot.unmount();
    });

    return rootDiv;
  };

  function renderSolidInReact(component: SolidComponent, props?: BridgeProps): unknown {
    // Declared inside the function, as upstream does: the class has to be
    // built against the React instance resolved for this session, and React
    // class components are the only place `shouldComponentUpdate` can stop
    // React from re-rendering a subtree Solid owns.
    class SolidInReactBridge extends react.Component {
      readonly divRef = react.createRef<HTMLDivElement>();
      readonly propsRef = react.createRef<{
        read: () => readonly [SolidComponent, BridgeProps];
        write: (value: readonly [SolidComponent, BridgeProps]) => void;
      }>();
      /** Disposes the Solid root the plugin's tree was rendered into. */
      private disposeTree: (() => void) | undefined;

      constructor(componentProps: BridgeProps) {
        super(componentProps);
        const [value, setValue] = createSignal<readonly [SolidComponent, BridgeProps]>([
          component,
          props ?? {},
        ]);
        this.propsRef.current = { read: value, write: setValue };
      }

      override render(): unknown {
        // `display: contents` so the wrapper adds no layout box of its own.
        return react.createElement("div", { ref: this.divRef, style: { display: "contents" } });
      }

      override componentDidMount(): void {
        const host = this.divRef.current;
        const propsRef = this.propsRef.current;
        if (host === null || propsRef === null) return;
        host.replaceChildren();

        // Read the signal *inside* the render expression, as upstream does:
        // Solid turns this expression into a memo, so a later write re-runs
        // it and swaps the plugin's tree for the new one. Reading it here
        // instead would freeze the props the component was built with.
        const render = (): unknown => {
          const [component, componentProps] = propsRef.read();
          return component(componentProps);
        };

        // A Solid root of our own, disposed with the component: the section
        // mounts on every settings visit, and a memo owned by nobody would
        // live until the page does. `createRoot` hands its callback the
        // dispose function and returns whatever the callback returns, so the
        // callback returns it — assigning the call's own result would store
        // `undefined` and never tear the tree down.
        this.disposeTree = createRoot((dispose) => {
          // ReactiveRoot owns the tree's own reactive root, so a plugin's
          // `onCleanup` and memoised reads behave as they do in shelter.
          const element = <ReactiveRoot>{render()}</ReactiveRoot>;
          host.append(element as Node);
          return dispose;
        });
      }

      override componentWillUnmount(): void {
        this.disposeTree?.();
        this.disposeTree = undefined;
      }

      override shouldComponentUpdate(nextProps: BridgeProps): boolean {
        // Never let React re-render: it would reconcile a tree Solid owns.
        // Write the new props into the signal instead, which is how updates
        // from the React side still reach the Solid child.
        this.propsRef.current?.write([
          nextProps["comp"] as SolidComponent,
          nextProps["props"] as BridgeProps,
        ]);
        return false;
      }
    }

    return react.createElement(SolidInReactBridge, { comp: component, props: props ?? {} });
  }

  return { ReactInSolidBridge, renderSolidInReact };
}
