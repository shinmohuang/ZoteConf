/* ZoteConf glue: wires the core lookup into Zotero.
 *
 * createZoteConf() takes its dependencies as arguments so the orchestration
 * (what gets looked up when, what is written to the item, what is remembered
 * for a later re-check) can be tested under Node with a fake Zotero.
 */
var ZoteConfPlugin = function createZoteConf(deps) {
  "use strict";

  var Zotero = deps.Zotero;
  var core = deps.core;
  var delay = deps.delay;
  var now = deps.now || Date.now;

  var PREF = "extensions.zoteconf.";
  var ADD_DELAY_MS = 5000; // let the Connector finish writing the new item first
  var GAP_MS = 1500; // pause between items, to stay polite to the APIs
  var RECENT_MS = 10 * 60 * 1000; // "just added" window; older items came in through sync
  var FIELDS_READ = ["title", "abstractNote", "url", "DOI", "extra", "archiveID", "repository", "publicationTitle"];

  var STRINGS = {
    en: {
      updated: function (title, venue) { return title + "\n→ " + venue; },
      summary: function (s) {
        return "Updated " + s.updated + ", no published version found for " + s.notFound +
          (s.failed ? ", " + s.failed + " failed" : "") + ".";
      },
      progress: function (st) {
        return st.done < st.total
          ? "Checking " + (st.done + 1) + " / " + st.total + (st.title ? ": " + st.title : "")
          : "Done " + st.total + " / " + st.total;
      },
    },
    zh: {
      updated: function (title, venue) { return title + "\n→ " + venue; },
      summary: function (s) {
        return "已更新 " + s.updated + " 篇，" + s.notFound + " 篇暂未找到正式发表版本" +
          (s.failed ? "，" + s.failed + " 篇出错" : "") + "。";
      },
      progress: function (st) {
        return st.done < st.total
          ? "正在查找 " + (st.done + 1) + " / " + st.total + (st.title ? "：" + st.title : "")
          : "已完成 " + st.total + " / " + st.total;
      },
    },
  };

  function strings() {
    return /^zh/i.test(Zotero.locale || "") ? STRINGS.zh : STRINGS.en;
  }

  function log(msg) {
    Zotero.debug("ZoteConf: " + msg);
  }

  function pref(name) {
    return Zotero.Prefs.get(PREF + name, true);
  }

  // ---------- user notification ----------

  function notifyUser(text) {
    if (deps.notifyUser) return deps.notifyUser(text);
    try {
      var pw = new Zotero.ProgressWindow({ closeOnClick: true });
      pw.changeHeadline("ZoteConf");
      String(text).split("\n").forEach(function (line) { pw.addDescription(line); });
      pw.show();
      pw.startCloseTimer(8000);
    } catch (e) {
      Zotero.logError(e);
    }
    return undefined;
  }

  /**
   * Progress bar for a manual batch.
   * @returns {update({done, total, updated, title}), finish(summaryText)}
   */
  function createProgress(total) {
    if (deps.createProgress) return deps.createProgress(total);
    var plain = { update: function () {}, finish: function (text) { notifyUser(text); } };
    if (deps.notifyUser) return plain;
    try {
      var pw = new Zotero.ProgressWindow({ closeOnClick: false });
      pw.changeHeadline("ZoteConf");
      pw.show();
      var line = new pw.ItemProgress("preprint", strings().progress({ done: 0, total: total }));
      var shorten = function (t) { t = String(t || ""); return t.length > 60 ? t.slice(0, 59) + "…" : t; };
      return {
        update: function (st) {
          line.setText(strings().progress({ done: st.done, total: st.total, title: shorten(st.title) }));
          line.setProgress(Math.round((st.done / st.total) * 100));
        },
        finish: function (text) {
          line.setProgress(100);
          line.setText(text);
          pw.startCloseTimer(8000);
        },
      };
    } catch (e) {
      Zotero.logError(e);
      return plain;
    }
  }

  // ---------- pending list (papers not published yet, to be re-checked) ----------

  function loadPending() {
    try {
      var parsed = JSON.parse(pref("pending") || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function updatePending(fn) {
    var pending = loadPending();
    fn(pending);
    Zotero.Prefs.set(PREF + "pending", JSON.stringify(pending), true);
  }

  function pendingKey(item) {
    return item.libraryID + "/" + item.key;
  }

  // ---------- reading / writing items ----------

  function snapshot(item) {
    var snap = { itemType: Zotero.ItemTypes.getName(item.itemTypeID) };
    FIELDS_READ.forEach(function (name) {
      try {
        snap[name] = item.getField(name) || "";
      } catch (e) {
        snap[name] = "";
      }
    });
    return snap;
  }

  /** Eligible for the automatic lookup: an arXiv preprint we can identify. */
  function isCandidate(item) {
    if (!item || item.deleted || item.isFeedItem || !item.isRegularItem()) return false;
    return core.isArxivPreprint(snapshot(item));
  }

  /** Eligible for the manual lookup: any preprint, even one without an arXiv id. */
  function isManualCandidate(item) {
    if (!item || item.deleted || item.isFeedItem || !item.isRegularItem()) return false;
    return core.isLookupCandidate(snapshot(item));
  }

  async function httpFetch(url, opts) {
    var xhr = await Zotero.HTTP.request("GET", url, {
      headers: (opts && opts.headers) || {},
      successCodes: false, // the core handles status codes itself
      errorDelayMax: 0, // ...including its own backoff for 429
      timeout: 20000,
    });
    return { status: xhr.status, text: xhr.responseText };
  }

  async function translateDOI(doi) {
    try {
      var translate = new Zotero.Translate.Search();
      translate.setIdentifier({ DOI: doi });
      var translators = await translate.getTranslators();
      if (!translators.length) return null;
      translate.setTranslator(translators);
      // libraryID: false → return item JSON instead of saving a new item
      var items = await translate.translate({ libraryID: false, saveAttachments: false });
      return (items && items[0]) || null;
    } catch (e) {
      log("DOI translation failed for " + doi + ": " + e);
      return null;
    }
  }

  function applyPatch(item, patch, snap) {
    var typeID = Zotero.ItemTypes.getID(patch.itemType);
    item.setType(typeID);
    // The arXiv DOI identifies the preprint, not the published paper
    if (/^10\.48550\//i.test(snap.DOI) && !patch.fields.DOI && Zotero.ItemFields.isValidForType(Zotero.ItemFields.getID("DOI"), typeID)) {
      item.setField("DOI", "");
    }
    Object.keys(patch.fields).forEach(function (name) {
      var fieldID = Zotero.ItemFields.getFieldIDFromTypeAndBase(typeID, name) || Zotero.ItemFields.getID(name);
      if (!fieldID || !Zotero.ItemFields.isValidForType(fieldID, typeID)) return;
      try {
        item.setField(fieldID, patch.fields[name]);
      } catch (e) {
        log("could not set " + name + ": " + e);
      }
    });
    if (patch.creators) {
      item.setCreators(patch.creators.map(function (c) {
        var typeOk = c.creatorType && Zotero.CreatorTypes.getID(c.creatorType) &&
          Zotero.CreatorTypes.isValidForItemType(Zotero.CreatorTypes.getID(c.creatorType), typeID);
        var out = { creatorType: typeOk ? c.creatorType : "author" };
        if (c.name || (!c.firstName && c.lastName && c.fieldMode === 1)) out.name = c.name || c.lastName;
        else { out.firstName = c.firstName || ""; out.lastName = c.lastName || ""; }
        return out;
      }));
    }
  }

  /**
   * Look one item up and, if a published version is found, convert it in place.
   * @returns {status: "updated"|"not_found"|"skipped", venue?, source?}
   */
  async function processItem(item, opts) {
    var eligible = opts && opts.manual ? isManualCandidate : isCandidate;
    if (!eligible(item)) return { status: "skipped" };
    var snap = snapshot(item);
    var arxivId = core.extractArxivId(snap);
    var creators = item.getCreatorsJSON();
    log("looking up " + (arxivId ? "arXiv:" + arxivId : "preprint without arXiv id") + " (" + snap.title + ")");

    var found = await core.findPublished(
      { arxivId: arxivId, title: snap.title, authors: creators },
      { fetch: httpFetch, sleep: delay, s2ApiKey: pref("s2ApiKey") || "", log: log });

    arxivId = arxivId || found.arxivId || null;
    var candidate = found.status === "found" ? found.candidate : null;
    var translated = candidate && candidate.doi ? await translateDOI(candidate.doi) : null;
    if (candidate && !translated && !core.isSelfSufficient(candidate)) candidate = null;

    // The lookup took a while; the user may have edited, converted or deleted the item meanwhile
    if (!eligible(item)) return { status: "skipped" };

    if (!candidate) {
      updatePending(function (p) { p[pendingKey(item)] = { lastChecked: now() }; });
      log("no published version for arXiv:" + arxivId +
        (found.errors.length ? " (" + found.errors.map(function (e) { return e.source + ": " + e.error; }).join("; ") + ")" : ""));
      return { status: "not_found" };
    }

    snap = snapshot(item);
    var patch = core.buildItemPatch(candidate, {
      arxivId: arxivId,
      title: snap.title,
      abstractNote: snap.abstractNote,
      extra: snap.extra,
      creators: item.getCreatorsJSON(),
    }, translated);
    applyPatch(item, patch, snap);
    await item.saveTx();
    updatePending(function (p) { delete p[pendingKey(item)]; });

    var venue = patch.label || patch.itemType;
    log("arXiv:" + arxivId + " → " + venue + " [" + candidate.source + "]");
    return { status: "updated", venue: venue, source: candidate.source, title: snap.title };
  }

  // ---------- serial queue ----------

  var chain = Promise.resolve();
  var queued = new Set();

  /** Runs processItem for one item after everything already queued; never rejects. */
  function enqueue(item, opts) {
    if (queued.has(item.id)) return Promise.resolve({ status: "skipped" });
    queued.add(item.id);
    var run = chain.then(async function () {
      try {
        if (opts && opts.onStart) opts.onStart();
        return await processItem(item, opts);
      } catch (e) {
        Zotero.logError(e);
        return { status: "failed", error: String(e) };
      } finally {
        queued.delete(item.id);
        await delay(GAP_MS);
      }
    });
    chain = run;
    return run;
  }

  function announce(result) {
    if (result.status === "updated") notifyUser(strings().updated(result.title, result.venue));
  }

  // ---------- triggers ----------

  function isRecent(item) {
    var added = item.dateAdded && Zotero.Date.sqlToDate(item.dateAdded, true);
    return !!added && Math.abs(now() - added.getTime()) <= RECENT_MS;
  }

  /** Zotero.Notifier callback */
  async function notify(event, type, ids) {
    if (event !== "add" || type !== "item" || !pref("autoOnAdd")) return;
    var items = ids
      .map(function (id) { return Zotero.Items.get(id); })
      .filter(function (item) { return item && isRecent(item) && isCandidate(item); });
    if (!items.length) return;
    await delay(ADD_DELAY_MS);
    await Promise.all(items.map(function (item) { return enqueue(item).then(announce); }));
  }

  /** Context-menu action: process the given items now, report one summary. */
  async function runManual(items) {
    var summary = { updated: 0, notFound: 0, skipped: 0, failed: 0 };
    var KEYS = { updated: "updated", not_found: "notFound", skipped: "skipped", failed: "failed" };
    var total = items.length;
    var bar = total > 1 ? createProgress(total) : null;
    var done = 0;
    var report = function (title) {
      if (!bar) return;
      try {
        bar.update({ done: done, total: total, updated: summary.updated, title: title });
      } catch (e) {
        Zotero.logError(e);
      }
    };
    await Promise.all(items.map(function (item) {
      var title = "";
      try { title = item.getField("title") || ""; } catch (e) { /* not a regular item */ }
      return enqueue(item, { manual: true, onStart: function () { report(title); } }).then(function (r) {
        summary[KEYS[r.status]]++;
        done++;
      });
    }));
    report("");
    var text = strings().summary(summary);
    if (bar) bar.finish(text);
    else notifyUser(text);
    return summary;
  }

  /** Re-check papers that were not published last time we looked. */
  async function recheckDue() {
    var due = core.dueEntries(loadPending(), now(), Number(pref("recheckDays")) || 7);
    var items = [];
    var stale = [];
    due.forEach(function (key) {
      var slash = key.indexOf("/");
      var item = Zotero.Items.getByLibraryAndKey(Number(key.slice(0, slash)), key.slice(slash + 1));
      if (isManualCandidate(item)) items.push(item);
      else stale.push(key);
    });
    if (stale.length) updatePending(function (p) { stale.forEach(function (k) { delete p[k]; }); });
    if (items.length) log("re-checking " + items.length + " pending preprint(s)");
    await Promise.all(items.map(function (item) { return enqueue(item, { manual: true }).then(announce); }));
  }

  // ---------- Zotero lifecycle (not exercised by the Node tests) ----------

  var MENU_ID = "zoteconf-find-published";
  var FTL = "zoteconf.ftl";
  var notifierID = null;
  var timers = [];

  function startup(opts) {
    notifierID = Zotero.Notifier.registerObserver({ notify: notify }, ["item"], "zoteconf");

    Zotero.MenuManager.registerMenu({
      menuID: MENU_ID,
      pluginID: opts.id,
      target: "main/library/item",
      menus: [{
        menuType: "menuitem",
        l10nID: "zoteconf-menu-find-published",
        onShowing: function (event, context) {
          context.setVisible((context.items || []).some(isManualCandidate));
        },
        onCommand: function (event, context) {
          var items = (context.items || []).filter(isManualCandidate);
          if (!items.length) return;
          runManual(items);
        },
      }],
    });

    var t = opts.timers;
    timers.push([t.clearTimeout, t.setTimeout(function () { recheckDue(); }, 90 * 1000)]);
    timers.push([t.clearInterval, t.setInterval(function () { recheckDue(); }, 6 * 3600 * 1000)]);
    log("started");
  }

  function addToWindow(win) {
    if (win && win.MozXULElement) win.MozXULElement.insertFTLIfNeeded(FTL);
  }

  function removeFromWindow(win) {
    var link = win && win.document && win.document.querySelector('link[href="' + FTL + '"]');
    if (link) link.remove();
  }

  function shutdown() {
    if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
    notifierID = null;
    try { Zotero.MenuManager.unregisterMenu(MENU_ID); } catch (e) { /* already gone */ }
    timers.forEach(function (pair) { pair[0](pair[1]); });
    timers = [];
  }

  return {
    processItem: processItem,
    notify: notify,
    runManual: runManual,
    recheckDue: recheckDue,
    isCandidate: isCandidate,
    isManualCandidate: isManualCandidate,
    startup: startup,
    shutdown: shutdown,
    addToWindow: addToWindow,
    removeFromWindow: removeFromWindow,
  };
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = ZoteConfPlugin;
}
