const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

// ---------- conferenceAcronym ----------

const ACRONYMS = [
  ["ICML", "ICML"],
  ["NIPS", "NeurIPS"],
  ["ICLR 2025", "ICLR"],
  ["ICLR 2025 Poster", "ICLR"],
  ["CVPR2024", "CVPR"],
  ["ACL/IJCNLP", "ACL"],
  ["ACM Multimedia", "ACM MM"],
  ["2021 IEEE/CVF International Conference on Computer Vision (ICCV)", "ICCV"],
  ["2010 IEEE International Conference on Robotics and Automation (ICRA 2010)", "ICRA"],
  ["International Conference on Machine Learning", "ICML"],
  ["IEEE International Conference on Computer Vision", "ICCV"],
  ["The Thirteenth International Conference on Learning Representations", "ICLR"],
  ["The Thirty-eighth Annual Conference on Neural Information Processing Systems", "NeurIPS"],
  ["Advances in Neural Information Processing Systems 30: Annual Conference on Neural Information Processing Systems 2017, December 4-9, 2017, Long Beach, CA, USA", "NeurIPS"],
  ["9th International Conference on Learning Representations, ICLR 2021, Virtual Event, Austria, May 3-7, 2021", "ICLR"],
  ["First Conference on Language Modeling", "COLM"],
  ["Proceedings of the 62nd Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers)", "ACL"],
  ["Proceedings of the 2023 Conference on Empirical Methods in Natural Language Processing", "EMNLP"],
  ["Findings of the Association for Computational Linguistics: EMNLP 2024", "EMNLP"],
  ["Proceedings of the AAAI Conference on Artificial Intelligence", "AAAI"],
  ["2016 IEEE Conference on Computer Vision and Pattern Recognition, CVPR 2016, Las Vegas, NV, USA, June 27-30, 2016", "CVPR"],
];
for (const [input, expected] of ACRONYMS) {
  test(`conferenceAcronym: ${input.slice(0, 70)} → ${expected}`, () => {
    assert.equal(core.conferenceAcronym(input), expected);
  });
}

test("conferenceAcronym: workshops are not passed off as the main conference", () => {
  for (const s of [
    "2025 IEEE/CVF Conference on Computer Vision and Pattern Recognition Workshops (CVPRW)",
    "ICLR 2025 Workshop on Building Trust in Language Models and Applications",
    "Language Gamification - NeurIPS 2024 Workshop",
  ]) assert.equal(core.conferenceAcronym(s), null, s);
});

test("conferenceAcronym: unknown venues give null", () => {
  for (const s of ["Some Unknown Symposium on Interesting Things", "", undefined]) {
    assert.equal(core.conferenceAcronym(s), null);
  }
});

// ---------- formatConferenceName ----------

test("formatConferenceName: ACRONYM+YEAR without a space", () => {
  assert.equal(core.formatConferenceName("ICML", "2026"), "ICML2026");
  assert.equal(core.formatConferenceName("NeurIPS", "2024"), "NeurIPS2024");
  assert.equal(core.formatConferenceName("COLM", "2024"), "COLM2024");
});

test("formatConferenceName: multi-word acronyms keep a space before the year", () => {
  assert.equal(core.formatConferenceName("ACM MM", "2026"), "ACM MM 2026");
});

test("formatConferenceName: ICLR uses the full name, the only form the rank lookup knows", () => {
  assert.equal(core.formatConferenceName("ICLR", "2025"), "International Conference on Learning Representations");
});

test("formatConferenceName: Findings papers are named as Findings, not as the main conference", () => {
  assert.equal(
    core.formatConferenceName("EMNLP", "2024", { findings: true }),
    "Findings of the Association for Computational Linguistics: EMNLP 2024",
  );
});

test("formatConferenceName: without a year, the acronym alone", () => {
  assert.equal(core.formatConferenceName("ICML", undefined), "ICML");
});

// ---------- in buildItemPatch ----------

const EXISTING = { arxivId: "2401.00001", title: "A Paper", abstractNote: "", extra: "", creators: [] };

test("patch: DBLP acronym venue → ACRONYM+YEAR", () => {
  const p = core.buildItemPatch({ source: "dblp", kind: "conference", title: "A Paper", venue: "ICML", year: "2026" }, EXISTING, null);
  assert.equal(p.fields.conferenceName, "ICML2026");
  assert.equal(p.label, "ICML 2026");
});

test("patch: NIPS is written as NeurIPS", () => {
  const p = core.buildItemPatch({ source: "dblp", kind: "conference", title: "A Paper", venue: "NIPS", year: "2017" }, EXISTING, null);
  assert.equal(p.fields.conferenceName, "NeurIPS2017");
});

