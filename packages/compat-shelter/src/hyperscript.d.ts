/**
 * The one type `solid-js/h`'s declaration needs, declared here.
 *
 * `solid-js/h`'s `types/index.d.ts` reads:
 *
 * ```ts
 * declare const _default: import("hyper-dom-expressions").HyperScript;
 * ```
 *
 * solid-js does not depend on `hyper-dom-expressions` — its `h` build imports
 * only `solid-js/web` at runtime — so that reference cannot resolve. With
 * `skipLibCheck` on, TypeScript stays quiet and the import arrives as an error
 * type, which is how a package can type-check clean and still hand you `any`
 * in disguise. Declaring the missing module restores a real signature for
 * `shelter.solidH.h` instead.
 *
 * The signature is hyper-dom-expressions' public shape: build a DOM node from
 * a tag (or a component), its props, and its children.
 */

declare module "hyper-dom-expressions" {
  export type HyperScript = (
    type: string | ((props?: Record<string, unknown>) => unknown),
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ) => unknown;
}
