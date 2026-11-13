const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");
const createZoteConf = require("../src/plugin.js");
const { FakeItem, makeZotero } = require("./fake-zotero.js");
const { HOSTS } = require("./helpers.js");

const NOW = Date.parse("2026-11-13T12:00:00Z");
const DAY = 86400000;
const sqlDate = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

const EMPTY_SPARQL = { status: 200, text: '{"results":{"bindings":[]}}' };
const dblpRoute = (find, authors) => (url) => (decodeURIComponent(url).includes("signatureOrdinal") ? authors : find);
const NOTHING_ANYWHERE = {
  [HOSTS.dblp]: EMPTY_SPARQL,
  [HOSTS.arxiv]: "arxiv_no_doi.xml",
  [HOSTS.s2]: { status: 404, text: "{}" },
  [HOSTS.openalex]: { status: 200, text: '{"results":[]}' },
  [HOSTS.crossref]: { status: 200, text: '{"message":{"items":[]}}' },
  [HOSTS.openreview]: { status: 200, text: '{"notes":[]}' },
};

function vitItem(over = {}) {
  return new FakeItem({
    id: 1,
    key: "VITKEY01",
    itemType: "preprint",
    dateAdded: sqlDate(NOW - 5000),
    fields: {
      title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale",
      abstractNote: "While the Transformer architecture...",
      url: "http://arxiv.org/abs/2010.11929",
      DOI: "10.48550/arXiv.2010.11929",
      repository: "arXiv",
      archiveID: "arXiv:2010.11929",
      date: "2021-06-03",
      extra: "Citation Key: dosovitskiy2021",
    },
    creators: [
      { firstName: "Alexey", lastName: "Dosovitskiy", creatorType: "author" },
      { firstName: "Lucas", lastName: "Beyer", creatorType: "author" },
    ],
    ...over,
  });
}

function resnetItem(over = {}) {
  return new FakeItem({
    id: 2,
    key: "RESNET01",
    itemType: "preprint",
    dateAdded: sqlDate(NOW - 5000),
    fields: {
      title: "Deep Residual Learning for Image Recognition",
      abstractNote: "Deeper neural networks are more difficult to train.",
      url: "http://arxiv.org/abs/1512.03385",
      repository: "arXiv",
      archiveID: "arXiv:1512.03385",
    },
    creators: [{ firstName: "Kaiming", lastName: "He", creatorType: "author" }],
    ...over,
  });
}

const RESNET_TRANSLATED = {
  itemType: "conferencePaper",
  title: "Deep Residual Learning for Image Recognition",
  creators: [
    { firstName: "Kaiming", lastName: "He", creatorType: "author" },
    { firstName: "Xiangyu", lastName: "Zhang", creatorType: "author" },
    { firstName: "Shaoqing", lastName: "Ren", creatorType: "author" },
    { firstName: "Jian", lastName: "Sun", creatorType: "author" },
  ],
  date: "2016-06",
  DOI: "10.1109/CVPR.2016.90",
  pages: "770-778",
  proceedingsTitle: "2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
  publisher: "IEEE",
  url: "http://ieeexplore.ieee.org/document/7780459/",
  libraryCatalog: "DOI.org (Crossref)",
  ISSN: "1063-6919", // not a conferencePaper field: must be skipped, not crash
  tags: [],
};

function setup(opts) {
  const Zotero = makeZotero(opts);
  const notices = [];
  const plugin = createZoteConf({
    Zotero,
    core,
    delay: async () => {},
    now: () => NOW,
    notifyUser: (text) => notices.push(text),
  });
  const pending = () => JSON.parse(Zotero.Prefs.get("extensions.zoteconf.pending", true));
  return { Zotero, plugin, notices, pending };
}

// ---------- processItem ----------