test("patch: the DOI translator's long conference name is replaced by the short form", () => {
  const translated = {
    itemType: "conferencePaper",
    title: "A Paper",
    date: "10/2021",
    DOI: "10.1109/ICCV48922.2021.00986",
    conferenceName: "2021 IEEE/CVF International Conference on Computer Vision (ICCV)",
    proceedingsTitle: "2021 IEEE/CVF International Conference on Computer Vision (ICCV)",
  };
  const p = core.buildItemPatch({ source: "crossref", kind: "conference", title: "A Paper", doi: translated.DOI }, EXISTING, translated);
  assert.equal(p.fields.conferenceName, "ICCV2021");
  assert.equal(p.fields.proceedingsTitle, translated.proceedingsTitle, "the full proceedings title is kept");
});

test("patch: long venue name from Semantic Scholar is recognised", () => {
  const p = core.buildItemPatch(
    { source: "semanticscholar", kind: "conference", title: "A Paper", venue: "International Conference on Machine Learning", year: "2024" },
    EXISTING, null);
  assert.equal(p.fields.conferenceName, "ICML2024");
});

test("patch: OpenReview COLM", () => {
  const p = core.buildItemPatch(
    { source: "openreview", kind: "conference", title: "A Paper", venue: "COLM", year: "2024", containerTitle: "First Conference on Language Modeling" },
    EXISTING, null);
  assert.equal(p.fields.conferenceName, "COLM2024");
});

test("patch: unknown conference keeps the name it came with", () => {
  const p = core.buildItemPatch(
    { source: "crossref", kind: "conference", title: "A Paper", venue: "Some Unknown Symposium on Interesting Things", year: "2024" },
    EXISTING, null);
  assert.equal(p.fields.conferenceName, "Some Unknown Symposium on Interesting Things");
});

test("dblp: a Findings venue is flagged, and named as Findings in the patch", () => {
  const row = (venue) => ({
    results: { bindings: [{
      p: { value: "https://dblp.org/rec/conf/emnlp/X23" },
      title: { value: "A Paper." },
      venue: { value: venue },
      year: { value: "2023" },
      type: { value: "http://purl.org/net/nknouf/ns/bibtex#Inproceedings" },
    }] },
  });
  const c = core.parseDblpFind(row("EMNLP (Findings)"));
  assert.equal(c.venue, "EMNLP");
  assert.equal(c.findings, true);
  const p = core.buildItemPatch(c, EXISTING, null);
  assert.equal(p.fields.conferenceName, "Findings of the Association for Computational Linguistics: EMNLP 2023");
  assert.equal(core.parseDblpFind(row("EMNLP (1)")).findings, undefined);
});

// ---------- journals without a DOI ----------

test("patch: DBLP journal abbreviations are expanded so rank lookups recognise them", () => {
  const p = core.buildItemPatch(
    { source: "dblp", kind: "journal", title: "A Paper", venue: "Trans. Mach. Learn. Res.", year: "2024" }, EXISTING, null);
  assert.equal(p.itemType, "journalArticle");
  assert.equal(p.fields.publicationTitle, "Transactions on Machine Learning Research");
  assert.equal(p.fields.journalAbbreviation, "Trans. Mach. Learn. Res.");
  const q = core.buildItemPatch(
    { source: "dblp", kind: "journal", title: "A Paper", venue: "J. Mach. Learn. Res.", year: "2022" }, EXISTING, null);
  assert.equal(q.fields.publicationTitle, "Journal of Machine Learning Research");
});

// ---------- proceedings are conferences ----------

const ASE41 = "Proceedings of the 41st IEEE/ACM International Conference on Automated Software Engineering";

test("conferenceAcronym: software-engineering and other proceedings titles", () => {
  assert.equal(core.conferenceAcronym(ASE41), "ASE");
  assert.equal(core.conferenceAcronym("Proceedings of the 14th ACM SIGSOFT International Symposium on Foundations of Software Engineering"), "FSE");
  assert.equal(core.conferenceAcronym("ISSTA '08: International Symposium on Software Testing and Analysis"), "ISSTA");
  assert.equal(core.conferenceAcronym("Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems"), "CHI");
});

test("isConferenceVenue: proceedings and conference names", () => {
  for (const s of [
    ASE41,
    "International Conference on Machine Learning",
    "Advances in Neural Information Processing Systems",
    "Proceedings of the AAAI Conference on Artificial Intelligence",
    "2018 IEEE Symposium on Security and Privacy (SP)",
    "Proceedings of the 62nd Annual Meeting of the Association for Computational Linguistics",
  ]) assert.equal(core.isConferenceVenue(s), true, s);
});

test("isConferenceVenue: journals, including ones called Proceedings", () => {
  for (const s of [
    "Nature",
    "TMLR",
    "Journal of Machine Learning Research",
    "Proceedings of the National Academy of Sciences",
    "Proceedings of the IEEE",
    "Proceedings of the VLDB Endowment",
    "Proceedings of the ACM on Programming Languages",
    "Proceedings of the Royal Society A",
    "IOP Conference Series: Materials Science and Engineering",
    "",
    undefined,
  ]) assert.equal(core.isConferenceVenue(s), false, String(s));
});

