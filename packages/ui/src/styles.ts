/**
 * Shadow-root stylesheet for the settings panel.
 *
 * Every metric here mirrors Discord's own settings UI, measured from the live
 * client (computed styles + stylesheet ground truth, 2026 visual refresh):
 * the 696px content column, flat sections on the modal's own background, the
 * 48x24 blurple switch, and the fixed-position select menu.
 *
 * Hard rules (enforced by panel.test.ts): colors come from Discord's design
 * tokens — every hex is a var() fallback — except a small allowlist of
 * literals Discord itself hardcodes inline (the switch's off-track, the menu
 * shadow). Old-era tokens (--background-primary, --header-primary,
 * --interactive-*) no longer exist in Discord and must not be used.
 *
 * Document-level styles do not pierce the shadow root, so this file carries
 * the complete look; the host itself paints nothing, blending with whatever
 * background the modal and theme provide.
 */
export const PANEL_CSS = `
:host {
  display: block;
  box-sizing: border-box;
  /* Discord's settings column: 696px of content plus 16px of padding per side. */
  max-width: 728px;
  margin: 64px auto;
  padding: 0 16px;
  color: var(--text-default, #d4d5d8);
  font-family: var(--font-primary, "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif);
  font-size: 16px;
  line-height: 20px;
}
:host ::selection {
  background: var(--brand-500, #5865f2);
  color: var(--white-500, #ffffff);
}
* {
  box-sizing: border-box;
}

/* Page and section headings: Discord's heading-xl — 24px, normal weight. */
.ion-heading,
.ion-section-title {
  margin: 0 0 20px;
  font-size: 24px;
  font-weight: var(--font-weight-normal, 400);
  line-height: 30px;
  color: var(--text-strong, #dcdcdf);
}
.ion-heading {
  padding-top: 10px;
}

/* Sections are flat, matching Discord: no card background, no borders; the
   padding + negative margins reproduce Discord's section container box. */
.ion-section {
  margin: 0 -16px;
  padding: 10px 16px;
}
.ion-divider {
  margin: 40px 0;
  border: none;
  border-top: 1px solid var(--border-subtle, rgba(151, 151, 159, 0.2));
}

/* Rows: label stack on the left, control right-aligned, 20px apart. */
.ion-row {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  padding: 16px 0;
}
.ion-row + .ion-row {
  border-top: 1px solid var(--border-subtle, rgba(151, 151, 159, 0.2));
}
.ion-row-main {
  flex: 1;
  min-width: 0;
}
.ion-row-label {
  font-size: 16px;
  font-weight: var(--font-weight-medium, 500);
  line-height: 20px;
  color: var(--text-strong, #dcdcdf);
}
.ion-row-desc {
  margin-top: 4px;
  font-size: 16px;
  font-weight: var(--font-weight-normal, 400);
  line-height: 20px;
  color: var(--text-default, #d4d5d8);
}
.ion-row-error {
  margin-top: 4px;
  font-size: 14px;
  line-height: 18px;
  color: var(--text-feedback-critical, #fa777c);
}
.ion-empty {
  padding: 16px 0;
  font-size: 16px;
  color: var(--text-subtle, #96979e);
}
.ion-state {
  font-weight: var(--font-weight-medium, 500);
}
.ion-state-started { color: var(--status-positive, #3d9e60); }
.ion-state-failed { color: var(--text-feedback-critical, #fa777c); }
.ion-state-stopped,
.ion-state-starting,
.ion-state-stopping { color: var(--text-subtle, #96979e); }
.ion-restart {
  color: var(--text-subtle, #96979e);
}

/* Switch: Discord's 48x24 pill — blurple when on, translucent black when off,
   with a 16px white thumb sliding between 4px and 27px. The off-track and its
   hover border are literals because Discord hardcodes them inline. */
.ion-switch {
  position: relative;
  flex: none;
  width: 48px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border-subtle, rgba(151, 151, 159, 0.2));
  border-radius: var(--radius-lg, 16px);
  background: rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}
.ion-switch:hover:not(:disabled) {
  border-color: rgba(151, 151, 159, 0.4);
}
.ion-switch[aria-checked="true"] {
  background: var(--brand-500, #5865f2);
}
.ion-switch[aria-checked="true"]:hover:not(:disabled) {
  background: color-mix(in srgb, var(--brand-500, #5865f2) 80%, rgb(0 0 0));
}
.ion-switch:disabled {
  cursor: default;
  opacity: 0.6;
}
.ion-switch:focus-visible {
  outline: 2px solid var(--border-focus, #6aa8f4);
  outline-offset: 2px;
}
.ion-switch-thumb {
  position: absolute;
  top: 3px;
  left: 4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--white-500, #ffffff);
  transition: left 0.2s ease;
}
.ion-switch[aria-checked="true"] .ion-switch-thumb {
  left: 27px;
}

/* Select: borderless 38px trigger (value + chevron) opening a fixed-position
   menu anchored to the trigger — fixed positioning is what keeps it from
   being clipped by the settings scroller, exactly like Discord's dropdowns. */
.ion-select-wrap {
  position: relative;
  flex: none;
}
.ion-select {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 4px 0 8px;
  border: none;
  border-radius: var(--radius-sm, 8px);
  background: transparent;
  color: var(--text-default, #d4d5d8);
  font: inherit;
  font-size: 16px;
  line-height: 20px;
  cursor: pointer;
}
.ion-select:hover {
  background: var(--background-mod-muted, rgba(151, 151, 159, 0.08));
}
.ion-select:focus-visible {
  outline: 2px solid var(--border-focus, #6aa8f4);
  outline-offset: -2px;
}
.ion-select-label {
  flex: 1;
  text-align: left;
  white-space: nowrap;
}
.ion-select-chevron {
  flex: none;
  display: flex;
  color: var(--text-subtle, #96979e);
}
.ion-select-menu {
  position: fixed;
  z-index: 1000;
  min-width: 200px;
  max-width: 300px;
  max-height: 240px;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--border-subtle, rgba(151, 151, 159, 0.2));
  border-radius: var(--radius-sm, 8px);
  background: var(--background-surface-higher, #121214);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
}
.ion-select-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 40px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-xs, 4px);
  background: transparent;
  color: var(--text-default, #d4d5d8);
  font: inherit;
  font-size: 16px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.05s ease-in;
}
.ion-select-option:hover,
.ion-select-option:focus-visible {
  background: var(--background-mod-normal, rgba(151, 151, 159, 0.2));
  outline: none;
}
.ion-select-option[aria-selected="true"] {
  background: var(--background-mod-normal, rgba(151, 151, 159, 0.2));
  color: var(--text-strong, #dcdcdf);
}

.ion-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--text-link, #2781e7);
  font: inherit;
  font-size: 16px;
  cursor: pointer;
}
.ion-link:hover {
  text-decoration: underline;
}
.ion-link:focus-visible {
  outline: 2px solid var(--border-focus, #6aa8f4);
  outline-offset: 2px;
}

/* Catalog: search input, entry list, and install button. */
.ion-catalog-search {
  margin-bottom: 12px;
}
.ion-catalog-input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border-subtle, rgba(151, 151, 159, 0.2));
  border-radius: var(--radius-sm, 8px);
  background: var(--background-mod-muted, rgba(151, 151, 159, 0.08));
  color: var(--text-default, #d4d5d8);
  font: inherit;
  font-size: 16px;
  line-height: 20px;
  outline: none;
  transition: border-color 0.15s ease;
}
.ion-catalog-input::placeholder {
  color: var(--text-subtle, #96979e);
}
.ion-catalog-input:focus {
  border-color: var(--border-focus, #6aa8f4);
}
.ion-catalog-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-subtle, rgba(151, 151, 159, 0.12));
}
.ion-catalog-item:last-of-type {
  border-bottom: none;
}
.ion-catalog-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ion-catalog-name {
  font-size: 16px;
  font-weight: var(--font-weight-medium, 500);
  line-height: 20px;
  color: var(--text-strong, #dcdcdf);
}
.ion-catalog-meta {
  font-size: 14px;
  line-height: 18px;
  color: var(--text-subtle, #96979e);
}
.ion-catalog-desc {
  font-size: 14px;
  line-height: 18px;
  color: var(--text-default, #d4d5d8);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ion-catalog-install {
  flex: none;
  height: 32px;
  padding: 0 16px;
  border: none;
  border-radius: var(--radius-sm, 8px);
  background: var(--brand-500, #5865f2);
  color: var(--white-500, #ffffff);
  font: inherit;
  font-size: 14px;
  font-weight: var(--font-weight-medium, 500);
  line-height: 18px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.ion-catalog-install:hover:not(:disabled) {
  background: color-mix(in srgb, var(--brand-500, #5865f2) 80%, rgb(0 0 0));
}
.ion-catalog-install:disabled {
  opacity: 0.5;
  cursor: default;
}
.ion-catalog-install:focus-visible {
  outline: 2px solid var(--border-focus, #6aa8f4);
  outline-offset: 2px;
}
.ion-catalog-note {
  margin-top: 12px;
  font-size: 14px;
  line-height: 18px;
  color: var(--text-subtle, #96979e);
}
`;
