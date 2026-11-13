// Preprints that carry no arXiv identifier (e.g. converted by another tool and
// switched back to "Preprint" by hand, or saved straight from OpenReview).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");
const createZoteConf = require("../src/plugin.js");
const { FakeItem, makeZotero } = require("./fake-zotero.js");
const { fixture, fakeFetch, HOSTS } = require("./helpers.js");

const noSleep = async () => {};
const LOCO = {
  title: "Logically Consistent Language Models via Neuro-Symbolic Integration",
  authors: ["Diego Calanzone", "Stefano Teso", "Antonio Vergari"],
};
const EMPTY_SPARQL = { status: 200, text: '{"results":{"bindings":[]}}' };
const dblpRoute = (find, authors) => (url) => (decodeURIComponent(url).includes("signatureOrdinal") ? authors : find);
// export.arxiv.org serves both the title search and the id lookup
const arxivRoute = (search, byId = "arxiv_no_doi.xml") => (url) => (url.includes("search_query") ? search : byId);

// ---------- core ----------

test("isLookupCandidate: any preprint with a title, with or without an arXiv id", () => {
  assert.equal(core.isLookupCandidate({ itemType: "preprint", title: "T", url: "https://proceedings.iclr.cc/x" }), true);
  assert.equal(core.isLookupCandidate({ itemType: "preprint", title: "T", url: "https://arxiv.org/abs/2010.11929" }), true);
  assert.equal(core.isLookupCandidate({ itemType: "preprint", title: "" }), false);
  assert.equal(core.isLookupCandidate({ itemType: "conferencePaper", title: "T" }), false);
  assert.equal(core.isLookupCandidate({ itemType: "journalArticle", title: "T", publicationTitle: "Nature" }), false);
  assert.equal(core.isLookupCandidate({ itemType: "journalArticle", title: "T", publicationTitle: "arXiv:2010.11929 [cs]" }), true);
});

test("parseArxivSearch: id of the entry whose title and authors match", () => {
  assert.equal(core.parseArxivSearch(fixture("arxiv_search_locolms.xml"), LOCO), "2409.13724");
});

test("parseArxivSearch: picks the exact title among near misses", () => {
  const paper = { title: "Attention Is All You Need", authors: ["Ashish Vaswani"] };
  assert.equal(core.parseArxivSearch(fixture("arxiv_search_attention.xml"), paper), "1706.03762");
});

test("parseArxivSearch: same title by other authors is not accepted", () => {
  const paper = { title: "Attention Is All You Need", authors: ["Jane Doe", "John Roe"] };
  assert.equal(core.parseArxivSearch(fixture("arxiv_search_attention.xml"), paper), null);
});

test("parseArxivSearch: no entries", () => {
  assert.equal(core.parseArxivSearch(fixture("arxiv_no_doi.xml"), { title: "Something Else Entirely", authors: ["A B"] }), null);
});

test("findPublished without an id: resolves it on arXiv first, then runs the normal chain", async () => {
  const fetch = fakeFetch({
    [HOSTS.arxiv]: arxivRoute("arxiv_search_locolms.xml"),
    [HOSTS.dblp]: (url) => {
      assert.match(decodeURIComponent(url), /2409\.13724|signatureOrdinal/);
      return dblpRoute("dblp_find_vit.json", "dblp_authors_vit.json")(url);
    },
  });
  const r = await core.findPublished({ ...LOCO }, { fetch, sleep: noSleep });
  assert.equal(r.status, "found");
  assert.equal(r.arxivId, "2409.13724");
  assert.equal(r.candidate.source, "dblp");
  assert.match(fetch.calls[0].url, /search_query=/);
});

test("findPublished without an id, not on arXiv: only the title-based sources are asked", async () => {
  const fetch = fakeFetch({
    [HOSTS.arxiv]: arxivRoute("arxiv_no_doi.xml"),
    [HOSTS.openalex]: { status: 200, text: '{"results":[]}' },
    [HOSTS.crossref]: { status: 200, text: '{"message":{"items":[]}}' },
    [HOSTS.openreview]: "openreview_workbench.json",
  });
  const paper = {
    title: "WorkBench: a Benchmark Dataset for Agents in a Realistic Workplace Setting",
    authors: ["Olly Styles", "Sam Miller"],
  };
  const r = await core.findPublished(paper, { fetch, sleep: noSleep });
  assert.equal(r.status, "found");
  assert.equal(r.arxivId, undefined);
  assert.equal(r.candidate.venue, "COLM");
  assert.deepEqual(fetch.hosts(), [HOSTS.arxiv, HOSTS.openalex, HOSTS.crossref, HOSTS.openreview]);
});

