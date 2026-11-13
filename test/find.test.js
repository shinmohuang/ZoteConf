const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");
const { fakeFetch, HOSTS } = require("./helpers.js");

const noSleep = async () => {};

const VIT = {
  arxivId: "2010.11929",
  title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale",
  authors: ["Alexey Dosovitskiy", "Lucas Beyer"],
};
const SWIN = {
  arxivId: "2103.14030",
  title: "Swin Transformer: Hierarchical Vision Transformer using Shifted Windows",
  authors: ["Ze Liu", "Yutong Lin", "Yue Cao"],
};
const RESNET = {
  arxivId: "1512.03385",
  title: "Deep Residual Learning for Image Recognition",
  authors: ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
};
const GPT4 = { arxivId: "2303.08774", title: "GPT-4 Technical Report", authors: ["OpenAI"] };
const HIGGS = { arxivId: "1207.7214", title: "Observation of a new particle", authors: ["ATLAS Collaboration"] };
const PIXELS = {
  arxivId: "2406.09415",
  title: "An Image is Worth More Than 16x16 Patches: Exploring Transformers on Individual Pixels",
  authors: ["Duy-Kien Nguyen", "Mahmoud Assran", "Unnat Jain"],
};

const EMPTY_SPARQL = { status: 200, text: '{"results":{"bindings":[]}}' };
const dblpRoute = (findFixture, authorsFixture) => (url) =>
  decodeURIComponent(url).includes("signatureOrdinal") ? authorsFixture : findFixture;

test("DBLP hit: returns immediately with ordered authors and asks nobody else", async () => {
  const fetch = fakeFetch({
    [HOSTS.dblp]: dblpRoute("dblp_find_vit.json", "dblp_authors_vit.json"),
  });
  const r = await core.findPublished(VIT, { fetch, sleep: noSleep });
  assert.equal(r.status, "found");
  assert.equal(r.candidate.source, "dblp");
  assert.equal(r.candidate.venue, "ICLR");
  assert.equal(r.candidate.authors.length, 12);
  assert.equal(r.candidate.authors[2], "Alexander Kolesnikov");
  assert.deepEqual([...new Set(fetch.hosts())], [HOSTS.dblp]);
});

test("DBLP hit survives a failing author lookup", async () => {
  const fetch = fakeFetch({
    [HOSTS.dblp]: dblpRoute("dblp_find_vit.json", { status: 500, text: "boom" }),
  });
  const r = await core.findPublished(VIT, { fetch, sleep: noSleep });
  assert.equal(r.status, "found");
  assert.equal(r.candidate.venue, "ICLR");
  assert.equal(r.candidate.authors, undefined);
});

test("falls through to the author-supplied DOI on arXiv", async () => {
  const fetch = fakeFetch({
    [HOSTS.dblp]: EMPTY_SPARQL,
    [HOSTS.arxiv]: "arxiv_with_doi.xml",
  });
  const r = await core.findPublished(HIGGS, { fetch, sleep: noSleep });
  assert.equal(r.status, "found");
  assert.equal(r.candidate.source, "arxiv");
  assert.equal(r.candidate.doi, "10.1016/j.physletb.2012.08.020");
  assert.deepEqual(fetch.hosts(), [HOSTS.dblp, HOSTS.arxiv]);
});

test("DBLP down (bot-check HTML) → Semantic Scholar answers", async () => {
  const fetch = fakeFetch({
    [HOSTS.dblp]: { status: 200, text: "<!doctype html><title>Making sure you're not a bot!</title>" },
    [HOSTS.arxiv]: "arxiv_no_doi.xml",
    [HOSTS.s2]: "s2_swin.json",
  });
  const r = await core.findPublished(SWIN, { fetch, sleep: noSleep });
  assert.equal(r.status, "found");
  assert.equal(r.candidate.source, "semanticscholar");
  assert.equal(r.candidate.doi, "10.1109/ICCV48922.2021.00986");
  assert.ok(r.errors.some((e) => e.source === "dblp"));
});

test("Semantic Scholar 429 is retried with backoff, then succeeds", async () => {
  let n = 0;
  const sleeps = [];
  const fetch = fakeFetch({
    [HOSTS.dblp]: EMPTY_SPARQL,
    [HOSTS.arxiv]: "arxiv_no_doi.xml",
    [HOSTS.s2]: () => (++n < 3 ? { status: 429, text: '{"code":"429"}' } : "s2_swin.json"),
  });
  const r = await core.findPublished(SWIN, { fetch, sleep: async (ms) => sleeps.push(ms) });
  assert.equal(r.candidate.source, "semanticscholar");
  assert.equal(n, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[1] > sleeps[0]);
});

test("Semantic Scholar keeps returning 429 → gives up on it and OpenAlex answers", async () => {
  let n = 0;
  const fetch = fakeFetch({
    [HOSTS.dblp]: EMPTY_SPARQL,
    [HOSTS.arxiv]: "arxiv_no_doi.xml",
    [HOSTS.s2]: () => (n++, { status: 429, text: '{"code":"429"}' }),
    [HOSTS.openalex]: "openalex_swin.json",
  });
  const r = await core.findPublished(SWIN, { fetch, sleep: noSleep });
  assert.equal(r.status, "found");
  assert.equal(r.candidate.source, "openalex");
  assert.equal(n, 3);
  assert.ok(r.errors.some((e) => e.source === "semanticscholar" && /429/.test(e.error)));
});