test("conference paper without DOI: converted in place from DBLP data", async () => {
  const item = vitItem();
  const { plugin, Zotero } = setup({
    items: [item],
    routes: { [HOSTS.dblp]: dblpRoute("dblp_find_vit.json", "dblp_authors_vit.json") },
  });
  const r = await plugin.processItem(item);

  assert.equal(r.status, "updated");
  assert.equal(item.itemType, "conferencePaper");
  assert.match(item.fields.proceedingsTitle, /^9th International Conference on Learning Representations/);
  assert.equal(item.fields.conferenceName, "International Conference on Learning Representations");
  assert.equal(item.fields.date, "2021");
  assert.equal(item.fields.url, "https://openreview.net/forum?id=YicbFdNTTy");
  assert.equal(item.fields.extra, "arXiv: 2010.11929\nCitation Key: dosovitskiy2021");
  assert.equal(item.fields.abstractNote, "While the Transformer architecture...");
  assert.equal(item.fields.DOI, undefined, "the arXiv DOI must not survive as the paper's DOI");
  assert.equal(item.fields.repository, undefined);
  assert.equal(item.creators.length, 12);
  assert.equal(item.saved, 1);
  assert.deepEqual(Zotero.translated, []);
});

test("paper with DOI: Zotero's DOI translator supplies the metadata", async () => {
  const item = resnetItem();
  const { plugin, Zotero } = setup({
    items: [item],
    routes: { [HOSTS.dblp]: dblpRoute("dblp_find_resnet.json", EMPTY_SPARQL) },
    translate: async () => RESNET_TRANSLATED,
  });
  const r = await plugin.processItem(item);

  assert.equal(r.status, "updated");
  assert.deepEqual(Zotero.translated, ["10.1109/CVPR.2016.90"]);
  assert.equal(item.itemType, "conferencePaper");
  assert.equal(item.fields.proceedingsTitle, "2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)");
  assert.equal(item.fields.DOI, "10.1109/CVPR.2016.90");
  assert.equal(item.fields.pages, "770-778");
  assert.equal(item.fields.url, "http://ieeexplore.ieee.org/document/7780459/");
  assert.equal(item.fields.conferenceName, "CVPR2016");
  assert.equal(item.creators.length, 4);
  assert.equal(item.fields.extra, "arXiv: 1512.03385");
  assert.equal(item.fields.abstractNote, "Deeper neural networks are more difficult to train.");
});

test("DOI translator fails: the source's own data is still applied", async () => {
  const item = resnetItem();
  const { plugin } = setup({
    items: [item],
    routes: { [HOSTS.dblp]: dblpRoute("dblp_find_resnet.json", EMPTY_SPARQL) },
    translate: async () => { throw new Error("crossref timeout"); },
  });
  const r = await plugin.processItem(item);
  assert.equal(r.status, "updated");
  assert.equal(item.itemType, "conferencePaper");
  assert.equal(item.fields.DOI, "10.1109/CVPR.2016.90");
  assert.equal(item.fields.url, "https://doi.org/10.1109/CVPR.2016.90");
  assert.match(item.fields.proceedingsTitle, /CVPR 2016/);
});

test("bare DOI that cannot be resolved: item untouched, queued for re-check", async () => {
  const item = resnetItem();
  const before = JSON.stringify(item.fields);
  const { plugin, pending } = setup({
    items: [item],
    routes: { [HOSTS.dblp]: EMPTY_SPARQL, [HOSTS.arxiv]: "arxiv_with_doi.xml" },
    translate: async () => null,
  });
  const r = await plugin.processItem(item);
  assert.equal(r.status, "not_found");
  assert.equal(item.itemType, "preprint");
  assert.equal(JSON.stringify(item.fields), before);
  assert.equal(item.saved, 0);
  assert.deepEqual(pending(), { "1/RESNET01": { lastChecked: NOW } });
});

test("not published yet: item untouched, queued for re-check", async () => {
  const item = vitItem();
  const { plugin, pending } = setup({ items: [item], routes: NOTHING_ANYWHERE });
  const r = await plugin.processItem(item);
  assert.equal(r.status, "not_found");
  assert.equal(item.itemType, "preprint");
  assert.equal(item.saved, 0);
  assert.deepEqual(pending(), { "1/VITKEY01": { lastChecked: NOW } });
});

