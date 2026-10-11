/**
 * Shadow-root stylesheet for the settings panel.
 *
 * Hard rules (enforced by styles.test.ts): every color comes from a Discord
 * CSS variable — never a literal — so Ion's panel follows the user's theme,
 * including themes that override Discord's variables. Document-level styles
 * do not pierce the shadow root, so this file carries the complete look.
 */
export const PANEL_CSS = `
:host {
  display: block;
  height: 100%;
  overflow-y: auto;
  background: var(--background-primary, #313338);
  font-family: var(--font-primary, Arial, sans-serif);
  color: var(--text-normal, #dbdee1);
  scrollbar-width: thin;
  scrollbar-color: var(--background-modifier-accent, #4e5058) transparent;
}
:host ::selection {
  background: var(--brand-500, #5865f2);
  color: var(--white-500, #ffffff);
}
* {
  box-sizing: border-box;
}
.ion-page {
  max-width: 740px;
  margin: 0 auto;
  padding: 60px 40px 80px;
}
.ion-title {
  margin: 0 0 20px;
  font-size: 20px;
  font-weight: 600;
  line-height: 24px;
  color: var(--header-primary, #f2f3f5);
}
.ion-card {
  background: var(--background-secondary, #2b2d31);
  border-radius: 8px;
  margin-bottom: 24px;
  overflow: hidden;
}
.ion-card-title {
  margin: 0;
  padding: 16px 20px 12px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--header-secondary, #b5bac1);
}
.ion-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  border-top: 1px solid var(--background-modifier-accent, #3f4147);
}
.ion-row-main {
  flex: 1;
  min-width: 0;
}
.ion-row-label {
  font-size: 16px;
  font-weight: 500;
  line-height: 20px;
  color: var(--header-primary, #f2f3f5);
}
.ion-row-desc {
  margin-top: 4px;
  font-size: 14px;
  line-height: 18px;
  color: var(--header-secondary, #b5bac1);
}
.ion-row-error {
  margin-top: 4px;
  font-size: 13px;
  line-height: 17px;
  color: var(--status-danger, #f23f43);
}
.ion-restart {
  margin-left: 8px;
  color: var(--text-muted, #949ba4);
  font-size: 12px;
}
.ion-state {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.ion-state-started { color: var(--status-positive, #23a559); }
.ion-state-failed { color: var(--status-danger, #f23f43); }
.ion-state-stopped { color: var(--text-muted, #949ba4); }
.ion-state-starting,
.ion-state-stopping { color: var(--text-muted, #949ba4); }

/* Toggle switch — Discord's pill proportions and interaction colors. */
.ion-switch {
  flex: none;
  position: relative;
  width: 40px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 12px;
  background: var(--interactive-muted, #80848e);
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.ion-switch:hover:not(:disabled) {
  background: var(--interactive-normal, #b5bac1);
}
.ion-switch[aria-checked="true"] {
  background: var(--interactive-active, #f2f3f5);
}
.ion-switch[aria-checked="true"]:hover:not(:disabled) {
  background: var(--interactive-active, #f2f3f5);
}
.ion-switch:disabled {
  cursor: default;
  opacity: 0.6;
}
.ion-switch:focus-visible {
  outline: 2px solid var(--focus, #00a8fc);
  outline-offset: 2px;
}
.ion-switch-knob {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--white-500, #ffffff);
  transition: transform 0.15s ease;
}
.ion-switch[aria-checked="true"] .ion-switch-knob {
  transform: translateX(16px);
}

/* Select — button + popover list, styled from theme variables. */
.ion-select-wrap {
  position: relative;
  flex: none;
}
.ion-select {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 180px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--background-modifier-accent, #3f4147);
  border-radius: 4px;
  background: var(--background-tertiary, #1e1f22);
  color: var(--text-normal, #dbdee1);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.ion-select:hover {
  border-color: var(--interactive-normal, #b5bac1);
}
.ion-select:focus-visible {
  outline: 2px solid var(--focus, #00a8fc);
  outline-offset: 1px;
}
.ion-select-label {
  flex: 1;
  text-align: left;
}
.ion-select-chevron {
  flex: none;
  color: var(--text-muted, #949ba4);
}
.ion-select-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 2;
  min-width: 100%;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--background-modifier-accent, #3f4147);
  border-radius: 4px;
  background: var(--background-secondary, #2b2d31);
  box-shadow: 0 8px 16px var(--shadow-high);
}
.ion-select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-normal, #dbdee1);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.ion-select-option:hover {
  background: var(--background-modifier-hover, transparent);
}
.ion-select-option:focus-visible {
  outline: 2px solid var(--focus, #00a8fc);
  outline-offset: -2px;
}
.ion-select-option[aria-selected="true"] {
  color: var(--brand-500, #5865f2);
}
.ion-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--text-link, #00a8fc);
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}
.ion-link:hover {
  text-decoration: underline;
}
.ion-link:focus-visible {
  outline: 2px solid var(--focus, #00a8fc);
  outline-offset: 2px;
}
.ion-empty {
  padding: 16px 20px;
  font-size: 14px;
  color: var(--header-secondary, #b5bac1);
  border-top: 1px solid var(--background-modifier-accent, #3f4147);
}
`;
