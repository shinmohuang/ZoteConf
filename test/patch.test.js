const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

const EXISTING = {
  arxivId: "2010.11929",
  title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale",
  abstractNote: "While the Transformer architecture has become the de-facto standard...",
  extra: "",
  creators: [
    { firstName: "Alexey", lastName: "Dosovitskiy", creatorType: "author" },
    { firstName: "Lucas", lastName: "Beyer", creatorType: "author" },
  ],
};

const DBLP_VIT = {
  source: "dblp",
  kind: "conference",
  title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale",
  venue: "ICLR",
  year: "2021",
  url: "https://openreview.net/forum?id=YicbFdNTTy",
  containerTitle:
    "9th International Conference on Learning Representations, ICLR 2021, Virtual Event, Austria, May 3-7, 2021",
  publisher: "OpenReview.net",
  authors: ["Alexey Dosovitskiy", "Lucas Beyer", "Alexander Kolesnikov"],
};

// ---------- mergeExtra ----------

test("mergeExtra: adds the arXiv id", () => {
  assert.equal(core.mergeExtra("", "2010.11929"), "arXiv: 2010.11929");
  assert.equal(core.mergeExtra("Citation Key: foo2020", "2010.11929"), "arXiv: 2010.11929\nCitation Key: foo2020");
});

test("mergeExtra: does not duplicate an existing arXiv line", () => {
  assert.equal(core.mergeExtra("arXiv:2010.11929 [cs]", "2010.11929"), "arXiv:2010.11929 [cs]");
  assert.equal(core.mergeExtra("x: y\narXiv: 2010.11929", "2010.11929"), "x: y\narXiv: 2010.11929");
});

// ---------- mergeCreators ----------

test("mergeCreators: official order and membership, existing name splits reused", () => {
  const existing = [
    { firstName: "Laurens", lastName: "van der Maaten", creatorType: "author" },
    { firstName: "Geoffrey", lastName: "Hinton", creatorType: "author" },
  ];
  const merged = core.mergeCreators(["Geoffrey Hinton", "Laurens van der Maaten", "New Person"], existing);
  assert.deepEqual(merged, [
    { firstName: "Geoffrey", lastName: "Hinton", creatorType: "author" },
    { firstName: "Laurens", lastName: "van der Maaten", creatorType: "author" },
    { firstName: "New", lastName: "Person", creatorType: "author" },
  ]);
});

test("mergeCreators: single-word names become one-field creators", () => {
  assert.deepEqual(core.mergeCreators(["OpenAI"], []), [{ name: "OpenAI", creatorType: "author" }]);
});

// ---------- buildItemPatch, no translator data ----------

test("patch from DBLP conference record without DOI", () => {
  const p = core.buildItemPatch(DBLP_VIT, EXISTING, null);
  assert.equal(p.itemType, "conferencePaper");
  assert.equal(p.fields.proceedingsTitle, DBLP_VIT.containerTitle);
  assert.equal(p.fields.conferenceName, "International Conference on Learning Representations");
  assert.equal(p.label, "ICLR 2021");
  assert.equal(p.fields.date, "2021");
  assert.equal(p.fields.url, "https://openreview.net/forum?id=YicbFdNTTy");
  assert.equal(p.fields.publisher, "OpenReview.net");
  assert.equal(p.fields.extra, "arXiv: 2010.11929");
  assert.equal(p.creators.length, 3);
  assert.deepEqual(p.creators[2], { firstName: "Alexander", lastName: "Kolesnikov", creatorType: "author" });
});

test("patch never touches the abstract or the title when they are already fine", () => {
  const p = core.buildItemPatch(DBLP_VIT, EXISTING, null);
  assert.equal("abstractNote" in p.fields, false);
  assert.equal("title" in p.fields, false);
});

test("patch takes the official title when it really differs", () => {
  const c = { ...DBLP_VIT, title: "ViT: Transformers for Image Recognition at Scale" };
  assert.equal(core.buildItemPatch(c, EXISTING, null).fields.title, "ViT: Transformers for Image Recognition at Scale");
});

test("patch keeps existing creators when the source has no author list", () => {
  const c = { ...DBLP_VIT, authors: undefined };
  assert.equal(core.buildItemPatch(c, EXISTING, null).creators, undefined);
});

test("patch for a journal article", () => {
  const c = {
    source: "dblp",
    kind: "journal",
    title: EXISTING.title,
    venue: "J. Mach. Learn. Res.",
    year: "2022",
    volume: "23",
    issue: "1",
    pages: "1-48",
    doi: "10.5555/1234",
  };
  const p = core.buildItemPatch(c, EXISTING, null);
  assert.equal(p.itemType, "journalArticle");
  assert.equal(p.fields.publicationTitle, "Journal of Machine Learning Research");
  assert.equal(p.fields.journalAbbreviation, "J. Mach. Learn. Res.");
  assert.equal(p.fields.volume, "23");
  assert.equal(p.fields.issue, "1");
  assert.equal(p.fields.pages, "1-48");
  assert.equal(p.fields.DOI, "10.5555/1234");
  assert.equal(p.fields.url, "https://doi.org/10.5555/1234");
  assert.equal("conferenceName" in p.fields, false);
});

test("patch from a long venue name (S2/OpenAlex) and from an acronym that already carries its year", () => {
  const c = {
    source: "semanticscholar",
    kind: "conference",
    title: EXISTING.title,
    venue: "International Conference on Learning Representations",
    year: "2021",
  };
  const p = core.buildItemPatch(c, EXISTING, null);
  assert.equal(p.fields.proceedingsTitle, "International Conference on Learning Representations");
  assert.equal(p.fields.conferenceName, "International Conference on Learning Representations");
  const c2 = { ...c, source: "openreview", venue: "ICLR 2025", year: "2025" };
  assert.equal(core.buildItemPatch(c2, EXISTING, null).fields.conferenceName, "International Conference on Learning Representations");
  const c3 = { ...c, source: "openreview", venue: "ICML 2025", year: "2025" };
  assert.equal(core.buildItemPatch(c3, EXISTING, null).fields.conferenceName, "ICML2025");
});

