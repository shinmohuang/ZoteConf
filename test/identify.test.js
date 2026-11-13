const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

test("extractArxivId: from abs URL, stripping version", () => {
  assert.equal(
    core.extractArxivId({ itemType: "preprint", url: "http://arxiv.org/abs/2010.11929v2" }),
    "2010.11929",
  );
});

test("extractArxivId: from pdf URL", () => {
  assert.equal(core.extractArxivId({ url: "https://arxiv.org/pdf/2103.14030.pdf" }), "2103.14030");
});

test("extractArxivId: from arXiv DOI (any case)", () => {
  assert.equal(core.extractArxivId({ DOI: "10.48550/arXiv.1512.03385" }), "1512.03385");
  assert.equal(core.extractArxivId({ DOI: "10.48550/ARXIV.1512.03385" }), "1512.03385");
});

test("extractArxivId: from archiveID and from Extra", () => {
  assert.equal(core.extractArxivId({ archiveID: "arXiv:1706.03762" }), "1706.03762");
  assert.equal(core.extractArxivId({ extra: "foo: bar\narXiv: 1706.03762 [cs]" }), "1706.03762");
});

test("extractArxivId: old-style identifiers", () => {
  assert.equal(core.extractArxivId({ url: "https://arxiv.org/abs/hep-th/9901001v3" }), "hep-th/9901001");
});

test("extractArxivId: null when there is no arXiv identifier", () => {
  assert.equal(core.extractArxivId({ url: "https://example.org/abs/2010.11929", DOI: "10.1109/CVPR.2016.90" }), null);
  assert.equal(core.extractArxivId({}), null);
});

test("isArxivPreprint: preprint item with arXiv id", () => {
  assert.equal(core.isArxivPreprint({ itemType: "preprint", url: "https://arxiv.org/abs/2010.11929" }), true);
});

test("isArxivPreprint: legacy journalArticle whose publication is arXiv", () => {
  assert.equal(
    core.isArxivPreprint({
      itemType: "journalArticle",
      publicationTitle: "arXiv:2010.11929 [cs]",
      url: "http://arxiv.org/abs/2010.11929",
    }),
    true,
  );
});

test("isArxivPreprint: already-published items are left alone", () => {
  assert.equal(
    core.isArxivPreprint({
      itemType: "conferencePaper",
      proceedingsTitle: "CVPR",
      extra: "arXiv: 1512.03385",
    }),
    false,
  );
  assert.equal(
    core.isArxivPreprint({
      itemType: "journalArticle",
      publicationTitle: "Nature",
      extra: "arXiv: 1512.03385",
    }),
    false,
  );
});

test("isArxivPreprint: non-arXiv preprints and attachments are ignored", () => {
  assert.equal(core.isArxivPreprint({ itemType: "preprint", url: "https://www.biorxiv.org/content/1" }), false);
  assert.equal(core.isArxivPreprint({ itemType: "attachment", url: "https://arxiv.org/pdf/2010.11929" }), false);
});

test("normalizeTitle: case, punctuation, trailing period, LaTeX and accents", () => {
  assert.equal(
    core.normalizeTitle("Attention is All you Need."),
    core.normalizeTitle("Attention Is All You Need"),
  );
  assert.equal(
    core.normalizeTitle("An Image is Worth 16x16 Words:  Transformers for Image Recognition at Scale"),
    core.normalizeTitle("An image is worth 16x16 words — transformers for image recognition at scale."),
  );
  assert.equal(core.normalizeTitle("Schrödinger's {BERT}"), core.normalizeTitle("Schrodingers BERT"));
  assert.notEqual(
    core.normalizeTitle("Attention Is All You Need"),
    core.normalizeTitle("Attention Is All You Need In Speech Separation"),
  );
});

test("surname: 'First Last', 'Last, First', creator objects, DBLP suffix", () => {
  assert.equal(core.surname("Ashish Vaswani"), "vaswani");
  assert.equal(core.surname("Achiam, Josh"), "achiam");
  assert.equal(core.surname({ firstName: "Kaiming", lastName: "He" }), "he");
  assert.equal(core.surname({ name: "OpenAI" }), "openai");
  assert.equal(core.surname("Alexander Kolesnikov 0003"), "kolesnikov");
  assert.equal(core.surname("Beat Döbeli Honegger"), "honegger");
});

test("authorsMatch: same people in different formats", () => {
  assert.equal(
    core.authorsMatch(["Ashish Vaswani", "Noam Shazeer"], [{ lastName: "Vaswani" }, { lastName: "Shazeer" }]),
    true,
  );
});

test("authorsMatch: abbreviated first names still match on surname", () => {
  assert.equal(core.authorsMatch(["Ze Liu", "Yutong Lin", "Yue Cao"], ["Z. Liu", "Y. Lin", "Y. Cao"]), true);
});

test("authorsMatch: same title, different people → no match", () => {
  assert.equal(core.authorsMatch(["Ashish Vaswani", "Noam Shazeer"], ["J. M. Bishop", "Gabriel Seiberth"]), false);
});

test("authorsMatch: cannot confirm when either side is empty", () => {
  assert.equal(core.authorsMatch([], ["A B"]), false);
  assert.equal(core.authorsMatch(["A B"], []), false);
});

test("isPreprintVenue", () => {
  for (const v of ["CoRR", "arXiv.org", "ArXiv", "arXiv (Cornell University)", "bioRxiv", "SSRN Electronic Journal", ""]) {
    assert.equal(core.isPreprintVenue(v), true, v);
  }
  for (const v of ["ICLR", "NIPS", "Nature", "IEEE International Conference on Computer Vision"]) {
    assert.equal(core.isPreprintVenue(v), false, v);
  }
});