test("found on a later check: removed from the re-check list", async () => {
  const item = vitItem();
  const { plugin, pending } = setup({
    items: [item],
    routes: { [HOSTS.dblp]: dblpRoute("dblp_find_vit.json", "dblp_authors_vit.json") },
    prefs: {
      "extensions.zoteconf.pending": JSON.stringify({
        "1/VITKEY01": { lastChecked: NOW - 9 * DAY },
        "1/OTHER001": { lastChecked: NOW - DAY },
      }),
    },
  });
  await plugin.processItem(item);
  assert.deepEqual(pending(), { "1/OTHER001": { lastChecked: NOW - DAY } });
});

test("items that are not arXiv preprints are skipped without any request", async () => {
  const published = vitItem({ itemType: "conferencePaper", fields: { title: "X", extra: "arXiv: 2010.11929" } });
  const { plugin, Zotero } = setup({ items: [published] });
  assert.equal((await plugin.processItem(published)).status, "skipped");
  assert.equal(Zotero.fetch.calls.length, 0);
  assert.equal(published.saved, 0);
});

test("item changed by the user while the lookup was running: left alone", async () => {
  const item = vitItem();
  const { plugin } = setup({
    items: [item],
    routes: {
      [HOSTS.dblp]: (url) => {
        item.setType("journalArticle"); // user (or another plugin) converted it meanwhile
        return dblpRoute("dblp_find_vit.json", "dblp_authors_vit.json")(url);
      },
    },
  });
  const r = await plugin.processItem(item);
  assert.equal(r.status, "skipped");
  assert.equal(item.itemType, "journalArticle");
  assert.equal(item.saved, 0);
});

test("item deleted while the lookup was running: left alone", async () => {
  const item = vitItem();
  const { plugin } = setup({
    items: [item],
    routes: {
      [HOSTS.dblp]: (url) => {
        item.deleted = true;
        return dblpRoute("dblp_find_vit.json", "dblp_authors_vit.json")(url);
      },
    },
  });
  assert.equal((await plugin.processItem(item)).status, "skipped");
  assert.equal(item.saved, 0);
});

test("Semantic Scholar API key from prefs is used", async () => {
  const item = vitItem();
  const { plugin, Zotero } = setup({
    items: [item],
    routes: { ...NOTHING_ANYWHERE },
    prefs: { "extensions.zoteconf.s2ApiKey": "k123" },
  });
  await plugin.processItem(item);
  const call = Zotero.fetch.calls.find((c) => c.url.includes(HOSTS.s2));
  assert.equal(call.opts.headers["x-api-key"], "k123");
});

// ---------- automatic trigger on add ----------

const VIT_ROUTES = { [HOSTS.dblp]: dblpRoute("dblp_find_vit.json", "dblp_authors_vit.json") };

test("on add: a freshly added arXiv preprint is converted and the user is told", async () => {
  const item = vitItem();
  const { plugin, notices } = setup({ items: [item], routes: VIT_ROUTES });
  await plugin.notify("add", "item", [1], {});
  assert.equal(item.itemType, "conferencePaper");
  assert.equal(notices.length, 1);
  assert.match(notices[0], /ICLR 2021/);
});

test("on add: nothing is said when the paper is simply not published yet", async () => {
  const item = vitItem();
  const { plugin, notices, pending } = setup({ items: [item], routes: NOTHING_ANYWHERE });
  await plugin.notify("add", "item", [1], {});
  assert.deepEqual(notices, []);
  assert.ok(pending()["1/VITKEY01"]);
});

test("on add: old items arriving through sync are not touched", async () => {
  const item = vitItem({ dateAdded: sqlDate(NOW - 30 * DAY) });
  const { plugin, Zotero } = setup({ items: [item], routes: VIT_ROUTES });
  await plugin.notify("add", "item", [1], {});
  assert.equal(item.itemType, "preprint");
  assert.equal(Zotero.fetch.calls.length, 0);
});