// ---------- buildItemPatch with translator (DOI) data ----------

const TRANSLATED = {
  itemType: "conferencePaper",
  title: "Deep Residual Learning for Image Recognition",
  creators: [
    { firstName: "Kaiming", lastName: "He", creatorType: "author" },
    { firstName: "Xiangyu", lastName: "Zhang", creatorType: "author" },
  ],
  date: "2016-06",
  DOI: "10.1109/CVPR.2016.90",
  pages: "770-778",
  proceedingsTitle: "2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
  conferenceName: "2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
  publisher: "IEEE",
  place: "Las Vegas, NV, USA",
  url: "http://ieeexplore.ieee.org/document/7780459/",
  abstractNote: "",
  libraryCatalog: "DOI.org (Crossref)",
  accessDate: "2026-11-13",
  tags: [],
  notes: [],
  attachments: [],
};
const RESNET_EXISTING = {
  arxivId: "1512.03385",
  title: "Deep Residual Learning for Image Recognition",
  abstractNote: "Deeper neural networks are more difficult to train.",
  extra: "",
  creators: [{ firstName: "Kaiming", lastName: "He", creatorType: "author" }],
};
const DBLP_RESNET = {
  source: "dblp",
  kind: "conference",
  title: "Deep Residual Learning for Image Recognition",
  venue: "CVPR",
  year: "2016",
  doi: "10.1109/CVPR.2016.90",
  pages: "770-778",
  authors: ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
};

test("translator data is the base; official creators come from it", () => {
  const p = core.buildItemPatch(DBLP_RESNET, RESNET_EXISTING, TRANSLATED);
  assert.equal(p.itemType, "conferencePaper");
  assert.equal(p.fields.proceedingsTitle, TRANSLATED.proceedingsTitle);
  assert.equal(p.fields.date, "2016-06");
  assert.equal(p.fields.place, "Las Vegas, NV, USA");
  assert.equal(p.fields.DOI, "10.1109/CVPR.2016.90");
  assert.equal(p.fields.url, "http://ieeexplore.ieee.org/document/7780459/");
  assert.deepEqual(p.creators, TRANSLATED.creators);
  assert.equal(p.fields.extra, "arXiv: 1512.03385");
});

test("translator bookkeeping fields and empty values are not copied", () => {
  const p = core.buildItemPatch(DBLP_RESNET, RESNET_EXISTING, TRANSLATED);
  for (const k of ["libraryCatalog", "accessDate", "tags", "notes", "attachments", "itemType", "creators", "abstractNote"]) {
    assert.equal(k in p.fields, false, k);
  }
});

test("translator abstract is used only when the item has none", () => {
  const t = { ...TRANSLATED, abstractNote: "Official abstract." };
  assert.equal("abstractNote" in core.buildItemPatch(DBLP_RESNET, RESNET_EXISTING, t).fields, false);
  const blank = { ...RESNET_EXISTING, abstractNote: "" };
  assert.equal(core.buildItemPatch(DBLP_RESNET, blank, t).fields.abstractNote, "Official abstract.");
});

test("candidate fills what the translator left out", () => {
  const t = { ...TRANSLATED, pages: "", creators: [] };
  const p = core.buildItemPatch(DBLP_RESNET, RESNET_EXISTING, t);
  assert.equal(p.fields.pages, "770-778");
  assert.equal(p.creators.length, 4);
});

test("a translator result that is itself a preprint is not trusted for the item type", () => {
  const t = { ...TRANSLATED, itemType: "preprint" };
  assert.equal(core.buildItemPatch(DBLP_RESNET, RESNET_EXISTING, t).itemType, "conferencePaper");
});

test("translator extra is merged, keeping the user's extra and the arXiv id", () => {
  const p = core.buildItemPatch(DBLP_RESNET, { ...RESNET_EXISTING, extra: "Citation Key: he2016" }, { ...TRANSLATED, extra: "ISSN: 1063-6919" });
  assert.equal(p.fields.extra, "arXiv: 1512.03385\nCitation Key: he2016\nISSN: 1063-6919");
});

// ---------- needsTranslator ----------

test("needsMetadataLookup: a bare DOI (arXiv source) cannot be applied on its own", () => {
  assert.equal(core.isSelfSufficient({ source: "arxiv", doi: "10.1/x" }), false);
  assert.equal(core.isSelfSufficient(DBLP_VIT), true);
});

// ---------- pending re-check bookkeeping ----------

test("dueEntries: only entries older than the interval", () => {
  const day = 86400000;
  const now = 100 * day;
  const pending = {
    "1/AAAA": { lastChecked: now - 8 * day },
    "1/BBBB": { lastChecked: now - 2 * day },
    "1/CCCC": { lastChecked: now - 7 * day },
  };
  assert.deepEqual(core.dueEntries(pending, now, 7).sort(), ["1/AAAA", "1/CCCC"]);
  assert.deepEqual(core.dueEntries({}, now, 7), []);
});

test("an acronym venue without a year gets the year appended, whatever the source", () => {
  const c = {
    source: "openreview",
    kind: "conference",
    title: EXISTING.title,
    venue: "COLM",
    year: "2024",
    containerTitle: "First Conference on Language Modeling",
  };
  const p = core.buildItemPatch(c, EXISTING, null);
  assert.equal(p.fields.conferenceName, "COLM2024");
  assert.equal(p.fields.proceedingsTitle, "First Conference on Language Modeling");
});
