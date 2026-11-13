/* global Services, ChromeUtils, Zotero, ZoteConfCore, ZoteConfPlugin */
var ZoteConf;

function install() {}
function uninstall() {}

async function startup({ id, version, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "src/core.js");
  Services.scriptloader.loadSubScript(rootURI + "src/plugin.js");

  const timers = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  ZoteConf = ZoteConfPlugin({
    Zotero,
    core: ZoteConfCore,
    delay: (ms) => new Promise((resolve) => timers.setTimeout(resolve, ms)),
  });
  ZoteConf.startup({ id, version, rootURI, timers });
  for (const win of Zotero.getMainWindows()) ZoteConf.addToWindow(win);
  // Reachable from Tools → Developer → Run JavaScript, for debugging
  Zotero.ZoteConf = ZoteConf;
}

function onMainWindowLoad({ window }) {
  ZoteConf?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  ZoteConf?.removeFromWindow(window);
}

function shutdown() {
  if (!ZoteConf) return;
  for (const win of Zotero.getMainWindows()) ZoteConf.removeFromWindow(win);
  ZoteConf.shutdown();
  delete Zotero.ZoteConf;
  ZoteConf = undefined;
}