test("patch: a source that calls proceedings a journal still yields a conference paper", () => {
  // Semantic Scholar / OpenAlex routinely type proceedings as journals
  const p = core.buildItemPatch(
    { source: "semanticscholar", kind: "journal", title: "A Paper", venue: ASE41.replace("41st", "37th"), year: "2022", doi: "10.1145/3551349.3556916", pages: "1-13" },
    EXISTING, null);
  assert.equal(p.itemType, "conferencePaper");
  assert.equal(p.fields.proceedingsTitle, ASE41.replace("41st", "37th"));
  assert.equal(p.fields.conferenceName, "ASE2022");
  assert.equal("publicationTitle" in p.fields, false);
});

test("patch: DOI translator typed the proceedings as a journal article (AAAI)", () => {
  const translated = {
    itemType: "journalArticle",
    title: "A Paper",
    publicationTitle: "Proceedings of the AAAI Conference on Artificial Intelligence",
    journalAbbreviation: "AAAI",
    volume: "38",
    issue: "5",
    pages: "100-108",
    date: "2024-03-24",
    DOI: "10.1609/aaai.v38i5.28000",
  };
  const p = core.buildItemPatch({ source: "crossref", kind: "journal", title: "A Paper", doi: translated.DOI }, EXISTING, translated);
  assert.equal(p.itemType, "conferencePaper");
  assert.equal(p.fields.proceedingsTitle, "Proceedings of the AAAI Conference on Artificial Intelligence");
  assert.equal(p.fields.conferenceName, "AAAI2024");
  assert.equal(p.fields.volume, "38");
  assert.equal("publicationTitle" in p.fields, false);
  assert.equal("journalAbbreviation" in p.fields, false);
});

test("patch: translator gives only a proceedings title (ACM) → conference name is derived from it", () => {
  const translated = {
    itemType: "conferencePaper",
    title: "A Paper",
    proceedingsTitle: ASE41,
    date: "2026-10-07",
    DOI: "10.1145/3832783.3837413",
    pages: "1470-1482",
  };
  const p = core.buildItemPatch({ source: "crossref", kind: "conference", title: "A Paper", doi: translated.DOI }, EXISTING, translated);
  assert.equal(p.itemType, "conferencePaper");
  assert.equal(p.fields.conferenceName, "ASE2026");
  assert.equal(p.fields.proceedingsTitle, ASE41);
  assert.equal(p.label, "ASE 2026");
});

test("patch: IEEE DOIs carry the acronym when the name does not", () => {
  const translated = {
    itemType: "conferencePaper",
    title: "A Paper",
    proceedingsTitle: "2020 IEEE 23rd International Conference on Intelligent Transportation Systems",
    date: "2020-09",
    DOI: "10.1109/ITSC45102.2020.9294186",
  };
  const p = core.buildItemPatch({ source: "crossref", kind: "conference", title: "A Paper", doi: translated.DOI }, EXISTING, translated);
  assert.equal(p.fields.conferenceName, "ITSC2020");
});

test("patch: the IEEE DOI hint is not used for workshops or journals", () => {
  const ws = {
    itemType: "conferencePaper", title: "A Paper", date: "2025-06",
    proceedingsTitle: "2025 IEEE/CVF Conference on Computer Vision and Pattern Recognition Workshops",
    DOI: "10.1109/CVPRW67362.2025.00123",
  };
  const p = core.buildItemPatch({ source: "crossref", kind: "conference", title: "A Paper", doi: ws.DOI }, EXISTING, ws);
  assert.equal(p.fields.conferenceName, ws.proceedingsTitle);
  const j = {
    itemType: "journalArticle", title: "A Paper", date: "2020",
    publicationTitle: "IEEE Transactions on Pattern Analysis and Machine Intelligence",
    DOI: "10.1109/TPAMI.2020.2992393",
  };
  const q = core.buildItemPatch({ source: "crossref", kind: "journal", title: "A Paper", doi: j.DOI }, EXISTING, j);
  assert.equal(q.itemType, "journalArticle");
  assert.equal(q.fields.publicationTitle, j.publicationTitle);
  assert.equal("conferenceName" in q.fields, false);
});

test("patch: an unrecognised conference falls back to its proceedings title, so the field is never empty", () => {
  const translated = {
    itemType: "conferencePaper", title: "A Paper", date: "2024",
    proceedingsTitle: "Proceedings of the 9th Symposium on Obscure Topics",
    DOI: "10.1145/1111111.2222222",
  };
  const p = core.buildItemPatch({ source: "crossref", kind: "conference", title: "A Paper", doi: translated.DOI }, EXISTING, translated);
  assert.equal(p.fields.conferenceName, "Proceedings of the 9th Symposium on Obscure Topics");
});

test("patch: a real journal named Proceedings stays a journal article", () => {
  const translated = {
    itemType: "journalArticle", title: "A Paper", date: "2023",
    publicationTitle: "Proceedings of the National Academy of Sciences", volume: "120", issue: "3",
    DOI: "10.1073/pnas.2200000120",
  };
  const p = core.buildItemPatch({ source: "crossref", kind: "journal", title: "A Paper", doi: translated.DOI }, EXISTING, translated);
  assert.equal(p.itemType, "journalArticle");
  assert.equal(p.fields.publicationTitle, "Proceedings of the National Academy of Sciences");
});