test("on add: disabled by preference", async () => {
  const item = vitItem();
  const { plugin, Zotero } = setup({
    items: [item],
    routes: VIT_ROUTES,
    prefs: { "extensions.zoteconf.autoOnAdd": false },
  });
  await plugin.notify("add", "item", [1], {});
  assert.equal(item.itemType, "preprint");
  assert.equal(Zotero.fetch.calls.length, 0);
});

test("on add: other events, other types and non-arXiv items are ignored", async () => {
  const item = vitItem();
  const other = new FakeItem({ id: 5, key: "K5", itemType: "journalArticle", dateAdded: sqlDate(NOW), fields: { title: "T", publicationTitle: "Nature" } });
  const { plugin, Zotero } = setup({ items: [item, other], routes: VIT_ROUTES });
  await plugin.notify("modify", "item", [1], {});
  await plugin.notify("add", "collection", [1], {});
  await plugin.notify("add", "item", [5, 999], {});
  assert.equal(Zotero.fetch.calls.length, 0);
  assert.equal(item.itemType, "preprint");
});

test("on add: a failure in one item does not stop the next", async () => {
  const bad = vitItem({ id: 7, key: "BAD00001" });
  bad.saveTx = async () => { throw new Error("db locked"); };
  const good = vitItem({ id: 8, key: "GOOD0001" });
  const { plugin } = setup({ items: [bad, good], routes: VIT_ROUTES });
  await plugin.notify("add", "item", [7, 8], {});
  assert.equal(good.itemType, "conferencePaper");
  assert.equal(good.saved, 1);
});

// ---------- manual trigger ----------

test("manual: processes the selection regardless of age and reports a summary", async () => {
  const old = vitItem({ dateAdded: sqlDate(NOW - 400 * DAY) });
  const unpublished = new FakeItem({
    id: 3, key: "GPT40001", itemType: "preprint",
    fields: { title: "GPT-4 Technical Report", url: "https://arxiv.org/abs/2303.08774" },
    creators: [{ name: "OpenAI", creatorType: "author" }],
  });
  const book = new FakeItem({ id: 4, key: "BOOK0001", itemType: "journalArticle", fields: { title: "B", publicationTitle: "Nature" } });
  const { plugin, notices } = setup({
    items: [old, unpublished, book],
    routes: {
      ...NOTHING_ANYWHERE,
      [HOSTS.dblp]: (url) =>
        decodeURIComponent(url).includes("2010.11929") || decodeURIComponent(url).includes("DosovitskiyB0WZ21")
          ? dblpRoute("dblp_find_vit.json", "dblp_authors_vit.json")(url)
          : EMPTY_SPARQL,
    },
  });
  const summary = await plugin.runManual([old, unpublished, book]);
  assert.deepEqual(summary, { updated: 1, notFound: 1, skipped: 1, failed: 0 });
  assert.equal(old.itemType, "conferencePaper");
  assert.equal(unpublished.itemType, "preprint");
  assert.equal(notices.length, 1, "one summary, not one popup per item");
});

// ---------- periodic re-check ----------

test("recheckDue: retries due entries, forgets vanished or already-converted items", async () => {
  const due = vitItem();
  const converted = resnetItem({ itemType: "conferencePaper" });
  const notDue = new FakeItem({ id: 6, key: "NOTDUE01", itemType: "preprint", fields: { title: "Z", url: "https://arxiv.org/abs/2501.00001" } });
  const { plugin, pending, Zotero } = setup({
    items: [due, converted, notDue],
    routes: VIT_ROUTES,
    prefs: {
      "extensions.zoteconf.pending": JSON.stringify({
        "1/VITKEY01": { lastChecked: NOW - 8 * DAY },
        "1/RESNET01": { lastChecked: NOW - 8 * DAY },
        "1/GONE0001": { lastChecked: NOW - 8 * DAY },
        "1/NOTDUE01": { lastChecked: NOW - 1 * DAY },
      }),
    },
  });
  await plugin.recheckDue();
  assert.equal(due.itemType, "conferencePaper");
  assert.deepEqual(pending(), { "1/NOTDUE01": { lastChecked: NOW - 1 * DAY } });
  assert.ok(Zotero.fetch.calls.every((c) => !decodeURIComponent(c.url).includes("2501.00001")));
});

