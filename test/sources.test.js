const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");
const { fixture, json } = require("./helpers.js");

const VIT = {
  arxivId: "2010.11929",
  title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale",
  authors: ["Alexey Dosovitskiy", "Lucas Beyer"],
};
const ATTENTION = {
  arxivId: "1706.03762",
  title: "Attention Is All You Need",
  authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
};
const RESNET = {
  arxivId: "1512.03385",
  title: "Deep Residual Learning for Image Recognition",
  authors: ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
};
const SWIN = {
  arxivId: "2103.14030",
  title: "Swin Transformer: Hierarchical Vision Transformer using Shifted Windows",
  authors: ["Ze Liu", "Yutong Lin", "Yue Cao"],
};
const GPT4 = { arxivId: "2303.08774", title: "GPT-4 Technical Report", authors: ["OpenAI"] };
const PIXELS = {
  arxivId: "2406.09415",
  title: "An Image is Worth More Than 16x16 Patches: Exploring Transformers on Individual Pixels",
  authors: ["Duy-Kien Nguyen", "Mahmoud Assran", "Unnat Jain"],
};

// ---------- DBLP SPARQL ----------

test("dblp query: looks the paper up by arXiv DOI in both casings", () => {
  const q = core.buildDblpFindQuery("2010.11929", VIT.title);
  assert.match(q, /10\.48550\/ARXIV\.2010\.11929/);
  assert.match(q, /10\.48550\/arXiv\.2010\.11929/);
});

test("dblp query: title is lower-cased and escaped so it cannot break the query", () => {
  const q = core.buildDblpFindQuery("2010.11929", 'A "Quoted" \\ Title');
  assert.ok(q.includes('"a \\"quoted\\" \\\\ title."'), q);
});

test("dblp: conference paper without DOI (ViT @ ICLR)", () => {
  const c = core.parseDblpFind(json("dblp_find_vit.json"));
  assert.equal(c.source, "dblp");
  assert.equal(c.kind, "conference");
  assert.equal(c.venue, "ICLR");
  assert.equal(c.year, "2021");
  assert.equal(c.doi, undefined);
  assert.equal(c.url, "https://openreview.net/forum?id=YicbFdNTTy");
  assert.match(c.containerTitle, /^9th International Conference on Learning Representations, ICLR 2021/);
  assert.equal(c.title, VIT.title);
  assert.equal(c.recordUri, "https://dblp.org/rec/conf/iclr/DosovitskiyB0WZ21");
});

test("dblp: conference paper with DOI and pages (ResNet @ CVPR)", () => {
  const c = core.parseDblpFind(json("dblp_find_resnet.json"));
  assert.equal(c.venue, "CVPR");
  assert.equal(c.doi, "10.1109/CVPR.2016.90");
  assert.equal(c.pages, "770-778");
  assert.equal(c.publisher, "IEEE Computer Society");
});

test("dblp: title casing differs between CoRR and proceedings (Attention @ NIPS)", () => {
  const c = core.parseDblpFind(json("dblp_find_attention.json"));
  assert.equal(c.venue, "NIPS");
  assert.equal(c.pages, "5998-6008");
  assert.equal(c.title, "Attention is All you Need");
});

test("dblp: only a CoRR record → not published", () => {
  assert.equal(core.parseDblpFind(json("dblp_find_unpublished.json")), null);
});

test("dblp: CoRR record that DBLP itself marks as a conference paper (Adam @ ICLR)", () => {
  const c = core.parseDblpFind(json("dblp_find_adam.json"));
  assert.equal(c.kind, "conference");
  assert.equal(c.venue, "ICLR");
  assert.equal(c.year, "2015");
  // the only DOI/URL DBLP has is the arXiv one, which must not be presented as the published one
  assert.equal(c.doi, undefined);
  assert.equal(c.url, undefined);
});

test("dblp: empty result set", () => {
  assert.equal(core.parseDblpFind({ results: { bindings: [] } }), null);
});

test("dblp authors: ordered, homonym suffix removed", () => {
  const names = core.parseDblpAuthors(json("dblp_authors_vit.json"));
  assert.equal(names.length, 12);
  assert.equal(names[0], "Alexey Dosovitskiy");
  assert.equal(names[2], "Alexander Kolesnikov");
  assert.equal(names[11], "Neil Houlsby");
});

