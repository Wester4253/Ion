/**
 * BetterDiscord's component stylesheet, vendored verbatim from upstream
 * `styles/` (Apache-2.0, commit 133bc83 — see THIRD_PARTY.md): every
 * `bd-*` class the ported `BdApi.Components` render. Injected once, on
 * first Components access, exactly like BD injects its own core CSS.
 *
 * Only the files the ported components use are included; BD's own
 * application chrome (addon list, store, modals) is not part of the
 * Components surface.
 */

/** BD's component CSS (upstream `styles/`, Apache-2.0). */
export const COMPONENT_CSS = `
/* ===== upstream styles/text.css ===== */
.bd-text-normal {
  color: var(--text-default);
}

.bd-text-muted {
  color: var(--text-muted);
}

.bd-text-error {
  color: var(--red-400);
}

.bd-text-brand {
  color: var(--text-brand);
}

.bd-text-link {
  color: var(--text-link);
}

.bd-header-primary {
  color: var(--text-strong);
}

.bd-header-secondary {
  color: var(--text-default);
}

.bd-text-yellow {
  color: var(--text-feedback-warning);
}

.bd-text-green {
  color: var(--text-feedback-positive);
}

.bd-text-red {
  color: var(--status-danger);
}

.bd-text-white {
  color: var(--white-500);
}

.bd-text-10 {
  font-size: 10px;
  line-height: 12px;
}

.bd-text-12 {
  font-size: 12px;
  line-height: 16px;
}

.bd-text-14 {
  font-size: 14px;
  line-height: 18px;
}

.bd-text-16 {
  font-size: 16px;
  line-height: 20px;
}

.bd-text-20 {
  font-size: 20px;
  line-height: 24px;
}

.bd-text-24 {
  font-size: 24px;
  line-height: 30px;
}

.bd-text-32 {
  font-size: 32px;
  line-height: 40px;
}

.bd-text-strong {
  font-weight: 600;
}

.bd-selectable {
  user-select: text;
}

/* ===== upstream styles/buttons.css ===== */
/* .bd-button {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    background-color: var(--bd-brand);
    color: #FFFFFF;
    border-radius: 3px;
    padding: 4px 8px;
    transition: background-color 0.17s ease, color 0.17s ease, opacity 250ms ease;
}

.bd-button:hover {
    background-color: var(--bd-brand-hover);
}

.bd-button:active {
    background-color: var(--bd-brand-active);
}

.bd-button.bd-button-success {
    background-color: #43B581;
}

.bd-button.bd-button-success:hover {
    background-color: #3CA374;
}

.bd-button.bd-button-success:active {
    background-color: #369167;
}

.bd-button.bd-button-warning {
    background-color: #FAA61A;
}

.bd-button.bd-button-warning:hover {
    background-color: #E19517;
}

.bd-button.bd-button-warning:active {
    background-color: #C88515;
}

.bd-button.bd-button-danger {
    background-color: #F04747;
}

.bd-button.bd-button-danger:hover {
    background-color: #D84040;
}

.bd-button.bd-button-danger:active {
    background-color: #C03939;
}

.bd-button-disabled {
    opacity: 0.4;
}

.bd-button-disabled:hover {
    cursor: not-allowed;
} */

/* Generic Button Styles */
.bd-button {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    box-sizing: border-box;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-weight: 500;
    line-height: 16px;
    padding: 2px 16px;
    user-select: none;
}

.bd-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.bd-button .bd-button-content {
    --button--underline-color: transparent;
    background-image: linear-gradient(0deg, transparent, transparent 1px, var(--button--underline-color) 0, var(--button--underline-color) 2px, transparent 0);
    display: flex;
    justify-content: center;
    align-items: center;
}

.bd-button:disabled .bd-button-content {
    background-image: none !important;
}

.bd-button-outlined:disabled {
    background-color: transparent !important;
}



/* Button Sizes */
.bd-button-tiny {
    width: 52px;
    height: 24px;
    min-width: 52px;
    min-height: 24px;
}

.bd-button-small {
    width: 60px;
    height: 32px;
    min-width: 60px;
    min-height: 32px;
}

.bd-button-medium {
    width: 96px;
    height: 38px;
    min-width: 96px;
    min-height: 38px;
}

.bd-button-large {
    width: 130px;
    height: 44px;
    min-width: 130px;
    min-height: 44px;
}

.bd-button-xlarge {
    width: 148px;
    height: 50px;
    min-width: 148px;
    min-height: 50px;
    font-size: 16px;
    line-height: normal;
    padding: 2px 20px;
}

.bd-button-icon {
    height: auto;
    padding: 4px;
}

.bd-button-grow,
.bd-button-icon {
    width: auto
}



/* Button Looks */
.bd-button-filled {
    -webkit-transition: background-color .17s ease, color .17s ease;
    transition: background-color .17s ease, color .17s ease
}

.bd-button-outlined {
    -webkit-transition: color .17s ease, background-color .17s ease, border-color .17s ease;
    transition: color .17s ease, background-color .17s ease, border-color .17s ease;
    border-width: 1px;
    border-style: solid
}

.bd-button-blank {
    background: transparent;
    color: currentColor;
    border: 0;
    /* padding: 0; */
    margin: 0
}

.bd-button-filled .bd-button-content,
.bd-button-link .bd-button-content,
.bd-button-outlined .bd-button-content {
    margin: 0 auto;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
}


/* COLORS */

/* Color BD Brand */
.bd-button-filled.bd-button-color-brand {
    color: var(--white-500);
    background-color: var(--bd-brand); /* BD Blue */
}

.bd-button-filled.bd-button-color-brand:hover {
    background-color: var(--bd-brand-hover);
}

.bd-button-filled.bd-button-color-brand:active {
    background-color: var(--bd-brand-active);
}

.bd-button-filled.bd-button-color-brand:disabled {
    background-color: var(--bd-brand); /* BD Blue */
    opacity: 0.4;
}

.bd-button-outlined.bd-button-color-brand {
    color: var(--control-secondary-text-default);
    border-color: var(--control-secondary-border-default);
}

.bd-button-outlined.bd-button-color-brand:hover {
    background-color: var(--button-outline-brand-background-hover);
    border-color: var(--control-secondary-border-hover);
    color: var(--control-secondary-text-hover);
}

.bd-button-outlined.bd-button-color-brand:active {
    background-color: var(--control-secondary-background-active);
    border-color: var(--button-outline-brand-border-active);
    color: var(--control-secondary-text-active);
}

.bd-button-link.bd-button-color-brand {
    color: var(--bd-brand); /* BD Blue */
}

.bd-button-link.bd-button-color-brand:hover .bd-button-content {
    --button--underline-color: var(--bd-brand); /* BD Blue */
}



/* Color Blurple */
.bd-button-filled.bd-button-color-blurple {
    color: var(--white-500);
    background-color: var(--brand-experiment)
}

.bd-button-filled.bd-button-color-blurple:hover {
    background-color: var(--brand-experiment-560)
}

.bd-button-filled.bd-button-color-blurple:active {
    background-color: var(--brand-experiment-600)
}

.bd-button-filled.bd-button-color-blurple:disabled {
    background-color: var(--brand-experiment)
}

.bd-button-outlined.bd-button-color-blurple {
    color: var(--control-secondary-text-default);
    border-color: var(--control-secondary-border-default)
}

.bd-button-outlined.bd-button-color-blurple:hover {
    background-color: var(--button-outline-brand-background-hover);
    border-color: var(--control-secondary-border-hover);
    color: var(--control-secondary-text-hover)
}

.bd-button-outlined.bd-button-color-blurple:active {
    background-color: var(--control-secondary-background-active);
    border-color: var(--button-outline-brand-border-active);
    color: var(--control-secondary-text-active)
}

.bd-button-link.bd-button-color-blurple {
    color: var(--brand-experiment)
}

.bd-button-link.bd-button-color-blurple:hover .bd-button-content {
    --button--underline-color: var(--brand-experiment)
}



/* Color Yellow/Warn */
.bd-button-filled.bd-button-color-yellow {
    color: var(--white-500);
    background-color: var(--status-warning)
}

.bd-button-filled.bd-button-color-yellow:active,
.bd-button-filled.bd-button-color-yellow:hover {
    background-color: null;
}

.bd-button-filled.bd-button-color-yellow:disabled {
    background-color: var(--status-warning)
}

.bd-button-outlined.bd-button-color-yellow {
    color: var(--status-warning);
    border-color: var(--status-warning)
}

.bd-button-outlined.bd-button-color-yellow:active {
    background-color: hsl(var(--yellow-300-hsl)/.1)
}

.bd-button-link.bd-button-color-yellow {
    color: var(--status-warning)
}

.bd-button-link.bd-button-color-yellow:hover .bd-button-content {
    --button--underline-color: var(--status-warning)
}



/* Color Link */
.bd-button-filled.bd-button-color-link {
    color: var(--white-500);
    background-color: var(--text-link)
}

.bd-button-filled.bd-button-color-link:active,
.bd-button-filled.bd-button-color-link:hover {
    background-color: null
}

.bd-button-filled.bd-button-color-link:disabled {
    background-color: var(--text-link)
}

.bd-button-outlined.bd-button-color-link {
    color: var(--text-link);
    border-color: var(--text-link)
}

.bd-button-outlined.bd-button-color-link:active {
    background-color: hsl(var(--text-link-hsl)/.1)
}

.bd-button-link.bd-button-color-link {
    color: var(--text-link)
}

.bd-button-link.bd-button-color-link:hover .bd-button-content {
    --button--underline-color: var(--text-link)
}



/* Color White */
.bd-button-filled.bd-button-color-white {
    color: var(--primary-500);
    background-color: var(--white-500)
}

.bd-button-filled.bd-button-color-white:active,
.bd-button-filled.bd-button-color-white:hover {
    background-color: null
}

.bd-button-filled.bd-button-color-white:disabled {
    background-color: var(--white-500)
}

.bd-button-outlined.bd-button-color-white {
    color: var(--white-500);
    border-color: var(--white-500)
}

.bd-button-outlined.bd-button-color-white:active {
    background-color: hsl(var(--white-500-hsl)/.1)
}

.bd-button-link.bd-button-color-white {
    color: var(--white-500)
}

.bd-button-link.bd-button-color-white:hover .bd-button-content {
    --button--underline-color: var(--white-500)
}



/* Color Red/Danger/Error */
.bd-button-filled.bd-button-color-red {
    color: var(--white-500);
    background-color: var(--control-critical-primary-background-default)
}

.bd-button-filled.bd-button-color-red:hover {
    background-color: var(--control-critical-primary-background-hover)
}

.bd-button-filled.bd-button-color-red:active {
    background-color: var(--control-critical-primary-background-active)
}

.bd-button-outlined.bd-button-color-red {
    color: var(--control-critical-secondary-text-default);
    border-color: var(--control-critical-secondary-border-default)
}

.bd-button-outlined.bd-button-color-red:hover {
    background-color: var(--control-critical-secondary-border-hover);
    border-color: var(--control-critical-secondary-border-hover);
    color: var(--control-critical-secondary-border-hover)
}

.bd-button-outlined.bd-button-color-red:active {
    background-color: var(--control-critical-secondary-background-active);
    border-color: var(--control-critical-secondary-border-active);
    color: var(--control-critical-secondary-text-active)
}

.bd-button-link.bd-button-color-red {
    color: var(--text-danger)
}

.bd-button-link.bd-button-color-red:hover .bd-button-content {
    --button--underline-color: var(--text-danger)
}


/* Color Green Success */
.bd-button-filled.bd-button-color-green {
    color: var(--white-500);
    background-color: var(--control-connected-background-default)
}

.bd-button-filled.bd-button-color-green:hover {
    background-color: var(--control-connected-background-hover)
}

.bd-button-filled.bd-button-color-green:active {
    background-color: var(--control-connected-background-active)
}

.bd-button-outlined.bd-button-color-green {
    color: var(--control-primary-text-default);
    border-color: var(--control-connected-border-default)
}

.bd-button-outlined.bd-button-color-green:hover {
    background-color: var(--control-connected-background-hover);
    border-color: var(--control-connected-border-hover);
    color: var(--control-primary-text-hover)
}

.bd-button-outlined.bd-button-color-green:active {
    background-color: var(--control-connected-background-active);
    border-color: var(--control-connected-border-active);
    color: var(--control-primary-text-active)
}

.bd-button-link.bd-button-color-green {
    color: var(--green-360)
}

.bd-button-link.bd-button-color-green:hover .bd-button-content {
    --button--underline-color: var(--green-360)
}



/* Color Primary/Grey */
.bd-button-outlined.bd-button-color-primary {
    color: var(--button-outline-primary-text);
    border-color: var(--control-secondary-border-default)
}

.bd-button-outlined.bd-button-color-primary:hover {
    background-color: var(--control-secondary-background-hover);
    border-color: var(--control-secondary-border-hover);
    color: var(--control-secondary-text-hover)
}

.bd-button-outlined.bd-button-color-primary:active {
    background-color: var(--control-secondary-background-active);
    border-color: var(--control-secondary-border-active);
    color: var(--control-secondary-text-active)
}

.bd-button-filled.bd-button-color-primary {
    color: var(--text-default);
    background-color: var(--control-secondary-background-default)
}

.bd-button-filled.bd-button-color-primary:hover {
    background-color: var(--control-secondary-background-hover)
}

.bd-button-filled.bd-button-color-primary:active {
    background-color: var(--control-secondary-background-active)
}

.theme-dark .bd-button-link.bd-button-color-primary {
    color: var(--white-500)
}

.theme-dark .bd-button-link.bd-button-color-primary:hover .bd-button-content {
    --button--underline-color: var(--white-500)
}

.theme-light .bd-button-link.bd-button-color-primary {
    color: var(--primary-400)
}

.theme-light .bd-button-link.bd-button-color-primary:hover .bd-button-content {
    --button--underline-color: var(--primary-400)
}



/* Color Transparent */
.theme-dark .bd-button-filled.bd-button-color-transparent {
    color: var(--primary-100);
    background-color: hsl(var(--white-500-hsl)/.1)
}

.theme-dark .bd-button-filled.bd-button-color-transparent:hover {
    background-color: hsl(var(--white-500-hsl)/.05)
}

.theme-dark .bd-button-filled.bd-button-color-transparent:active {
    background-color: hsl(var(--white-500-hsl)/.01)
}

.theme-dark .bd-button-filled.bd-button-color-transparent:disabled {
    background-color: hsl(var(--white-500-hsl)/.1)
}

.theme-dark .bd-button-outlined.bd-button-color-transparent {
    color: var(--primary-200);
    border-color: var(--primary-200)
}

.theme-dark .bd-button-outlined.bd-button-color-transparent:active {
    background-color: hsl(var(--primary-200-hsl)/.1)
}

.theme-dark .bd-button-link.bd-button-color-transparent {
    color: var(--primary-200)
}

.theme-dark .bd-button-link.bd-button-color-transparent:hover .bd-button-content {
    --button--underline-color: var(--primary-200)
}

.theme-light .bd-button-filled.bd-button-color-transparent {
    color: var(--primary-400);
    background-color: hsl(var(--primary-400-hsl)/.01)
}

.theme-light .bd-button-filled.bd-button-color-transparent:hover {
    background-color: hsl(var(--primary-400-hsl)/.2)
}

.theme-light .bd-button-filled.bd-button-color-transparent:active {
    background-color: hsl(var(--primary-400-hsl)/.25)
}

.theme-light .bd-button-filled.bd-button-color-transparent:disabled {
    background-color: hsl(var(--primary-400-hsl)/.01)
}

.theme-light .bd-button-outlined.bd-button-color-transparent {
    color: var(--primary-400);
    border-color: var(--primary-400)
}

.theme-light .bd-button-outlined.bd-button-color-transparent:active {
    background-color: hsl(var(--primary-400-hsl)/.1)
}

.theme-light .bd-button-link.bd-button-color-transparent {
    color: var(--primary-400)
}

.theme-light .bd-button-link.bd-button-color-transparent:hover .bd-button-content {
    --button--underline-color: var(--primary-400)
}

/* ===== upstream styles/spinner.css ===== */
.bd-spinner {
    display: flex;
    justify-content: center;
    align-items: center;
}

.bd-spinner-inner {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    contain: paint;
}

.bd-spinner-spinning-circle,
.bd-spinner-spinning-circle-simple {
    width: 100%;
}

:where(.bd-spinner-spinning-circle, .bd-spinner-spinning-circle-simple) .bd-spinner-inner {
    transform: rotate(280deg);
}

.bd-spinner-circular {
    animation: bd-spinner-spinning-circle-rotate 2s linear infinite;
    height: 100%;
    width: 100%;
}

.bd-spinner-circular .bd-spinner-path {
    animation: bd-spinner-spinning-circle-dash 2s ease-in-out infinite;
    stroke-dasharray: 1, 200;
    stroke-dashoffset: 0;
    fill: none;
    stroke-width: 6;
    stroke-miterlimit: 10;
    stroke-linecap: round;
    stroke: var(--brand-500);
}

.bd-spinner-circular .bd-spinner-path:nth-last-child(3) {
    animation-delay: 0.23s;
    stroke: var(--text-brand);
}

.bd-spinner-circular .bd-spinner-path:nth-last-child(2) {
    animation-delay: 0.15s;
    stroke: var(--text-brand);
    opacity: 0.6;
}

.bd-spinner-low-motion .bd-spinner-path {
    animation: bd-spinner-low-motion 1.4s infinite ease-in-out;
    width: 6px;
    height: 6px;
    margin-right: 2px;
    background-color: var(--interactive-text-normal);
    border-radius: 3px;
    display: inline-block;
    opacity: 0.3;
}

.bd-spinner-low-motion .bd-spinner-path:nth-child(2) {
    animation-delay: 0.2s;
}

.bd-spinner-low-motion .bd-spinner-path:nth-child(3) {
    animation-delay: 0.4s;
}

.bd-spinner-chasing-dots .bd-spinner-inner {
    animation: bd-spinner-chasing-dots-rotate 2s infinite linear;
}

.bd-spinner-chasing-dots .bd-spinner-path {
    width: 60%;
    height: 60%;
    display: inline-block;
    position: absolute;
    top: 0;
    background-color: var(--brand-500);
    border-radius: 100%;
    animation: bd-spinner-chasing-dots-bounce 2s infinite ease-in-out;
}

.bd-spinner-chasing-dots .bd-spinner-path:last-child {
    top: auto;
    bottom: 0;
    animation-delay: -1s;
}

.bd-spinner-wandering-cubes .bd-spinner-path {
    background-color: var(--brand-400);
    width: 10px;
    height: 10px;
    position: absolute;
    top: 0;
    left: 0;
    animation: bd-spinner-wandering-cubes 1.8s infinite ease-in-out;
}

.bd-spinner-wandering-cubes .bd-spinner-path:last-child {
    animation-delay: 0.9s;
}

.bd-spinner-pulsing-ellipsis .bd-spinner-inner {
    height: auto;
    width: 28px;
    display: flex;
    justify-content: center;
    position: relative;
}

.bd-spinner-pulsing-ellipsis .bd-spinner-path {
    animation: bd-spinner-pulsing-ellipsis 1.4s infinite ease-in-out;
    width: 6px;
    height: 6px;
    margin-right: 2px;
    background-color: var(--primary-100);
    border-radius: 3px;
    display: inline-block;
    opacity: 0.3;
}

.bd-spinner-pulsing-ellipsis .bd-spinner-path:nth-child(2) {
    animation-delay: 0.2s;
}

.bd-spinner-pulsing-ellipsis .bd-spinner-path:nth-child(3) {
    animation-delay: 0.4s;
}

@keyframes bd-spinner-low-motion {
    0% {
        opacity: 1;
    }

    50% {
        opacity: 0.6;
    }

    to {
        opacity: 1;
    }
}

@keyframes bd-spinner-spinning-circle-rotate {
    to {
        transform: rotate(360deg);
    }
}

@keyframes bd-spinner-spinning-circle-dash {
    0% {
        stroke-dasharray: 1, 200;
        stroke-dashoffset: 0;
    }

    50% {
        stroke-dasharray: 130, 200;
    }

    to {
        stroke-dasharray: 130, 200;
        stroke-dashoffset: -124;
    }
}

@keyframes bd-spinner-chasing-dots-rotate {
    to {
        transform: rotate(360deg);
    }
}

@keyframes bd-spinner-chasing-dots-bounce {
    0%,
    to {
        transform: scale(0);
    }

    50% {
        transform: scale(1);
    }
}

@keyframes bd-spinner-wandering-cubes {
    25% {
        transform: translateX(22px) rotate(-90deg) scale(0.5);
    }

    50% {
        transform: translateX(22px) translateY(22px) rotate(-180deg);
    }

    75% {
        transform: translateX(0) translateY(22px) rotate(-270deg) scale(0.5);
    }

    to {
        transform: rotate(-360deg);
    }
}

@keyframes bd-spinner-pulsing-ellipsis {
    0% {
        transform: scale(1);
        opacity: 1;
    }

    50% {
        transform: scale(0.8);
        opacity: 0.3;
    }

    to {
        transform: scale(1);
        opacity: 1;
    }
}
/* ===== upstream styles/search.css ===== */
.bd-search-wrapper {
    padding: 3px;
    border-radius: 3px;
    outline: none;
    border: 0;
    background-color: var(--background-base-lowest);
    color: var(--text-default);
    display: flex;
    align-items: center;
}

.bd-search-disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.bd-search-disabled > * {
    pointer-events: none;
}

.bd-search {
    padding: 2px 3px;
    background: none;
    border: 0;
    color: var(--text-default);
    flex: 1;
}

.bd-search::-webkit-input-placeholder {
    color: var(--text-default);
}

.bd-search-wrapper > svg {
    margin-right: 2px;
    color: var(--interactive-text-default);
}

.bd-search-wrapper > .bd-button {
    margin-right: 2px;
    background: none;
    padding: 0;
}

.bd-search-wrapper > .bd-button > svg .fill {
    fill: var(--interactive-text-default);
}

.bd-search-wrapper > .bd-button:hover > svg .fill {
    fill: var(--interactive-text-hover);
}
/* ===== upstream styles/ui/flex.css ===== */
.bd-flex {
    display: flex;
}

.bd-flex-align-start {
    align-items: flex-start;
}

.bd-flex-align-end {
    align-items: flex-end;
}

.bd-flex-align-center {
    align-items: center;
}

.bd-flex-align-stretch {
    align-items: stretch;
}

.bd-flex-align-baseline {
    align-items: baseline
}

.bd-flex-justify-start {
    justify-content: flex-start;
}

.bd-flex-justify-end {
    justify-content: flex-end;
}

.bd-flex-justify-center {
    justify-content: center;
}

.bd-flex-justify-around {
    justify-content: space-around;
}

.bd-flex-justify-between {
    justify-content: space-between;
}

.bd-flex-no-wrap {
    flex-wrap: nowrap;
}

.bd-flex-wrap {
    flex-wrap: wrap;
}

.bd-flex-wrap-reverse {
    flex-wrap: wrap-reverse;
}

.bd-flex-horizontal {
    flex-direction: row;
}

.bd-flex-reverse {
    flex-direction: row-reverse;
}

.bd-flex-vertical {
    flex-direction: column;
}

.spacer-2upayl {
    flex: 1;
    overflow: hidden;
}

.bd-flex-vertical {}

.bd-flex-horizontal {}

.bd-flex-reverse {}

.bd-flex-horizontal > .spacer-2upayl,
.bd-flex-reverse > .spacer-2upayl,
.bd-flex-vertical > .spacer-2upayl {
    min-height: 1px;
}

.flexCenter-1Mwsxg {}

.bd-flex {}

.bd-flex-horizontal {}

.bd-flex-reverse {}

.bd-flex-horizontal > .bd-flex,
.bd-flex-horizontal > .bd-flex-child {
    margin-left: 10px;
    margin-right: 10px;
}

.bd-flex-horizontal > .bd-flex:first-child,
.bd-flex-horizontal > .bd-flex-child:first-child {
    margin-left: 0;
}

.bd-flex-horizontal > .bd-flex:last-child,
.bd-flex-horizontal > .bd-flex-child:last-child {
    margin-right: 0;
}

.bd-flex-reverse > .bd-flex,
.bd-flex-reverse > .bd-flex-child {
    margin-left: 10px;
    margin-right: 10px;
}

.bd-flex-reverse > .bd-flex:first-child,
.bd-flex-reverse > .bd-flex-child:first-child {
    margin-right: 0;
}

.bd-flex-reverse > .bd-flex:last-child,
.bd-flex-reverse > .bd-flex-child:last-child {
    margin-left: 0;
}
/* ===== upstream styles/ui/switch.css ===== */
/* Switches */

.bd-switch {
    position: relative;
    transition: 250ms cubic-bezier(0, 0.3, 0.7, 1) filter, 250ms cubic-bezier(0, 0.3, 0.7, 1) opacity;
}

.bd-switch-body {
    --switch-color: rgb(114, 118, 125);
    --symbol1path: path('M5.13231 6.72963L6.7233 5.13864L14.855 13.2704L13.264 14.8614L5.13231 6.72963Z');
    --symbol2path: path('M13.2704 5.13864L14.8614 6.72963L6.72963 14.8614L5.13864 13.2704L13.2704 5.13864Z');

    border-radius: 14px;
    width: 40px;
    height: 24px;
    background-color: var(--switch-color);
    transition: 250ms cubic-bezier(0, 0.3, 0.7, 1) background-color;
    position: relative;
}

.bd-switch input:active + .bd-switch-body {
    --switch-color: var(--bd-brand);
}

.bd-switch input:checked + .bd-switch-body {
    --switch-color: var(--bd-brand);
    --symbol1path: path('M7.89561 14.8538L6.30462 13.2629L14.3099 5.25755L15.9009 6.84854L7.89561 14.8538Z');
    --symbol2path: path('M4.08643 11.0903L5.67742 9.49929L9.4485 13.2704L7.85751 14.8614L4.08643 11.0903Z');
}

.full-motion .bd-switch input:active + .bd-switch-body {
    --symbol1path: path('M6.56666 11.0013L6.56666 8.96683L13.5667 8.96683L13.5667 11.0013L6.56666 11.0013Z');
    --symbol2path: path('M13.5582 8.96683L13.5582 11.0013L6.56192 11.0013L6.56192 8.96683L13.5582 8.96683Z');
}

.bd-switch input:checked:active + .bd-switch-body {
    --switch-color: var(--bd-brand);
}

.full-motion .bd-switch input:checked:active + .bd-switch-body {
    --symbol1path: path('M6.56666 11.0013L6.56666 8.96683L13.5667 8.96683L13.5667 11.0013L6.56666 11.0013Z');
    --symbol2path: path('M13.5582 8.96683L13.5582 11.0013L6.56192 11.0013L6.56192 8.96683L13.5582 8.96683Z');
}

.bd-switch .bd-switch-symbol path {
    fill: var(--switch-color);
    transition: 250ms cubic-bezier(0, 0.3, 0.7, 1);
}

.bd-switch .bd-switch-symbol path:first-child {
    d: var(--symbol1path);
}

.bd-switch .bd-switch-symbol path:last-child {
    d: var(--symbol2path);
}

.bd-switch input {
    position: absolute;
    z-index: 1;
    opacity: 0;
    margin: 0;
    width: 100%;
    height: 100%;
    border-radius: 100px;
    cursor: pointer;
}

.bd-switch-body .bd-switch-slider {
    display: block;
    position: absolute;
    left: -3px;
    width: 28px;
    height: 18px;
    margin: 3px;
    transition: 250ms cubic-bezier(0, 0.3, 0.7, 1);
}

.bd-switch input:active + .bd-switch-body .bd-switch-slider {
    left: 1px;
}

.bd-switch input:checked + .bd-switch-body .bd-switch-slider {
    left: 12px;
}

.bd-switch input:active:checked + .bd-switch-body .bd-switch-slider {
    left: 8px;
}

.bd-switch-body .bd-switch-slider .bd-switch-handle {
    transition: 250ms cubic-bezier(0, 0.3, 0.7, 1);
    position: relative;
}

.bd-switch input:active + .bd-switch-body .bd-switch-handle {
    width: 28px;
    height: 18px;
    y: 1;
    x: 0;
}

.bd-switch input:checked:active + .bd-switch-body .bd-switch-handle {
    x: 0;
}

.bd-switch-disabled {
    opacity: 0.5;
    filter: grayscale(1);
}

.bd-switch-disabled input {
    cursor: not-allowed;
}
/* ===== upstream styles/ui/textbox.css ===== */
.bd-text-input {
    min-width: 250px;
    font-size: 16px;
    box-sizing: border-box;
    border-radius: var(--radius-sm);
    color: var(--text-default);
    background-color: var(--input-background-default);
    border: 1px solid var(--input-border-default);
    padding: 10px;
    height: 40px;
}

.bd-text-input:focus-within {
    border-color: var(--bd-brand);
}

.bd-text-input:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

/* ===== upstream styles/ui/checkbox.css ===== */
.bd-checkbox {
    position: relative;
    -webkit-user-select: none;
    -moz-user-select: none;
    user-select: none;
    gap: 8px;
    cursor: pointer;
}

.bd-checkbox.bd-checkbox-has-label {
    flex: 1 1 auto;
    font-size: 16px;
    max-width: 100%;
}

.bd-checkbox-input {
    width: 24px;
    height: 24px;
    cursor: pointer;
    position: absolute;
    top: 0;
    left: 0;
    opacity: 0;
    margin: 0;
    padding: 0;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    z-index: 1;
}
.bd-checkbox-box {
    width: 24px;
    height: 24px;
    border-color: var(--primary-400);
    display: flex;
    justify-content: center;
    align-items: center;
    flex: 0 0 auto;
    border-width: 1px;
    border-style: solid;
    box-sizing: border-box;
    border-radius: 6px;
    color: var(--interactive-text-active);
}
.bd-checkbox-input:checked + .bd-checkbox-box {
    border-color: var(--bd-brand);
    background-color: var(--bd-brand);
}

.bd-checkbox-input:not(:checked) + .bd-checkbox-box > svg {
    display: none;
}

.bd-checkbox-label {
    flex: 1 1 auto;
    min-width: 0;
}

.bd-checkbox.bd-checkbox-disabled {
    opacity: .6;
    cursor: not-allowed;
}

/* ===== upstream styles/ui/bdsettings.css ===== */
.theme-dark .bd-social-logo path {
  fill: #adadad;
}

.theme-light .bd-social-logo path {
  fill: #b9bbbe;
}

.bd-social-link:hover .bd-social-logo {
  opacity: 1;
}

.bd-social-link:hover .bd-social-logo path:first-of-type {
  fill: var(--bd-brand);
}

.bd-button-title {
  margin-left: 10px;
}

.bd-select-wrapper {
  color: var(--text-default);
  font-size: 13px;
  display: flex;
  align-items: center;
}

.bd-select-wrapper + .bd-select-wrapper {
  margin-left: 10px;
}

.bd-select-wrapper label {
  margin-right: 5px;
}

.bd-select {
  position: relative;
  cursor: pointer;
  color: var(--interactive-text-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--input-background-default);
  border: 1px solid var(--input-border-default);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  transition: 150ms ease border-color;
  font-family: var(--font-primary);
  font-size: 16px;
  font-weight: 500;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bd-select.bd-select-disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.bd-select.bd-select-transparent {
  align-items: flex-start;
  background: none;
  border: none;
  padding: 0;
}

.bd-select-arrow {
  margin-left: 10px;
  color: var(--interactive-text-default);
}

.bd-select-options {
  position: fixed;
  inset-block-start: anchor(end);
  inset-inline-start: anchor(start);
  background: var(--background-surface-higher);
  font-family: var(--font-primary);
  color: var(--text-default);
  border-radius: var(--radius-sm);
  max-height: 300px;
  min-width: anchor-size(width);
  margin-top: 4px;
  overflow: auto;
  border: 1px solid var(--input-border-default);
}

.bd-select-option {
  padding: 8px 12px;
  cursor: pointer;
  white-space: pre;
}

.bd-select-option:hover {
  background: var(--interactive-background-hover);
  color: var(--interactive-text-hover);
}

.bd-select-option.selected {
  background: var(--interactive-background-selected);
  color: var(--interactive-text-active);
}

.bd-setting-item .bd-select {
  min-width: 200px;
}

.bd-setting-item {
  display: flex;
  flex-direction: column;
  margin-bottom: 20px;
}

.bd-setting-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.bd-setting-header label {
  font-weight: 500;
  /* cursor: pointer; */
  overflow: hidden;
  word-wrap: break-word;
  font-size: 16px;
  line-height: 24px;
  color: var(--text-strong);
}

.bd-setting-note {
  color: var(--text-default);
  margin-top: 4px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
}

.bd-setting-item:not(.inline) .bd-setting-note {
  margin-bottom: 10px;
}

.bd-divider.bd-setting-divider {
  margin-top: 20px;
}

.bd-settings-container {
  height: auto;
  overflow: hidden;
  transition: height 300ms cubic-bezier(0.47, 0, 0.745, 0.715);
}

.bd-settings-group.collapsed .bd-settings-container {
  height: 0;
}

.bd-settings-group.expanded .bd-settings-container:not(.animating) {
  overflow: visible;
}

.bd-settings-title {
  display: flex;
  justify-content: space-between;
  color: var(--text-strong, var(--text-default));
  display: flex;
  font-weight: 600;
  cursor: default;
  flex: 1;
}

.bd-settings-title:not(.bd-settings-group-title) {
  margin-bottom: 20px;
  font-size: 20px;
  line-height: 24px;
}

.bd-settings-group.collapsible .bd-settings-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  order: 1;
}

.bd-settings-group.collapsible .bd-settings-title::before {
  content: "";
  background-color: var(--app-frame-border);
  height: 2px;
  order: 2;
  flex: 1;
  margin: 0 10px 0 15px;
}

.bd-settings-group.collapsible .bd-settings-title::after {
  content: "";
  -webkit-mask: url("data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4NCjwhLS0gR2VuZXJhdG9yOiBBZG9iZSBJbGx1c3RyYXRvciAxOS4wLjAsIFNWRyBFeHBvcnQgUGx1Zy1JbiAuIFNWRyBWZXJzaW9uOiA2LjAwIEJ1aWxkIDApICAtLT4NCjxzdmcgdmVyc2lvbj0iMS4xIiBpZD0iQ2FscXVlXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSItOTUwIDUzMiAxOCAxOCIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAtOTUwIDUzMiAxOCAxODsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPHN0eWxlIHR5cGU9InRleHQvY3NzIj4NCgkuc3Qwe2ZpbGw6bm9uZTt9DQoJLnN0MXtmaWxsOm5vbmU7c3Ryb2tlOiNGRkZGRkY7c3Ryb2tlLXdpZHRoOjEuNTtzdHJva2UtbWl0ZXJsaW1pdDoxMDt9DQo8L3N0eWxlPg0KPHBhdGggY2xhc3M9InN0MCIgZD0iTS05MzIsNTMydjE4aC0xOHYtMThILTkzMnoiLz4NCjxwb2x5bGluZSBjbGFzcz0ic3QxIiBwb2ludHM9Ii05MzYuNiw1MzguOCAtOTQxLDU0My4yIC05NDUuNCw1MzguOCAiLz4NCjwvc3ZnPg0K")
    center/contain no-repeat;
  mask: url("data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4NCjwhLS0gR2VuZXJhdG9yOiBBZG9iZSBJbGx1c3RyYXRvciAxOS4wLjAsIFNWRyBFeHBvcnQgUGx1Zy1JbiAuIFNWRyBWZXJzaW9uOiA2LjAwIEJ1aWxkIDApICAtLT4NCjxzdmcgdmVyc2lvbj0iMS4xIiBpZD0iQ2FscXVlXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSItOTUwIDUzMiAxOCAxOCIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAtOTUwIDUzMiAxOCAxODsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPHN0eWxlIHR5cGU9InRleHQvY3NzIj4NCgkuc3Qwe2ZpbGw6bm9uZTt9DQoJLnN0MXtmaWxsOm5vbmU7c3Ryb2tlOiNGRkZGRkY7c3Ryb2tlLXdpZHRoOjEuNTtzdHJva2UtbWl0ZXJsaW1pdDoxMDt9DQo8L3N0eWxlPg0KPHBhdGggY2xhc3M9InN0MCIgZD0iTS05MzIsNTMydjE4aC0xOHYtMThILTkzMnoiLz4NCjxwb2x5bGluZSBjbGFzcz0ic3QxIiBwb2ludHM9Ii05MzYuNiw1MzguOCAtOTQxLDU0My4yIC05NDUuNCw1MzguOCAiLz4NCjwvc3ZnPg0K")
    center/contain no-repeat;
  background: var(--text-default);
  height: 20px;
  width: 20px;
  display: inline-block;
  vertical-align: bottom;
  transition: transform 0.3s ease;
  transform: rotate(0);
  order: 3;
}

.bd-settings-group.collapsed .bd-settings-title::after {
  transition: transform 0.3s ease;
  transform: rotate(90deg);
}

.bd-settings-group ~ .bd-settings-group .bd-settings-title {
  margin-top: 30px;
  transition: margin-top 300ms ease;
}

.bd-settings-group.collapsed + .bd-settings-group .bd-settings-title {
  margin-top: 0;
}

.bd-settings-title.bd-settings-group-title {
  margin-bottom: 10px;
  text-transform: uppercase;
  font-size: 14px;
  color: var(--interactive-text-default);
}

.checkbox-item {
  display: flex;
}

.checkbox-item .checkbox-label {
  margin-right: 8px;
}

/* ===== upstream styles/ui/radio.css ===== */
.bd-radio-group {
    min-width: 300px;
}

.bd-radio-option {
    display: flex;
    gap: 8px;
    align-items: center;
    border-left: 3px solid transparent;
    padding: 12px 16px;
    margin-bottom: 4px;
    cursor: pointer;
    user-select: none;
    border-radius: var(--radius-sm);
    color: var(--text-primary);
}

.bd-radio-group.bd-radio-disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.bd-radio-group.bd-radio-disabled .bd-radio-option {
    pointer-events: none;
}

.bd-radio-option:hover {
    background-color: var(--background-mod-subtle);
    color: var(--interactive-text-hover);
}

.bd-radio-option.bd-radio-selected {
    background-color: var(--background-mod-subtle);
    color: var(--interactive-text-active);
}

.bd-radio-option input {
    position: absolute;
    opacity: 0;
    cursor: pointer;
    height: 0;
    width: 0;
}

.bd-radio-indicator {
    border-radius: 50%;
}

.bd-radio-icon {
    stroke: var(--checkbox-border-default);
}

.bd-radio-selected .bd-radio-icon {
    stroke: var(--bd-brand);
    fill: var(--bd-brand);
}

.bd-radio-label-wrap {
    display: flex;
    flex-direction: column;
}

.bd-radio-label {
    font-family: var(--font-primary);
    font-size: 16px;
    line-height: 20px;
    font-weight: 500;
}

.bd-radio-description {
    font-family: var(--font-primary);
    font-size: 14px;
    line-height: 18px;
    font-weight: 400;
}
/* ===== upstream styles/ui/number.css ===== */
.bd-number-input-wrapper {
    display: flex;
}

.bd-number-input::-webkit-inner-spin-button,
.bd-number-input::-webkit-outer-spin-button {
    display: none;
}

.bd-number-input {
    box-sizing: border-box;
    padding: 8px 12px;
    background-color: var(--input-background-default);
    border: 1px solid var(--input-border-default);
    color: var(--text-default);
    text-align: center;
    font-size: 16px;
}

.bd-number-input:focus-within {
    border-color: var(--bd-brand);
}

.bd-number-input:not([min][max]) {
    width: 65px;
}

.bd-button.bd-number-input-decrement {
    border-right: unset;
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.bd-button.bd-number-input-increment {
    border-left: unset;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.bd-number-input-wrapper.bd-number-input-disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.bd-number-input-wrapper.bd-number-input-disabled .bd-number-input,
.bd-number-input-wrapper.bd-number-input-disabled .bd-button.bd-number-input-decrement,
.bd-number-input-wrapper.bd-number-input-disabled .bd-button.bd-number-input-increment {
    pointer-events: none;
}
/* ===== upstream styles/ui/keybind.css ===== */
.bd-keybind-wrap {
    display: flex;
    align-items: center;
    gap: 5px;
    position: relative;
    min-width: 250px;
    box-sizing: border-box;
    border-radius: var(--radius-sm);
    background-color: var(--input-background-default);
    border: 1px solid var(--input-border-default);
    padding: 0 4px;
    height: 40px;
    cursor: pointer;
}

.bd-keybind-wrap.bd-keybind-disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.bd-keybind-wrap.bd-keybind-disabled .bd-keybind-record,
.bd-keybind-wrap.bd-keybind-disabled .bd-keybind-clear,
.bd-keybind-wrap.bd-keybind-disabled .bd-keybind-input {
    pointer-events: none;
}

.bd-keybind-wrap input {
    flex: 1;
    outline: none;
    border: none;
    pointer-events: none;
    color: var(--text-default);
    background: none;
    font-size: 16px;
    text-transform: uppercase;
    font-weight: 600;
}

.bd-keybind-wrap input::placeholder {
    text-transform: capitalize;
}

.bd-keybind-wrap.recording,
.bd-keybind-wrap:not(.bd-keybind-disabled):hover {
    border-color: hsl(var(--red-400-hsl)/.3);
}

.bd-keybind-wrap.recording {
    box-shadow: 0 0 6px hsl(var(--red-400-hsl)/.3);
}

.bd-keybind-wrap.recording input {
    color: var(--status-danger)
}

.bd-keybind-wrap .bd-keybind-record {
    padding: 3px 8px;
}

.bd-keybind-wrap .bd-keybind-record.bd-button-color-red svg {
    color: var(--interactive-text-active);
}

.bd-keybind-clear {
    margin-left: 5px;
    /* background: none!important; */
    opacity: 0.5;
    padding-right: 4px!important;
}

.bd-keybind-clear:hover {
    /* background: none; */
    opacity: 1;
}

.bd-keybind-clear svg {
    width: 18px !important;
    height: 18px !important;
}


/* ===== upstream styles/ui/slider.css ===== */
.bd-setting-item:not(.inline) .bd-slider-wrap {
    margin-top: 10px;
}

.bd-slider-wrap {
    display: flex;
    flex-direction: column;
    justify-content: center;
    color: var(--text-default);
    align-items: center;
    position: relative;
    margin: 0 10px;
}

.bd-slider-wrap.bd-slider-markers {
    padding-bottom: 10px;
    margin-bottom: 10px;
}


.bd-slider-wrap.bd-slider-disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.bd-slider-wrap.bd-slider-disabled > .bd-slider-input,
.bd-slider-wrap.bd-slider-disabled > .bd-slider-label,
.bd-slider-wrap.bd-slider-disabled > .bd-slider-track,
.bd-slider-wrap.bd-slider-disabled > .bd-slider-marker-container,
.bd-slider-wrap.bd-slider-disabled > .bd-slider-input::-webkit-slider-thumb {
    pointer-events: none;
}

.bd-slider-label {
    background: black;
    font-weight: 700;
    padding: 5px 7px;
    border-radius: 5px;
    opacity: 0;
    pointer-events: none;
    position: absolute;
    top: -45px;
}

.bd-slider-input:hover + .bd-slider-label {
    opacity: 1;
}

.bd-slider-input {
    /* height: 8px; */
    appearance: none;
    /* min-width: 350px; */
    /* border-radius: 5px; */
    outline: none;
    pointer-events: none;
    position: absolute;
    background: none;
    width: 100%;
    z-index: 2;
}

  /* The slider handle (use -webkit- (Chrome, Opera, Safari, Edge) and -moz- (Firefox) to override default look) */
.bd-slider-input::-webkit-slider-thumb {
    appearance: none;
    width: 10px;
    height: 24px;
    top: 50%;
    border-radius: 3px;
    background-color: hsl(0,calc(var(--saturation-factor, 1)*0%),100%);
    border: 1px solid hsl(210,calc(var(--saturation-factor, 1)*2.9%),86.7%);
    -webkit-box-shadow: 0 3px 1px 0 hsla(0,calc(var(--saturation-factor, 1)*0%),0%,.05),0 2px 2px 0 hsla(0,calc(var(--saturation-factor, 1)*0%),0%,.1),0 3px 3px 0 hsla(0,calc(var(--saturation-factor, 1)*0%),0%,.05);
    box-shadow: 0 3px 1px 0 hsla(0,calc(var(--saturation-factor, 1)*0%),0%,.05),0 2px 2px 0 hsla(0,calc(var(--saturation-factor, 1)*0%),0%,.1),0 3px 3px 0 hsla(0,calc(var(--saturation-factor, 1)*0%),0%,.05);
    cursor: ew-resize;
    /* z-index: 3; */
    pointer-events: all;
}

.bd-slider-track {
    height: 8px;
    border-radius: 4px;
    min-width: 350px;
    border-radius: 5px;
    background: hsl(217,calc(var(--saturation-factor, 1)*7.6%),33.5%);
    transition: opacity .2s;
    background-image: linear-gradient(var(--bd-brand), var(--bd-brand));
    background-size: 70% 100%;
    background-repeat: no-repeat;
    cursor: pointer;
    width: 100%;
    z-index: 1;
}

.bd-slider-marker-container {
    display: flex;
    width: 98%;
    justify-content: space-between;
    position: absolute;
    bottom: 0;
}

.bd-slider-marker {
    position: absolute;
    transform: translateX(-50%);
    font-size: 12px;
    cursor: pointer;
}

.bd-slider-marker::before {
    content: "";
    position: absolute;
    width: 2px;
    height: 24px;
    background: rgba(255, 255, 255, 0.2);
    top: -26px;
    left: calc(50% - 1px);
    z-index: -1;
}

.bd-setting-item.inline:first-child:has(.bd-slider-wrap) {
    padding-top: 50px;
}

/* ===== upstream styles/ui/scroller.css ===== */
.bd-scroller-base {
    position: relative;
    box-sizing: border-box;
    min-height: 0;
    flex: 1 1 auto;
}

@supports not selector(::-webkit-scrollbar) {
    .bd-scroller-thin {
        scrollbar-width: thin;
        scrollbar-color: var(--scrollbar-thin-thumb) var(--scrollbar-thin-track);
    }
}

.bd-scroller-thin::-webkit-scrollbar-track {
    border-color: var(--scrollbar-thin-track);
    background-color: var(--scrollbar-thin-track);
    border: 2px solid var(--scrollbar-thin-track);
}

.bd-scroller-thin::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

.bd-scroller-thin::-webkit-scrollbar-corner {
    background-color: transparent;
}

.bd-scroller-thin::-webkit-scrollbar-thumb {
    background-clip: padding-box;
    border: 2px solid transparent;
    border-radius: 4px;
    background-color: var(--scrollbar-thin-thumb);
    min-height: 40px;
}
/* ===== upstream styles/ui/tooltip.css ===== */
.bd-layer {
  position: absolute;
}

.bd-tooltip {
  position: relative;
  border-radius: 5px;
  font-weight: 500;
  font-size: 14px;
  line-height: 16px;
  max-width: 190px;
  box-sizing: border-box;
  word-wrap: break-word;
  z-index: 1002;
  will-change: opacity, transform;
  box-shadow: var(--elevation-high);
  color: var(--text-strong);
}

.bd-tooltip-content {
  padding: 8px 12px;
  overflow: hidden;
}

.bd-tooltip-pointer {
  pointer-events: none;
  width: 0;
  height: 0;
  border: 5px solid transparent;
}

.bd-tooltip-primary {
  background-color: var(--background-base-low);
  color: var(--text-default);
}

.bd-tooltip-primary .bd-tooltip-pointer {
  border-top-color: var(--background-base-lowest);
}

.bd-tooltip-info {
  background-color: #4a90e2;
}

.bd-tooltip-info .bd-tooltip-pointer {
  border-top-color: #4a90e2;
}

.bd-tooltip-success {
  background-color: #43b581;
}

.bd-tooltip-success .bd-tooltip-pointer {
  border-top-color: #43b581;
}

.bd-tooltip-danger {
  background-color: #f04747;
}

.bd-tooltip-danger .bd-tooltip-pointer {
  border-top-color: #f04747;
}

.bd-tooltip-warn {
  background-color: #ffa600;
}

.bd-tooltip-warn .bd-tooltip-pointer {
  border-top-color: #ffa600;
}

.bd-tooltip-top .bd-tooltip-pointer {
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -5px;
}

.bd-tooltip-bottom .bd-tooltip-pointer {
  position: absolute;
  bottom: 100%;
  left: 50%;
  margin-left: -5px;
  transform: rotate(180deg);
}

.bd-tooltip-right .bd-tooltip-pointer {
  position: absolute;
  right: 100%;
  top: 50%;
  margin-top: -5px;
  border-left-width: 5px;
  transform: rotate(90deg);
}

.bd-tooltip-left .bd-tooltip-pointer {
  position: absolute;
  left: 100%;
  top: 50%;
  margin-top: -5px;
  border-left-width: 5px;
  transform: rotate(270deg);
}

/* ===== upstream styles/ui/colorpicker.css ===== */
.bd-color-picker-container {
    display: flex;
    justify-content: center;
}

.bd-color-picker-container.bd-color-picker-disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.bd-color-picker-container.bd-color-picker-disabled > .bd-color-picker-controls,
.bd-color-picker-container.bd-color-picker-disabled > .bd-color-picker-swatch {
    pointer-events: none;
}

.bd-color-picker-controls {
    padding-left: 1px;
    padding-top: 2px;
    display: flex;
}

.bd-color-picker-default {
    cursor: pointer;
    width: 75px;
    height: 60px;
    border-radius: 4px;
    margin-right: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 1px;
}

.bd-color-picker-custom {
    position: relative;
    display: inline-table;
}

.bd-color-picker-custom svg {
    position: absolute;
    top: 5px;
    right: 5px;
    pointer-events: none;
}

.bd-color-picker {
    outline: none;
    width: 75px;
    border: none;
    height: 60px;
    margin-top: 1px;
    border-radius: 4px;
    cursor: pointer;
}

.bd-color-picker::-webkit-color-swatch {
    border: none;
}

.bd-color-picker-swatch {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    margin-left: 5px !important;
    max-width: 330px;
}

.bd-color-picker-swatch-item {
    cursor: pointer;
    border-radius: 4px;
    width: 15px;
    height: 15px;
    margin: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
}


.bd-setting-item.inline .bd-color-picker-swatch {
    max-width: 220px;
    margin-top: 1px;
}


.bd-setting-item.inline .bd-color-picker-default,
.bd-setting-item.inline .bd-color-picker {
    width: 50px;
    height: 40px
}

.bd-setting-item.inline .bd-color-picker-swatch-item {
    height: 18px;
    width: 18px;
    margin: 2px 2px;
}
`;
