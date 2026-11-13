(() => {
  'use strict';
  const storageKey = 'shelburne-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let saved;
  try { saved = localStorage.getItem(storageKey); } catch { /* Storage can be disabled. */ }
  let explicit = saved === 'light' || saved === 'dark';
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('.theme-switch button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.id === `theme-${theme}`));
    });
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#242424' : '#f6f5ef');
    window.dispatchEvent(new Event('weather-theme-change'));
  }
  // This small external script runs before the stylesheet, avoiding a bright
  // flash when a returning visitor has selected dark mode. No inline script.
  apply(explicit ? saved : system.matches ? 'dark' : 'light');
  function bind() {
    apply(document.documentElement.dataset.theme);
    for (const theme of ['light', 'dark']) {
      document.getElementById(`theme-${theme}`).addEventListener('click', () => {
        explicit = true;
        apply(theme);
        try { localStorage.setItem(storageKey, theme); } catch { /* Selection still works for this page. */ }
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
  system.addEventListener('change', event => { if (!explicit) apply(event.matches ? 'dark' : 'light'); });
})();