// ---------- arXiv ----------

test("arxiv: author-supplied DOI and journal reference", () => {
  const r = core.parseArxivAtom(fixture("arxiv_with_doi.xml"));
  assert.equal(r.doi, "10.1016/j.physletb.2012.08.020");
  assert.equal(r.journalRef, "Phys.Lett. B716 (2012) 1-29");
});

test("arxiv: nothing supplied", () => {
  const r = core.parseArxivAtom(fixture("arxiv_no_doi.xml"));
  assert.equal(r.doi, undefined);
  assert.equal(r.journalRef, undefined);
});

// ---------- Semantic Scholar ----------

test("s2: published with DOI (Swin @ ICCV)", () => {
  const c = core.parseS2(json("s2_swin.json"));
  assert.equal(c.source, "semanticscholar");
  assert.equal(c.doi, "10.1109/ICCV48922.2021.00986");
  assert.equal(c.kind, "conference");
  assert.equal(c.venue, "IEEE International Conference on Computer Vision");
  assert.equal(c.pages, "9992-10002");
  assert.equal(c.year, "2021");
});

test("s2: venue known but no DOI", () => {
  const c = core.parseS2(json("s2_venue_only.synthetic.json"));
  assert.equal(c.doi, undefined);
  assert.equal(c.kind, "conference");
  assert.equal(c.venue, "International Conference on Learning Representations");
  // journal.name is "ArXiv" here and must not leak in as the container
  assert.equal(c.containerTitle, undefined);
  assert.equal(c.pages, undefined);
});

test("s2: still only on arXiv", () => {
  assert.equal(core.parseS2(json("s2_unpublished.synthetic.json")), null);
});

// ---------- OpenAlex ----------

test("openalex: published version with DOI (Swin)", () => {
  const c = core.parseOpenAlex(json("openalex_swin.json"), SWIN);
  assert.equal(c.source, "openalex");
  assert.equal(c.doi, "10.1109/iccv48922.2021.00986");
  assert.equal(c.kind, "conference");
  assert.equal(c.pages, "9992-10002");
  assert.equal(c.year, "2021");
});

test("openalex: same-title works by other people are rejected (Attention)", () => {
  // The fixture holds the arXiv record plus a 2025 book chapter and a Zenodo
  // item with the identical title but different authors.
  assert.equal(core.parseOpenAlex(json("openalex_attention.json"), ATTENTION), null);
});

test("openalex: unpublished", () => {
  assert.equal(core.parseOpenAlex(json("openalex_unpublished.json"), GPT4), null);
});

// ---------- Crossref ----------

test("crossref: exact title + authors (ResNet)", () => {
  const c = core.parseCrossref(json("crossref_resnet.json"), RESNET);
  assert.equal(c.source, "crossref");
  assert.equal(c.doi, "10.1109/cvpr.2016.90");
  assert.equal(c.kind, "conference");
});

test("crossref: right title, wrong authors → rejected", () => {
  const other = { ...RESNET, authors: ["Somebody Else", "Another Person"] };
  assert.equal(core.parseCrossref(json("crossref_resnet.json"), other), null);
});

test("crossref: fuzzy hits only → rejected", () => {
  assert.equal(core.parseCrossref(json("crossref_unpublished.json"), GPT4), null);
});

// ---------- OpenReview ----------

test("openreview: accepted paper wins over CoRR mirror and archive copies", () => {
  const c = core.parseOpenReview(json("openreview_pixels.json"), PIXELS);
  assert.equal(c.source, "openreview");
  assert.equal(c.kind, "conference");
  assert.equal(c.venue, "ICLR 2025");
  assert.equal(c.year, "2025");
  assert.equal(c.url, "https://openreview.net/forum?id=tjNf0L8QjR");
  assert.equal(c.containerTitle, "The Thirteenth International Conference on Learning Representations");
  assert.deepEqual(c.authors.slice(0, 2), ["Duy Kien Nguyen", "Mido Assran"]);
});

