// Gives the page the same bridge the Swift app does (mac/main.swift), so public/ runs unchanged:
//   window.webkit.messageHandlers.suijiFs.postMessage({op, ...}) → Promise   (folder sync, localHttp, magpieLink)
//   window.webkit.messageHandlers.suiji.postMessage({style, lang})           (Dock icon and language)
// Also the title bar: the page fills the window under the traffic lights, and a strip over the gap it leaves
// at the top drags the window, and double-click zooms it (macOS does that for drag regions), as in the Swift app.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("webkit", {
  messageHandlers: {
    suijiFs: {
      postMessage: async (body) => {
        const r = await ipcRenderer.invoke("suijiFs", body);
        if (r.error != null) throw new Error(r.error);
        return r.value;
      },
    },
    suiji: { postMessage: (body) => { ipcRenderer.send("suiji", body); } },
  },
});

const CSS = `
html.mac-app:not(.fullscreen) body { padding-top: 32px !important; }
#suiji-titlebar { position: fixed; top: 0; left: 0; right: 0; height: 28px; z-index: 2147483647; -webkit-app-region: drag; }
html.fullscreen #suiji-titlebar { display: none; }
`;
addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("mac-app");
  const style = document.createElement("style");
  style.textContent = CSS;
  const strip = document.createElement("div");
  strip.id = "suiji-titlebar";
  document.head.append(style);
  document.body.append(strip);
});
ipcRenderer.on("fullscreen", (_, on) => document.documentElement.classList.toggle("fullscreen", on));