test("Semantic Scholar API key is sent when configured", async () => {
  const fetch = fakeFetch({
    [HOSTS.dblp]: EMPTY_SPARQL,
    [HOSTS.arxiv]: "arxiv_no_doi.xml",
    [HOSTS.s2]: "s2_swin.json",
  });
  await core.findPublished(SWIN, { fetch, sleep: noSleep, s2ApiKey: "secret" });
  const call = fetch.calls.find((c) => c.url.includes(HOSTS.s2));
  assert.equal(call.opts.headers["x-api-key"], "secret");
  assert.match(call.url, /ARXIV:2103\.14030/);
});

test("Crossref answers when the earlier sources have nothing", async () => {
  const fetch = fakeFetch({
    [HOSTS.dblp]: EMPTY_SPARQL,
    [HOSTS.arxiv]: "arxiv_no_doi.xml",
    [HOSTS.s2]: { status: 404, text: "{}" },
    [HOSTS.openalex]: { status: 200, text: '{"results":[]}' },
    [HOSTS.crossref]: "crossref_resnet.json",
  });
  const r = await core.findPublished(RESNET, { fetch, sleep: noSleep });
  assert.equal(r.candidate.source, "crossref");
  assert.equal(r.candidate.doi, "10.1109/cvpr.2016.90");
});

test("OpenReview catches a fresh acceptance nobody else has indexed", async () => {
  const fetch = fakeFetch({
    [HOSTS.dblp]: "dblp_find_unpublished.json",
    [HOSTS.arxiv]: "arxiv_no_doi.xml",
    [HOSTS.s2]: "s2_unpublished.synthetic.json",
    [HOSTS.openalex]: { status: 200, text: '{"results":[]}' },
    [HOSTS.crossref]: { status: 200, text: '{"message":{"items":[]}}' },
    [HOSTS.openreview]: "openreview_pixels.json",
  });
  const r = await core.findPublished(PIXELS, { fetch, sleep: noSleep });
  assert.equal(r.candidate.source, "openreview");
  assert.equal(r.candidate.venue, "ICLR 2025");
});

test("unpublished paper: every source is asked once, result is not_found without errors", async () => {
  const fetch = fakeFetch({
    [HOSTS.dblp]: "dblp_find_unpublished.json",
    [HOSTS.arxiv]: "arxiv_no_doi.xml",
    [HOSTS.s2]: "s2_unpublished.synthetic.json",
    [HOSTS.openalex]: "openalex_unpublished.json",
    [HOSTS.crossref]: "crossref_unpublished.json",
    [HOSTS.openreview]: { status: 200, text: '{"notes":[]}' },
  });
  const r = await core.findPublished(GPT4, { fetch, sleep: noSleep });
  assert.equal(r.status, "not_found");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(fetch.hosts(), [
    HOSTS.dblp,
    HOSTS.arxiv,
    HOSTS.s2,
    HOSTS.openalex,
    HOSTS.crossref,
    HOSTS.openreview,
  ]);
});

test("everything down: not_found, and every failure is reported", async () => {
  const fetch = async () => {
    throw new Error("network down");
  };
  const r = await core.findPublished(GPT4, { fetch, sleep: noSleep });
  assert.equal(r.status, "not_found");
  assert.deepEqual(
    r.errors.map((e) => e.source),
    ["dblp", "arxiv", "semanticscholar", "openalex", "crossref", "openreview"],
  );
  assert.match(r.errors[0].error, /network down/);
});

test("a paper without a title skips the title-based sources", async () => {
  const fetch = fakeFetch({ [HOSTS.dblp]: EMPTY_SPARQL, [HOSTS.arxiv]: "arxiv_no_doi.xml" });
  await core.findPublished({ arxivId: "2303.08774", title: "", authors: [] }, { fetch, sleep: noSleep });
  assert.deepEqual(fetch.hosts(), [HOSTS.dblp, HOSTS.arxiv, HOSTS.s2]);
});

test("regression: WorkBench resolves to COLM via OpenReview, not to OpenAlex's bogus journal", async () => {
  const fetch = fakeFetch({
    [HOSTS.dblp]: EMPTY_SPARQL,
    [HOSTS.arxiv]: "arxiv_no_doi.xml",
    [HOSTS.s2]: { status: 429, text: "{}" },
    [HOSTS.openalex]: "openalex_workbench.json",
    [HOSTS.crossref]: { status: 200, text: '{"message":{"items":[]}}' },
    [HOSTS.openreview]: "openreview_workbench.json",
  });
  const r = await core.findPublished(
    {
      arxivId: "2405.00823",
      title: "WorkBench: a Benchmark Dataset for Agents in a Realistic Workplace Setting",
      authors: ["Olly Styles", "Sam Miller"],
    },
    { fetch, sleep: noSleep },
  );
  assert.equal(r.status, "found");
  assert.equal(r.candidate.source, "openreview");
  assert.equal(r.candidate.venue, "COLM");
});
