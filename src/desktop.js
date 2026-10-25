// Mac-appen (Tauri) eller webbläsaren. Appen har en global __TAURI__ (withGlobalTauri i src-tauri/tauri.conf.json).
export const APP = '__TAURI_INTERNALS__' in window;

/** Avsluta: appen stänger sitt fönster (och därmed sig själv), webben går tillbaka till spelsidan. */
export function quit() {
  if (APP) window.__TAURI__?.window.getCurrentWindow().close();
  else location.href = '../';
}