test("pending pref holding garbage does not break anything", async () => {
  const item = vitItem();
  const { plugin, pending } = setup({
    items: [item],
    routes: NOTHING_ANYWHERE,
    prefs: { "extensions.zoteconf.pending": "not json" },
  });
  await plugin.processItem(item);
  assert.deepEqual(Object.keys(pending()), ["1/VITKEY01"]);
});

// ---------- progress bar for manual batches ----------

function setupWithProgress(opts) {
  const Zotero = makeZotero(opts);
  const notices = [];
  const bars = [];
  const plugin = createZoteConf({
    Zotero,
    core,
    delay: async () => {},
    now: () => NOW,
    notifyUser: (text) => notices.push(text),
    createProgress: (total) => {
      const bar = { total, updates: [], finished: [] };
      bars.push(bar);
      return {
        update: (state) => bar.updates.push({ ...state }),
        finish: (text) => bar.finished.push(text),
      };
    },
  });
  return { plugin, notices, bars };
}

function threeItems() {
  const a = vitItem({ id: 21, key: "AAAA0001" });
  const b = new FakeItem({
    id: 22, key: "BBBB0002", itemType: "preprint",
    fields: { title: "GPT-4 Technical Report", url: "https://arxiv.org/abs/2303.08774" },
    creators: [{ name: "OpenAI", creatorType: "author" }],
  });
  const c = vitItem({ id: 23, key: "CCCC0003" });
  c.saveTx = async () => { throw new Error("db locked"); };
  const routes = {
    ...NOTHING_ANYWHERE,
    [HOSTS.dblp]: (url) =>
      /2010\.11929|DosovitskiyB0WZ21/.test(decodeURIComponent(url))
        ? dblpRoute("dblp_find_vit.json", "dblp_authors_vit.json")(url)
        : EMPTY_SPARQL,
  };
  return { items: [a, b, c], routes };
}

test("manual batch: a progress bar advances once per item and ends with the summary", async () => {
  const { items, routes } = threeItems();
  const { plugin, notices, bars } = setupWithProgress({ items, routes });
  const summary = await plugin.runManual(items);

  assert.deepEqual(summary, { updated: 1, notFound: 1, skipped: 0, failed: 1 });
  assert.equal(bars.length, 1);
  const bar = bars[0];
  assert.equal(bar.total, 3);
  assert.deepEqual(bar.updates.map((u) => u.done), [0, 1, 2, 3], "shown at 0 immediately, then one step per item, failures included");
  assert.ok(bar.updates.every((u) => u.total === 3));
  assert.equal(bar.updates[3].updated, 1);
  assert.match(bar.updates[0].title, /An Image is Worth/, "names the item being worked on");
  assert.match(bar.updates[1].title, /GPT-4/);
  assert.equal(bar.finished.length, 1);
  assert.match(bar.finished[0], /1/);
  assert.deepEqual(notices, [], "the bar carries the summary; no second popup");
});

test("manual on a single item: no progress bar, just the result", async () => {
  const item = vitItem();
  const { plugin, notices, bars } = setupWithProgress({ items: [item], routes: VIT_ROUTES });
  await plugin.runManual([item]);
  assert.equal(bars.length, 0);
  assert.equal(notices.length, 1);
});

test("automatic lookups never open a progress bar", async () => {
  const item = vitItem();
  const { plugin, bars } = setupWithProgress({ items: [item], routes: VIT_ROUTES });
  await plugin.notify("add", "item", [1], {});
  assert.equal(bars.length, 0);
});
