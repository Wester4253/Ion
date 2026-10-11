/**
 * A trimmed copy of Discord's real user-settings modal markup, captured via
 * CDP from the live client (class hashes are from one Discord build — the
 * code under test only relies on stable attributes and class *substrings*,
 * which is exactly what these fixtures verify).
 *
 * Used by modal/tab/integration tests to exercise the full settings lifecycle
 * headlessly, without launching Electron.
 */
export const SETTINGS_MODAL_HTML = `
<div role="dialog" class="root">
  <div class="outerContainer_e44912">
    <div class="container__8a031 modal_e44912 theme-dark">
      <div class="modalContent_e44912">
        <div class="modalContentInner_e44912">
          <div class="container_abd9a8">
            <aside class="sidebar__409aa">
              <nav class="nav__409aa">
                <div class="navScroller__409aa">
                  <ul class="sublist__409aa" role="list">
                    <li class="section__409aa" aria-labelledby="_h_general">
                      <span class="hiddenVisually_b18fe2"><h3 id="_h_general">General</h3></span>
                      <ul class="sectionList__409aa">
                        <li class="itemContainer_caf372" data-settings-sidebar-item="account_panel">
                          <div class="item_caf372 active_caf372" role="link" tabindex="0"
                               data-list-item-id="settings-sidebar___account_panel" aria-current="page">
                            <div class="itemContent_caf372">
                              <svg class="icon_caf372" width="20" height="20"><path d="M0 0h24v24H0z"/></svg>
                              <div class="text-md_medium_cf4812" data-text-variant="text-md/medium">Account</div>
                            </div>
                          </div>
                        </li>
                        <li class="itemContainer_caf372" data-settings-sidebar-item="profile_panel">
                          <div class="item_caf372" role="link" tabindex="0"
                               data-list-item-id="settings-sidebar___profile_panel">
                            <div class="itemContent_caf372">
                              <svg class="icon_caf372" width="20" height="20"><path d="M0 0h24v24H0z"/></svg>
                              <div class="text-md_medium_cf4812" data-text-variant="text-md/medium">Profiles</div>
                            </div>
                          </div>
                        </li>
                      </ul>
                    </li>
                    <li class="section__409aa" aria-labelledby="_h_billing">
                      <div class="sectionLabel__409aa"><h3 id="_h_billing">Billing</h3></div>
                      <ul class="sectionList__409aa">
                        <li class="itemContainer_caf372" data-settings-sidebar-item="nitro_panel">
                          <div class="item_caf372" role="link" tabindex="0"
                               data-list-item-id="settings-sidebar___nitro_panel">
                            <div class="itemContent_caf372">
                              <svg class="icon_caf372" width="20" height="20"><path d="M0 0h24v24H0z"/></svg>
                              <div class="text-md_medium_cf4812" data-text-variant="text-md/medium">Nitro</div>
                            </div>
                          </div>
                          <div class="subnavContainer_e4d939">
                            <div class="subnav_e4d939">Nitro Boost</div>
                          </div>
                        </li>
                      </ul>
                    </li>
                  </ul>
                </div>
              </nav>
            </aside>
            <div class="content_e9e3ed">
              <div class="contentHeader_e9e3ed">
                <nav class="breadcrumbsNav__6989f">
                  <div class="breadcrumbs__6989f" role="list">
                    <li class="breadcrumb__6989f">
                      <div class="breadcrumbContent__6989f">
                        <div class="breadcrumbText__6989f" data-text-variant="text-md/medium">Account</div>
                      </div>
                    </li>
                  </div>
                </nav>
              </div>
              <div class="contentBody_e9e3ed">
                <div class="scroller__6131a scrollbarGutter_d125d2 scrollerBase_d125d2">
                  <div class="panel__6131a">native settings content</div>
                  <div class="bottomMarker__6131a"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`;

/** Minimal, stable SVG for the injected sidebar row in tests. */
export const TEST_ICON_SVG = `<svg class="icon" width="20" height="20"><path d="M1 1h18v18H1z"/></svg>`;