test("findPublished with an id never does a title search", async () => {
  const fetch = fakeFetch({ [HOSTS.dblp]: dblpRoute("dblp_find_vit.json", "dblp_authors_vit.json") });
  const r = await core.findPublished({ arxivId: "2010.11929", ...LOCO }, { fetch, sleep: noSleep });
  assert.equal(r.arxivId, "2010.11929");
  assert.ok(fetch.calls.every((c) => !c.url.includes("search_query")));
});

// ---------- plugin ----------

const NOW = Date.parse("2026-11-13T12:00:00Z");
const sqlDate = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

function strandedItem(over = {}) {
  return new FakeItem({
    id: 11,
    key: "LOCO0001",
    itemType: "preprint",
    dateAdded: sqlDate(NOW - 5000),
    fields: {
      title: LOCO.title,
      url: "https://proceedings.iclr.cc/paper_files/paper/2025/hash/x-Abstract.html",
      extra: "\u{1F3F7}️ /unread",
    },
    creators: [
      { firstName: "Diego", lastName: "Calanzone", creatorType: "author" },
      { firstName: "Stefano", lastName: "Teso", creatorType: "author" },
    ],
    ...over,
  });
}

function setup(opts) {
  const Zotero = makeZotero(opts);
  const notices = [];
  const plugin = createZoteConf({ Zotero, core, delay: async () => {}, now: () => NOW, notifyUser: (t) => notices.push(t) });
  return { Zotero, plugin, notices, pending: () => JSON.parse(Zotero.Prefs.get("extensions.zoteconf.pending", true)) };
}

const FOUND_ROUTES = {
  [HOSTS.arxiv]: arxivRoute("arxiv_search_locolms.xml"),
  [HOSTS.dblp]: dblpRoute("dblp_find_vit.json", "dblp_authors_vit.json"),
};

test("menu: offered for a preprint that has lost its arXiv id", () => {
  const { plugin } = setup({});
  assert.equal(plugin.isManualCandidate(strandedItem()), true);
  assert.equal(plugin.isManualCandidate(strandedItem({ itemType: "conferencePaper" })), false);
  assert.equal(plugin.isManualCandidate(strandedItem({ itemType: "attachment" })), false);
});

test("manual: such a preprint is resolved, converted, and gets its arXiv id back in Extra", async () => {
  const item = strandedItem();
  const { plugin } = setup({ items: [item], routes: FOUND_ROUTES });
  const summary = await plugin.runManual([item]);
  assert.deepEqual(summary, { updated: 1, notFound: 0, skipped: 0, failed: 0 });
  assert.equal(item.itemType, "conferencePaper");
  assert.equal(item.fields.extra, "arXiv: 2409.13724\n\u{1F3F7}️ /unread");
});

test("manual: not found → stays a preprint and is re-checked later like any other", async () => {
  const item = strandedItem();
  const { plugin, pending, Zotero } = setup({
    items: [item],
    routes: {
      [HOSTS.arxiv]: arxivRoute("arxiv_no_doi.xml"),
      [HOSTS.openalex]: { status: 200, text: '{"results":[]}' },
      [HOSTS.crossref]: { status: 200, text: '{"message":{"items":[]}}' },
      [HOSTS.openreview]: { status: 200, text: '{"notes":[]}' },
    },
  });
  await plugin.runManual([item]);
  assert.equal(item.itemType, "preprint");
  assert.ok(pending()["1/LOCO0001"]);

  // a week later the periodic re-check picks it up again instead of discarding it
  Zotero.Prefs.set("extensions.zoteconf.pending", JSON.stringify({ "1/LOCO0001": { lastChecked: NOW - 8 * 86400000 } }), true);
  const before = Zotero.fetch.calls.length;
  await plugin.recheckDue();
  assert.ok(Zotero.fetch.calls.length > before);
  assert.ok(pending()["1/LOCO0001"]);
});

test("on add: preprints without an arXiv id are still left alone automatically", async () => {
  const item = strandedItem();
  const { plugin, Zotero } = setup({ items: [item], routes: FOUND_ROUTES });
  await plugin.notify("add", "item", [11], {});
  assert.equal(item.itemType, "preprint");
  assert.equal(Zotero.fetch.calls.length, 0);
});