test("openreview: other papers in the result list are not matched", () => {
  assert.equal(core.parseOpenReview(json("openreview_pixels.json"), VIT), null);
});

function orNote(venue, venueid, extra = {}) {
  return {
    notes: [
      {
        id: "abc",
        content: {
          title: { value: "Some Paper Title" },
          authors: { value: ["Ann Author", "Bob Writer"] },
          venue: { value: venue },
          venueid: { value: venueid },
          ...extra,
        },
      },
    ],
  };
}
const SOME = { arxivId: "2501.00001", title: "Some Paper Title", authors: ["Ann Author", "Bob Writer"] };

test("openreview: submissions, rejections, withdrawals and workshops do not count", () => {
  const rejected = [
    ["Submitted to ICLR 2025", "ICLR.cc/2025/Conference/Submission"],
    ["ICLR 2025 Conference Withdrawn Submission", "ICLR.cc/2025/Conference/Withdrawn_Submission"],
    ["ICLR 2025 Conference Desk Rejected Submission", "ICLR.cc/2025/Conference/Desk_Rejected_Submission"],
    ["UniReps Poster", "NeurIPS.cc/2023/Workshop/UniReps"],
    ["ICLR 2024 Workshop ME-FoMo Poster", "ICLR.cc/2024/Workshop/ME-FoMo"],
    ["CoRR 2024", "dblp.org/journals/CORR/2024"],
    ["arXiV", "OpenReview.net/Archive"],
    ["", ""],
  ];
  for (const [venue, venueid] of rejected) {
    assert.equal(core.parseOpenReview(orNote(venue, venueid), SOME), null, venue);
  }
});

test("openreview: accepted main-track venues count", () => {
  for (const [venue, venueid, short] of [
    ["NeurIPS 2024 spotlight", "NeurIPS.cc/2024/Conference", "NeurIPS 2024"],
    ["ICML 2025 poster", "ICML.cc/2025/Conference", "ICML 2025"],
    ["ICLR 2024 oral", "ICLR.cc/2024/Conference", "ICLR 2024"],
    ["WACV 2025", "dblp.org/conf/WACV/2025", "WACV 2025"],
  ]) {
    const c = core.parseOpenReview(orNote(venue, venueid), SOME);
    assert.ok(c, venue);
    assert.equal(c.venue, short);
  }
});

test("openreview: authors given as objects (fullname)", () => {
  const data = orNote("ICLR 2024 poster", "ICLR.cc/2024/Conference", {
    authors: { value: [{ fullname: "Ann Author" }, { fullname: "Bob Writer" }] },
  });
  const c = core.parseOpenReview(data, SOME);
  assert.deepEqual(c.authors, ["Ann Author", "Bob Writer"]);
});

// ---------- regression: WorkBench (arXiv:2405.00823, published at COLM 2024) ----------

const WORKBENCH = {
  arxivId: "2405.00823",
  title: "WorkBench: a Benchmark Dataset for Agents in a Realistic Workplace Setting",
  authors: ["Olly Styles", "Sam Miller", "Patricio Cerda-Mardini"],
};

test("openalex: a repository copy mis-attributed to an unrelated journal is not a publication", () => {
  // OpenAlex lists the Glasgow eprints copy of this paper under the source
  // "ENLIGHTEN (Jurnal Bimbingan dan Konseling Islam)": no DOI, submittedVersion, is_published=false.
  assert.equal(core.parseOpenAlex(json("openalex_workbench.json"), WORKBENCH), null);
});

test("openalex: a location without a DOI is never trusted, whatever its source says", () => {
  const data = json("openalex_swin.json");
  for (const w of data.results) {
    w.doi = null;
    for (const l of w.locations) l.doi = null;
  }
  assert.equal(core.parseOpenAlex(data, SWIN), null);
});

test("openreview: WorkBench is found at COLM", () => {
  const c = core.parseOpenReview(json("openreview_workbench.json"), WORKBENCH);
  assert.equal(c.venue, "COLM");
  assert.equal(c.year, "2024");
  assert.equal(c.kind, "conference");
  assert.equal(c.containerTitle, "First Conference on Language Modeling");
  assert.equal(c.url, "https://openreview.net/forum?id=4HNAwZFDcH");
});
