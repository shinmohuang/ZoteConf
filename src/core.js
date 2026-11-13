/* ZoteConf core: everything that does not need Zotero.
 *
 * Loaded two ways: require() under Node for tests, and
 * Services.scriptloader.loadSubScript() inside Zotero. HTTP is injected as
 *   fetch(url, {headers}) -> Promise<{status, text}>
 * so nothing here touches the network or Zotero directly.
 */
var ZoteConfCore = (function () {
  "use strict";

  // ---------- identifying arXiv preprints ----------

  var ARXIV_ID = "(\\d{4}\\.\\d{4,5}|[a-z][a-z\\-]*(?:\\.[A-Z]{2})?\\/\\d{7})";
  var ID_PATTERNS = [
    ["archiveID", new RegExp("arxiv:\\s*" + ARXIV_ID, "i")],
    ["DOI", new RegExp("10\\.48550\\/arxiv\\." + ARXIV_ID, "i")],
    ["url", new RegExp("arxiv\\.org\\/(?:abs|pdf|html)\\/" + ARXIV_ID, "i")],
    ["extra", new RegExp("arxiv:\\s*" + ARXIV_ID, "i")],
    ["publicationTitle", new RegExp("arxiv:\\s*" + ARXIV_ID, "i")],
  ];

  function extractArxivId(item) {
    for (var i = 0; i < ID_PATTERNS.length; i++) {
      var value = item[ID_PATTERNS[i][0]];
      if (!value) continue;
      var m = String(value).match(ID_PATTERNS[i][1]);
      if (m) return m[1];
    }
    return null;
  }

  function isArxivPreprint(item) {
    if (item.itemType === "preprint") return !!extractArxivId(item);
    // Old Zotero versions saved arXiv papers as journal articles published in "arXiv:xxxx [cs]"
    if (item.itemType === "journalArticle" && /^arxiv/i.test(item.publicationTitle || "")) {
      return !!extractArxivId(item);
    }
    return false;
  }

  /**
   * Can a published version be looked up for this item at all? Wider than
   * isArxivPreprint: a preprint that has lost its arXiv id (converted by another
   * tool and switched back by hand, or saved from OpenReview) still qualifies,
   * and is identified by title and authors instead.
   */
  function isLookupCandidate(item) {
    if (isArxivPreprint(item)) return true;
    return item.itemType === "preprint" && !!normalizeTitle(item.title);
  }

  // ---------- matching ----------

  function fold(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function normalizeTitle(s) {
    return fold(s)
      .replace(/['\u2019`{}$\\]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function cleanName(name) {
    // DBLP disambiguates homonyms as "Lei Zhang 0001"
    return String(name || "")
      .replace(/\s+\d{4}$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function surname(author) {
    var s;
    if (author && typeof author === "object") {
      s = author.lastName || author.name || author.family || "";
    } else {
      s = cleanName(author);
      if (s.indexOf(",") !== -1) s = s.split(",")[0];
    }
    var tokens = fold(s)
      .replace(/[^a-z\s\-]/g, "")
      .trim()
      .split(/\s+/);
    return (tokens[tokens.length - 1] || "").replace(/-/g, "");
  }

  function authorsMatch(a, b) {
    var sa = (a || []).map(surname).filter(Boolean);
    var sb = (b || []).map(surname).filter(Boolean);
    if (!sa.length || !sb.length) return false;
    if (sa[0] === sb[0]) return true;
    var setB = new Set(sb);
    var shared = new Set(sa.filter(function (x) { return setB.has(x); })).size;
    return shared / Math.min(new Set(sa).size, setB.size) >= 0.5;
  }

  var PREPRINT_VENUE = /arxiv|\bcorr\b|rxiv\b|ssrn|preprint|zenodo|research square|openreview archive/i;

  function isPreprintVenue(v) {
    return !v || !String(v).trim() || PREPRINT_VENUE.test(v);
  }

  function cleanDoi(doi) {
    if (!doi) return undefined;
    var d = String(doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
    if (!d || /^10\.48550\//i.test(d)) return undefined;
    return d;
  }

  function sameWork(paper, title, authors) {
    return (
      !!paper.title &&
      normalizeTitle(title) === normalizeTitle(paper.title) &&
      authorsMatch(paper.authors, authors)
    );
  }

  function prune(obj) {
    Object.keys(obj).forEach(function (k) {
      if (obj[k] === undefined || obj[k] === null || obj[k] === "") delete obj[k];
    });
    return obj;
  }

  // ---------- DBLP (SPARQL endpoint; the search API sits behind a bot check) ----------

  function sparqlString(s) {
    return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ") + '"';
  }

  function buildDblpFindQuery(arxivId, title) {
    var t = String(title || "").trim().toLowerCase().replace(/\.$/, "") + ".";
    return [
      "PREFIX dblp: <https://dblp.org/rdf/schema#>",
      "SELECT DISTINCT ?p ?title ?venue ?year ?type ?doi ?pages ?url ?volume ?issue ?procTitle ?publisher WHERE {",
      "  ?corr dblp:doi ?d . FILTER(?d IN (<https://doi.org/10.48550/ARXIV." + arxivId + ">, <https://doi.org/10.48550/arXiv." + arxivId + ">))",
      "  ?corr dblp:title ?ct . ?corr dblp:authoredBy ?a . ?p dblp:authoredBy ?a .",
      "  ?p dblp:title ?title . ?p dblp:yearOfPublication ?year . ?p dblp:bibtexType ?type .",
      "  FILTER(LCASE(STR(?title)) IN (LCASE(STR(?ct)), " + sparqlString(t) + "))",
      "  OPTIONAL { ?p dblp:publishedIn ?venue } OPTIONAL { ?p dblp:doi ?doi } OPTIONAL { ?p dblp:pagination ?pages }",
      "  OPTIONAL { ?p dblp:primaryDocumentPage ?url } OPTIONAL { ?p dblp:publishedInJournalVolume ?volume }",
      "  OPTIONAL { ?p dblp:publishedInJournalVolumeIssue ?issue }",
      "  OPTIONAL { ?p dblp:publishedAsPartOf ?proc . ?proc dblp:title ?procTitle . OPTIONAL { ?proc dblp:publishedBy ?publisher } }",
      "} LIMIT 50",
    ].join("\n");
  }

  function buildDblpAuthorsQuery(recordUri) {
    return [
      "PREFIX dblp: <https://dblp.org/rdf/schema#>",
      "SELECT ?ord ?name WHERE { <" + recordUri + "> dblp:hasSignature ?s .",
      "  ?s dblp:signatureOrdinal ?ord . ?s dblp:signatureDblpName ?name } ORDER BY ?ord",
    ].join("\n");
  }

  function parseDblpFind(data) {
    var rows = (data && data.results && data.results.bindings) || [];
    var candidates = [];
    rows.forEach(function (row) {
      var get = function (k) { return row[k] ? row[k].value : undefined; };
      var rawVenue = get("venue") || "";
      var venue = rawVenue.replace(/\s*\(.*\)\s*$/, "");
      if (isPreprintVenue(venue)) return;
      var type = get("type") || "";
      var kind = /Inproceedings$/.test(type) ? "conference" : /Article$/.test(type) ? "journal" : null;
      if (!kind) return;
      var url = get("url");
      var volume = get("volume");
      candidates.push(prune({
        source: "dblp",
        kind: kind,
        recordUri: get("p"),
        title: (get("title") || "").replace(/\.$/, ""),
        venue: venue,
        findings: /findings/i.test(rawVenue) || undefined,
        year: get("year"),
        doi: cleanDoi(get("doi")),
        pages: get("pages"),
        url: url && !/arxiv/i.test(url) ? url : undefined,
        volume: volume && !/^abs\//.test(volume) ? volume : undefined,
        issue: get("issue"),
        containerTitle: (get("procTitle") || "").replace(/\.$/, ""),
        publisher: get("publisher"),
      }));
    });
    if (!candidates.length) return null;
    // A paper can have both a conference version and a later journal extension:
    // the arXiv preprint corresponds to the conference one, and the earliest.
    candidates.sort(function (x, y) {
      if (x.kind !== y.kind) return x.kind === "conference" ? -1 : 1;
      return Number(x.year) - Number(y.year);
    });
    return candidates[0];
  }

  function parseDblpAuthors(data) {
    var rows = (data && data.results && data.results.bindings) || [];
    return rows
      .map(function (r) { return [Number(r.ord.value), cleanName(r.name.value)]; })
      .sort(function (a, b) { return a[0] - b[0]; })
      .map(function (r) { return r[1]; });
  }

  // ---------- arXiv ----------

  function xmlText(xml, tag) {
    var m = String(xml).match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">"));
    if (!m) return undefined;
    return m[1]
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim() || undefined;
  }

  function parseArxivAtom(xml) {
    return prune({
      doi: cleanDoi(xmlText(xml, "arxiv:doi")),
      journalRef: xmlText(xml, "arxiv:journal_ref"),
    });
  }

  /** arXiv id of the search hit that is the same work as `paper`, or null. */
  function parseArxivSearch(xml, paper) {
    var entries = String(xml).split(/<entry>/).slice(1);
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var id = (entry.match(new RegExp("<id>[^<]*arxiv\\.org\\/abs\\/" + ARXIV_ID)) || [])[1];
      if (!id) continue;
      var authors = (entry.match(/<name>([^<]*)<\/name>/g) || []).map(function (n) { return n.replace(/<\/?name>/g, "").trim(); });
      var title = xmlText(entry, "title");
      var hasAuthors = (paper.authors || []).length > 0;
      var same = hasAuthors
        ? sameWork(paper, title, authors)
        : !!normalizeTitle(paper.title) && normalizeTitle(title) === normalizeTitle(paper.title);
      if (same) return id;
    }
    return null;
  }

  // ---------- Semantic Scholar ----------

  function parseS2(d) {
    if (!d || !d.paperId) return null;
    var doi = cleanDoi(d.externalIds && d.externalIds.DOI);
    var pv = d.publicationVenue || {};
    var venue = d.venue || pv.name || "";
    if (isPreprintVenue(venue)) venue = "";
    if (!doi && !venue) return null;
    var types = d.publicationTypes || [];
    var kind = pv.type === "journal" ? "journal"
      : pv.type === "conference" || types.indexOf("Conference") !== -1 ? "conference"
      : "journal";
    var journal = d.journal || {};
    var hasContainer = !isPreprintVenue(journal.name);
    return prune({
      source: "semanticscholar",
      kind: kind,
      title: d.title,
      venue: venue,
      year: d.year ? String(d.year) : undefined,
      doi: doi,
      containerTitle: hasContainer ? journal.name : undefined,
      pages: hasContainer ? journal.pages : undefined,
      volume: hasContainer ? journal.volume : undefined,
      authors: (d.authors || []).map(function (a) { return a.name; }),
    });
  }

  // ---------- OpenAlex ----------

  function parseOpenAlex(data, paper) {
    var works = (data && data.results) || [];
    for (var i = 0; i < works.length; i++) {
      var w = works[i];
      var authors = (w.authorships || []).map(function (a) { return a.author && a.author.display_name; });
      if (!sameWork(paper, w.title, authors)) continue;
      var locations = w.locations || [];
      for (var j = 0; j < locations.length; j++) {
        var loc = locations[j];
        var src = loc.source || {};
        if (src.type !== "journal" && src.type !== "conference") continue;
        if (isPreprintVenue(src.display_name) || loc.raw_type === "posted-content") continue;
        // OpenAlex sometimes files a repository copy under an unrelated journal. Only a
        // location with its own DOI is trusted; the DOI is then resolved by Zotero itself.
        var doi = cleanDoi(loc.doi);
        if (!doi) continue;
        var b = w.biblio || {};
        var pages = b.first_page
          ? b.last_page && b.last_page !== b.first_page ? b.first_page + "-" + b.last_page : b.first_page
          : undefined;
        return prune({
          source: "openalex",
          kind: src.type,
          title: w.title,
          venue: src.display_name,
          containerTitle: loc.raw_source_name || undefined,
          year: w.publication_year ? String(w.publication_year) : undefined,
          doi: doi,
          pages: pages,
          volume: b.volume || undefined,
          issue: b.issue || undefined,
          authors: authors,
        });
      }
    }
    return null;
  }

  // ---------- Crossref ----------

  var CROSSREF_KINDS = { "proceedings-article": "conference", "journal-article": "journal" };

  function parseCrossref(data, paper) {
    var items = (data && data.message && data.message.items) || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var kind = CROSSREF_KINDS[it.type];
      var doi = cleanDoi(it.DOI);
      var container = (it["container-title"] || [])[0];
      if (!kind || !doi || (container && PREPRINT_VENUE.test(container))) continue;
      var people = it.author || [];
      if (!sameWork(paper, (it.title || [])[0], people.map(function (a) { return { lastName: a.family || a.name }; }))) continue;
      var dp = it.issued && it.issued["date-parts"] && it.issued["date-parts"][0];
      return prune({
        source: "crossref",
        kind: kind,
        title: it.title[0],
        venue: container,
        containerTitle: container,
        year: dp && dp[0] ? String(dp[0]) : undefined,
        doi: doi,
        pages: it.page,
        volume: it.volume,
        issue: it.issue,
        authors: people.map(function (a) { return a.family ? [a.given, a.family].filter(Boolean).join(" ") : a.name; }).filter(Boolean),
      });
    }
    return null;
  }

  // ---------- OpenReview ----------

  var OR_BAD_VENUE = /submitted|submission|rejected|withdrawn|workshop|under review|\bcorr\b|arxiv|preprint/i;
  var OR_BAD_VENUEID = /workshop|archive|public_article|journals\/corr|submission|rejected|withdrawn/i;

  function bibField(bibtex, name) {
    var m = String(bibtex || "").match(new RegExp("\\b" + name + "\\s*=\\s*\\{([^}]*)\\}", "i"));
    return m ? m[1].replace(/\s+/g, " ").trim() : undefined;
  }

  function parseOpenReview(data, paper) {
    var notes = (data && data.notes) || [];
    for (var i = 0; i < notes.length; i++) {
      var note = notes[i];
      var c = note.content || {};
      var val = function (k) { return c[k] && c[k].value !== undefined ? c[k].value : c[k]; };
      var venue = String(val("venue") || "").trim();
      var venueid = String(val("venueid") || "");
      if (!venue || OR_BAD_VENUE.test(venue) || OR_BAD_VENUEID.test(venueid)) continue;
      var authors = (val("authors") || []).map(function (a) {
        return typeof a === "string" ? a : a && (a.fullname || a.name);
      }).filter(Boolean);
      if (!sameWork(paper, val("title"), authors)) continue;
      var bibtex = val("_bibtex") || "";
      var short = venue
        .replace(/^accepted (by|to|at)\s+/i, "")
        .replace(/\s*\(?\b(poster|oral|spotlight|highlight|notable)\b.*$/i, "")
        .trim();
      var year = (venue.match(/\b(?:19|20)\d{2}\b/) || [])[0] || bibField(bibtex, "year");
      var doi = cleanDoi((String(bibField(bibtex, "url") || "").match(/doi\.org\/(.+)$/i) || [])[1]);
      return prune({
        source: "openreview",
        kind: /^\s*@article/i.test(bibtex) ? "journal" : "conference",
        title: String(val("title")).trim(),
        venue: short || venue,
        containerTitle: bibField(bibtex, "booktitle") || bibField(bibtex, "journal"),
        year: year,
        doi: doi,
        pages: bibField(bibtex, "pages"),
        url: doi ? undefined : "https://openreview.net/forum?id=" + (note.forum || note.id),
        authors: authors,
      });
    }
    return null;
  }

  // ---------- lookup chain ----------

  function HttpError(status) {
    var e = new Error("HTTP " + status);
    e.status = status;
    return e;
  }

  async function getJson(fetch, url, headers) {
    var res = await fetch(url, { headers: headers || {} });
    if (res.status !== 200) throw HttpError(res.status);
    return JSON.parse(res.text);
  }

  var S2_FIELDS = "title,venue,year,publicationVenue,externalIds,journal,publicationTypes,publicationDate,authors";
  var S2_BACKOFF = [1500, 4000];

  var SOURCES = [
    {
      name: "dblp",
      needsId: true,
      run: async function (paper, ctx) {
        var endpoint = "https://sparql.dblp.org/sparql?query=";
        var headers = { Accept: "application/sparql-results+json" };
        var found = parseDblpFind(await getJson(
          ctx.fetch, endpoint + encodeURIComponent(buildDblpFindQuery(paper.arxivId, paper.title)), headers));
        if (!found) return null;
        try {
          var names = parseDblpAuthors(await getJson(
            ctx.fetch, endpoint + encodeURIComponent(buildDblpAuthorsQuery(found.recordUri)), headers));
          if (names.length) found.authors = names;
        } catch (e) {
          // the venue is what matters; existing authors are kept
        }
        return found;
      },
    },
    {
      name: "arxiv",
      needsId: true,
      run: async function (paper, ctx) {
        var res = await ctx.fetch("https://export.arxiv.org/api/query?id_list=" + encodeURIComponent(paper.arxivId), { headers: {} });
        if (res.status !== 200) throw HttpError(res.status);
        var info = parseArxivAtom(res.text);
        return info.doi ? prune({ source: "arxiv", doi: info.doi, journalRef: info.journalRef }) : null;
      },
    },
    {
      name: "semanticscholar",
      needsId: true,
      run: async function (paper, ctx) {
        var url = "https://api.semanticscholar.org/graph/v1/paper/ARXIV:" + encodeURIComponent(paper.arxivId) + "?fields=" + S2_FIELDS;
        var headers = ctx.s2ApiKey ? { "x-api-key": ctx.s2ApiKey } : {};
        for (var attempt = 0; ; attempt++) {
          var res = await ctx.fetch(url, { headers: headers });
          if (res.status === 200) return parseS2(JSON.parse(res.text));
          if (res.status === 404) return null;
          if (res.status === 429 && attempt < S2_BACKOFF.length) {
            await ctx.sleep(S2_BACKOFF[attempt]);
            continue;
          }
          throw HttpError(res.status);
        }
      },
    },
    {
      name: "openalex",
      needsTitle: true,
      run: async function (paper, ctx) {
        // commas, colons and pipes are filter syntax in OpenAlex
        var q = String(paper.title).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        return parseOpenAlex(await getJson(ctx.fetch,
          "https://api.openalex.org/works?filter=title.search:" + encodeURIComponent(q) +
          "&select=id,title,doi,type,publication_year,primary_location,locations,biblio,authorships&per-page=10"), paper);
      },
    },
    {
      name: "crossref",
      needsTitle: true,
      run: async function (paper, ctx) {
        var q = paper.title + " " + surname((paper.authors || [])[0] || "");
        return parseCrossref(await getJson(ctx.fetch,
          "https://api.crossref.org/works?query.bibliographic=" + encodeURIComponent(q.trim()) +
          "&rows=5&select=DOI,title,type,container-title,author,issued,page,volume,issue"), paper);
      },
    },
    {
      name: "openreview",
      needsTitle: true,
      run: async function (paper, ctx) {
        return parseOpenReview(await getJson(ctx.fetch,
          "https://api2.openreview.net/notes/search?term=" + encodeURIComponent(paper.title) +
          "&type=terms&content=title&limit=10"), paper);
      },
    },
  ];

  /**
   * @param paper {arxivId?, title, authors: (string|creator)[]} — without arxivId it is
   *        resolved by a title search on arXiv; failing that, only title-based sources run
   * @param ctx {fetch, sleep, s2ApiKey?, log?}
   * @returns {status: "found", candidate, errors, arxivId?} | {status: "not_found", errors, arxivId?}
   */
  async function findPublished(paper, ctx) {
    var errors = [];
    var hasTitle = !!normalizeTitle(paper.title);
    if (!paper.arxivId && hasTitle) {
      // No identifier on the item: find the preprint on arXiv by title and authors
      try {
        var words = String(paper.title).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        var res = await ctx.fetch("https://export.arxiv.org/api/query?search_query=" +
          encodeURIComponent('ti:"' + words + '"') + "&max_results=5", { headers: {} });
        if (res.status !== 200) throw HttpError(res.status);
        var resolved = parseArxivSearch(res.text, paper);
        if (resolved) paper = Object.assign({}, paper, { arxivId: resolved });
      } catch (e) {
        errors.push({ source: "arxiv-search", error: String((e && e.message) || e) });
      }
    }
    for (var i = 0; i < SOURCES.length; i++) {
      var source = SOURCES[i];
      if (source.needsTitle && !hasTitle) continue;
      if (source.needsId && !paper.arxivId) continue;
      try {
        var candidate = await source.run(paper, ctx);
        if (candidate) return { status: "found", candidate: candidate, errors: errors, arxivId: paper.arxivId };
      } catch (e) {
        errors.push({ source: source.name, error: String((e && e.message) || e) });
        if (ctx.log) ctx.log(source.name + " failed: " + e);
      }
    }
    return { status: "not_found", errors: errors, arxivId: paper.arxivId };
  }

  // ---------- venue names ----------
  //
  // Rank plugins (Ethereal Style → easyScholar) look the conference up by the
  // "Conference Name" field, so it has to be a form they recognise:
  // ACRONYM+YEAR ("ICML2026") or a full name.

  var ACRONYM_ALIASES = { NIPS: "NeurIPS" };

  var KNOWN_CONFERENCES = [
    [/^acm multimedia$/i, "ACM MM"],
    [/^interspeech\b/i, "Interspeech"],
    [/neural information processing systems/i, "NeurIPS"],
    [/international conference on learning representations/i, "ICLR"],
    [/international conference on machine learning/i, "ICML"],
    [/computer vision and pattern recognition/i, "CVPR"],
    [/european conference on computer vision/i, "ECCV"],
    [/winter conference on applications of computer vision/i, "WACV"],
    [/international conference on computer vision/i, "ICCV"],
    [/empirical methods in natural language processing/i, "EMNLP"],
    [/(north american|nations of the americas) chapter of the association for computational linguistics/i, "NAACL"],
    [/european chapter of the association for computational linguistics/i, "EACL"],
    [/asia-pacific chapter of the association for computational linguistics/i, "AACL"],
    [/annual meeting of the association for computational linguistics/i, "ACL"],
    [/international conference on computational linguistics/i, "COLING"],
    [/aaai conference on artificial intelligence/i, "AAAI"],
    [/international joint conference on artificial intelligence/i, "IJCAI"],
    [/knowledge discovery and data mining/i, "KDD"],
    [/conference on language modeling/i, "COLM"],
    [/conference on robot learning/i, "CoRL"],
    [/international conference on robotics and automation/i, "ICRA"],
    [/international conference on intelligent robots and systems/i, "IROS"],
    [/robotics: science and systems/i, "RSS"],
    [/artificial intelligence and statistics/i, "AISTATS"],
    [/uncertainty in artificial intelligence/i, "UAI"],
    [/conference on learning theory/i, "COLT"],
    [/research and development in information retrieval/i, "SIGIR"],
    [/the web conference|world wide web conference/i, "WWW"],
    [/web search and data mining/i, "WSDM"],
    [/international conference on multimedia\b/i, "ACM MM"],
    [/acoustics,? speech,? and signal processing/i, "ICASSP"],
    [/international conference on software engineering/i, "ICSE"],
    [/conference on automated software engineering/i, "ASE"],
    [/foundations of software engineering/i, "FSE"],
    [/symposium on software testing and analysis/i, "ISSTA"],
    [/human factors in computing systems/i, "CHI"],
    [/conference on computer and communications security/i, "CCS"],
    [/conference on management of data/i, "SIGMOD"],
    [/automated planning and scheduling/i, "ICAPS"],
    [/conference on human-robot interaction/i, "HRI"],
    [/medical image computing and computer.assisted intervention/i, "MICCAI"],
    [/british machine vision conference/i, "BMVC"],
    [/international conference on data mining/i, "ICDM"],
    [/conference on information and knowledge management/i, "CIKM"],
    [/autonomous agents and multi-?agent systems/i, "AAMAS"],
    [/conference on recommender systems/i, "RecSys"],
    [/international conference on data engineering/i, "ICDE"],
  ];

  // Names the rank lookup only knows in full
  var FULL_NAME_ONLY = { ICLR: "International Conference on Learning Representations" };

  function looksLikeAcronym(token) {
    return (token.match(/[A-Z]/g) || []).length >= 2;
  }

  function canonicalAcronym(token) {
    return ACRONYM_ALIASES[token.toUpperCase()] || token;
  }

  /** "ICLR" from any of the ways a source may name a conference; null if unsure. */
  function conferenceAcronym(name) {
    var s = String(name || "").replace(/\s+/g, " ").trim();
    if (!s || /workshop/i.test(s)) return null;
    var m;
    // "ICML", "ICLR 2025 Poster", "CVPR2024", "ACL/IJCNLP"
    m = s.match(/^([A-Za-z][A-Za-z&\-]{1,11})(?:\/[A-Za-z\-]+)?(?:\s*['\u2019]?(?:\d{4}|\d{2})(?:\s.*)?)?$/);
    if (m && looksLikeAcronym(m[1])) return canonicalAcronym(m[1]);
    // "... Conference on Computer Vision (ICCV)", "(ICRA 2010)"
    m = s.match(/\(([A-Z][A-Za-z&\-]{1,11})(?:[ '\u2019\-]?\d{2,4})?\)\s*$/);
    if (m && looksLikeAcronym(m[1])) return canonicalAcronym(m[1]);
    m = s.match(/findings of the association for computational linguistics:?\s*([A-Z]{3,6})\b/i);
    if (m) return canonicalAcronym(m[1].toUpperCase());
    for (var i = 0; i < KNOWN_CONFERENCES.length; i++) {
      if (KNOWN_CONFERENCES[i][0].test(s)) return KNOWN_CONFERENCES[i][1];
    }
    // DBLP proceedings titles: "..., ICLR 2021, Virtual Event, ..."
    m = s.match(/(?:^|,\s*)([A-Z][A-Za-z&\-]{1,11})\s+(?:19|20)\d{2}\b/);
    if (m && looksLikeAcronym(m[1])) return canonicalAcronym(m[1]);
    return null;
  }

  var CONFERENCE_WORDS = /\b(conference|symposium|workshop|congress|colloquium|annual meeting)\b|neural information processing systems/i;
  // Journals whose names merely sound like proceedings
  var NOT_A_CONFERENCE = /conference series|^proceedings of the (national academy|royal society|vldb endowment|acm on |ieee\s*$)/i;

  /** Is this the name of a conference or of its proceedings (as opposed to a journal)? */
  function isConferenceVenue(name) {
    var s = String(name || "").trim();
    return !!s && CONFERENCE_WORDS.test(s) && !NOT_A_CONFERENCE.test(s);
  }

  function formatConferenceName(acronym, year, opts) {
    if (opts && opts.findings) {
      return "Findings of the Association for Computational Linguistics: " + acronym + (year ? " " + year : "");
    }
    if (FULL_NAME_ONLY[acronym]) return FULL_NAME_ONLY[acronym];
    if (!year) return acronym;
    return acronym + (acronym.indexOf(" ") === -1 ? "" : " ") + year;
  }

  // DBLP abbreviates journal names; journals that issue no DOI never get the full name from Crossref
  var JOURNAL_FULL_NAMES = {
    "j. mach. learn. res.": "Journal of Machine Learning Research",
    "trans. mach. learn. res.": "Transactions on Machine Learning Research",
  };

  // ---------- turning a candidate into an item update ----------

  function mergeExtra(extra, arxivId) {
    extra = String(extra || "").trim();
    if (!arxivId) return extra;
    var present = new RegExp("arxiv:\\s*" + arxivId.replace(/[.\/]/g, "\\$&"), "i").test(extra);
    if (present) return extra;
    return "arXiv: " + arxivId + (extra ? "\n" + extra : "");
  }

  function nameKey(s) {
    return fold(s).replace(/[^a-z]/g, "");
  }

  function mergeCreators(names, existing) {
    var byName = {};
    (existing || []).forEach(function (c) {
      var full = c.name || [c.firstName, c.lastName].filter(Boolean).join(" ");
      byName[nameKey(full)] = c;
    });
    return names.map(function (raw) {
      var name = cleanName(raw);
      if (name.indexOf(",") !== -1) {
        var parts = name.split(",");
        return { firstName: parts.slice(1).join(",").trim(), lastName: parts[0].trim(), creatorType: "author" };
      }
      var known = byName[nameKey(name)];
      if (known) {
        return known.name
          ? { name: known.name, creatorType: "author" }
          : { firstName: known.firstName || "", lastName: known.lastName || "", creatorType: "author" };
      }
      var tokens = name.split(" ");
      if (tokens.length === 1) return { name: name, creatorType: "author" };
      return { firstName: tokens.slice(0, -1).join(" "), lastName: tokens[tokens.length - 1], creatorType: "author" };
    });
  }

  /** Can this candidate be applied without fetching metadata for its DOI? */
  function isSelfSufficient(candidate) {
    return !!(candidate.venue || candidate.containerTitle);
  }

  var NOT_COPIED = new Set([
    "itemType", "creators", "tags", "notes", "attachments", "seeAlso", "collections", "relations",
    "libraryCatalog", "accessDate", "abstractNote", "extra", "title",
    "id", "itemID", "key", "version", "complete",
  ]);

  /**
   * @param candidate result of findPublished
   * @param existing {arxivId, title, abstractNote, extra, creators}
   * @param translated item JSON from Zotero's DOI translator, or null
   * @returns {itemType, fields, creators?, label} — creators undefined means "leave as is";
   *          label is a short human-readable venue for notifications
   */
  function buildItemPatch(candidate, existing, translated) {
    var t = translated || {};
    var fields = {};
    Object.keys(t).forEach(function (k) {
      if (!NOT_COPIED.has(k) && typeof t[k] === "string" && t[k].trim()) fields[k] = t[k];
    });

    var itemType = t.itemType && t.itemType !== "preprint"
      ? t.itemType
      : candidate.kind === "journal" ? "journalArticle" : "conferencePaper";

    // Proceedings are conference publications, even when a source (Semantic Scholar,
    // OpenAlex, Crossref for AAAI/PMLR-style series) files them as journal articles.
    var venueNames = [candidate.venue, t.conferenceName, t.proceedingsTitle, t.publicationTitle, candidate.containerTitle];
    if (itemType === "journalArticle" && venueNames.some(isConferenceVenue)) {
      itemType = "conferencePaper";
      if (fields.publicationTitle && !fields.proceedingsTitle) fields.proceedingsTitle = fields.publicationTitle;
      delete fields.publicationTitle;
      delete fields.journalAbbreviation;
    }

    var fill = function (k, v) { if (!fields[k] && v) fields[k] = v; };
    var label;
    if (itemType === "conferencePaper") {
      fill("proceedingsTitle", candidate.containerTitle || candidate.venue);
      var names = venueNames;
      var acronym = null;
      for (var n = 0; n < names.length && !acronym; n++) acronym = conferenceAcronym(names[n]);
      if (!acronym && !names.some(function (x) { return /workshop/i.test(x || ""); })) {
        // IEEE conference DOIs embed the acronym: 10.1109/ITSC45102.2020.9294186
        var ieee = String(fields.DOI || candidate.doi || "").match(/^10\.1109\/([A-Za-z]{2,12})\d*\./);
        if (ieee) acronym = canonicalAcronym(ieee[1].toUpperCase());
      }
      if (acronym) {
        var year = candidate.year || (String(t.date || candidate.date || "").match(/\b(?:19|20)\d{2}\b/) || [])[0];
        var findings = !!candidate.findings || names.some(function (x) { return /\bfindings\b/i.test(x || ""); });
        // replaces whatever long name the DOI translator supplied
        fields.conferenceName = formatConferenceName(acronym, year, { findings: findings });
        label = acronym + (year ? " " + year : "") + (findings ? " Findings" : "");
      } else {
        // Rank lookups also recognise many full proceedings names; never leave the field empty
        fill("conferenceName", candidate.venue || fields.proceedingsTitle);
      }
      fill("publisher", candidate.publisher);
    } else if (itemType === "journalArticle") {
      var journal = candidate.containerTitle || candidate.venue;
      var fullName = JOURNAL_FULL_NAMES[String(journal || "").toLowerCase()];
      if (fullName) {
        fill("publicationTitle", fullName);
        fill("journalAbbreviation", journal);
      }
      fill("publicationTitle", journal);
      fill("volume", candidate.volume);
      fill("issue", candidate.issue);
    }
    fill("pages", candidate.pages);
    fill("date", candidate.date || candidate.year);
    fill("DOI", candidate.doi);
    fill("url", candidate.url || (fields.DOI ? "https://doi.org/" + fields.DOI : undefined));

    var official = t.title || candidate.title;
    if (official && normalizeTitle(official) !== normalizeTitle(existing.title)) fields.title = official;
    if (!existing.abstractNote && t.abstractNote) fields.abstractNote = t.abstractNote;

    var extra = mergeExtra(existing.extra, existing.arxivId);
    var have = new Set(extra.split("\n"));
    String(t.extra || "").split("\n").forEach(function (line) {
      if (line.trim() && !have.has(line)) extra += (extra ? "\n" : "") + line;
    });
    if (extra) fields.extra = extra;

    var creators;
    if (t.creators && t.creators.length) creators = t.creators;
    else if (candidate.authors && candidate.authors.length) creators = mergeCreators(candidate.authors, existing.creators);

    label = label || fields.conferenceName || fields.proceedingsTitle || fields.publicationTitle || fields.bookTitle || candidate.venue;
    return { itemType: itemType, fields: fields, creators: creators, label: label };
  }

  // ---------- re-check bookkeeping ----------

  function dueEntries(pending, now, intervalDays) {
    var cutoff = now - intervalDays * 86400000;
    return Object.keys(pending || {}).filter(function (k) {
      return !pending[k].lastChecked || pending[k].lastChecked <= cutoff;
    });
  }

  return {
    extractArxivId: extractArxivId,
    isArxivPreprint: isArxivPreprint,
    isLookupCandidate: isLookupCandidate,
    parseArxivSearch: parseArxivSearch,
    normalizeTitle: normalizeTitle,
    surname: surname,
    authorsMatch: authorsMatch,
    isPreprintVenue: isPreprintVenue,
    conferenceAcronym: conferenceAcronym,
    formatConferenceName: formatConferenceName,
    isConferenceVenue: isConferenceVenue,
    buildDblpFindQuery: buildDblpFindQuery,
    buildDblpAuthorsQuery: buildDblpAuthorsQuery,
    parseDblpFind: parseDblpFind,
    parseDblpAuthors: parseDblpAuthors,
    parseArxivAtom: parseArxivAtom,
    parseS2: parseS2,
    parseOpenAlex: parseOpenAlex,
    parseCrossref: parseCrossref,
    parseOpenReview: parseOpenReview,
    findPublished: findPublished,
    mergeExtra: mergeExtra,
    mergeCreators: mergeCreators,
    isSelfSufficient: isSelfSufficient,
    buildItemPatch: buildItemPatch,
    dueEntries: dueEntries,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ZoteConfCore;
}
