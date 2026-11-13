<p align="center">
  <img src="content/icons/icon.svg" width="96" height="96" alt="ZoteConf">
</p>

<h1 align="center">ZoteConf</h1>

<p align="center">
  Turn the arXiv preprints in your Zotero library into the papers they were published as.
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>

---

Many papers you save from arXiv have long since appeared at ICML, ACL or CVPR, but the Zotero item still says "Preprint" and you end up looking up the real venue by hand when you cite it. ZoteConf looks up the published version **the moment you add the item**. If it finds one, it updates the item in place to a conference paper or journal article. If the paper is not published yet, it checks again later.

## Features

- **Lookup on add.** A newly added arXiv preprint is checked a few seconds later. When a published version is found, the item is converted and a popup shows `Title → ICML 2025`.
- **In-place update.** Only the item type and metadata change. PDFs, notes, annotations, tags and collections stay, and the arXiv ID is kept in Extra (`arXiv: 2010.11929`).
- **Automatic re-checks.** Papers that are not published yet go on a pending list and are re-checked at most once every 7 days until a published version turns up.
- **Batch processing.** Select any number of existing items, right-click, and choose **Find Published Version**. A progress bar shows where it is.
- **Works without an arXiv ID.** Preprints that lost their ID (converted wrongly by another tool and switched back by hand, or saved straight from OpenReview) are identified by title and authors.
- **Conference names that ranking plugins recognise.** The Conference Name field is written as `ICML2026` or `NeurIPS2024`, so plugins such as Ethereal Style can show CCF ranks.
- **Miss rather than mismatch.** Title-based sources must match on both title and authors. Workshop versions, submissions under review and rejected papers do not count as published.

## Installation

1. Download `zoteconf-x.y.z.xpi` from [Releases](https://github.com/shinmohuang/ZoteConf/releases/latest). In Firefox, right-click the link and choose "Save Link As".
2. In Zotero, open Tools → Plugins, click the gear icon, choose "Install Plugin From File…" and select the file.

Requires Zotero 8–10. No configuration is needed.

> If you also run a plugin that edits the same items, such as [arXiv Workflow](https://github.com/AllanChain/zotero-arxiv-workflow), leave automatic processing on in only one of them.

## Usage

| Situation | What to do |
|---|---|
| A newly added arXiv paper | Nothing |
| Preprints already in your library | Select them (multiple is fine) → right-click → **Find Published Version** |
| An item that was converted wrongly | Change its Item Type back to "Preprint", then right-click and look it up again |

The menu entry appears only when the selection contains at least one item of type Preprint.

### What a converted item looks like

| Field | Content |
|---|---|
| Item Type | Conference Paper or Journal Article |
| Authors | The author list of the published version |
| Conference Name | A short form such as `ICML2026` (rules below) |
| Proceedings Title / Publication | The full name |
| Date, Pages, DOI, Publisher | From the published version |
| URL | The published version (DOI link or OpenReview) |
| Extra | A line `arXiv: <id>` is added; existing content is kept |
| Title, Abstract | Left alone if already present |

## Conference name rules

Ranking plugins such as Ethereal Style send the Conference Name field as-is to easyScholar to look up the CCF rank, so ZoteConf writes it in a form that lookup recognises:

| Case | Written as |
|---|---|
| Most conferences | Acronym plus year, no space: `ICML2026`, `NeurIPS2024`, `CVPR2025` |
| ICLR | `International Conference on Learning Representations` (easyScholar does not recognise the acronym) |
| ACL-family Findings | `Findings of the Association for Computational Linguistics: EMNLP 2024`, so it is not ranked as the main conference |
| Acronym unknown | The acronym embedded in an IEEE DOI if there is one (`10.1109/ITSC45102.…` → `ITSC2020`), otherwise the full proceedings name |

Also:

- **Proceedings are treated as conferences.** A venue such as `Proceedings of the 41st IEEE/ACM International Conference on Automated Software Engineering` becomes a conference paper with the name `ASE2026`, even when the data source files it as a journal article. Real journals that happen to be called Proceedings (PNAS, Proceedings of the IEEE, PVLDB, PACMPL and similar) are not affected.
- DBLP's `NIPS` is written as `NeurIPS`.
- For journals that issue no DOI (JMLR, TMLR), DBLP's abbreviation is expanded to the full journal name.

The acronym table is `KNOWN_CONFERENCES` in [`src/core.js`](src/core.js). Pull requests that add venues are welcome.

## Data sources

Sources are tried in this order, and the first hit wins:

| # | Source | How it is queried |
|---|---|---|
| 1 | [DBLP](https://dblp.org) (SPARQL endpoint) | Locate the CoRR record by arXiv DOI, then find a non-CoRR record with the same authors and title |
| 2 | [arXiv](https://arxiv.org) | The DOI supplied by the authors |
| 3 | [Semantic Scholar](https://www.semanticscholar.org) | By arXiv ID, with backoff on HTTP 429 |
| 4 | [OpenAlex](https://openalex.org) | By title; only publication records with their own DOI are trusted |
| 5 | [Crossref](https://www.crossref.org) | By title |
| 6 | [OpenReview](https://openreview.net) | By title; catches fresh acceptances that nothing else has indexed yet |

When a published DOI is found, full metadata comes from Zotero's own DOI translator. Venues that issue no DOI (ICLR, NeurIPS, COLM and others) use the source's own conference name, proceedings title, year and pages.

The plugin sends only a paper's arXiv ID, its title and the first author's surname to the public APIs above. It collects nothing and needs no account.

## Settings

There is no settings pane yet. Change these in Settings → Advanced → Config Editor:

| Preference | Default | Meaning |
|---|---|---|
| `extensions.zoteconf.autoOnAdd` | `true` | Look up items automatically when they are added |
| `extensions.zoteconf.recheckDays` | `7` | Days between re-checks of an unpublished paper |
| `extensions.zoteconf.s2ApiKey` | empty | Optional [Semantic Scholar API key](https://www.semanticscholar.org/product/api#api-key-form) |

Semantic Scholar rate-limits anonymous requests heavily and often answers 429. The plugin works without a key, since most papers are found at step 1. A key adds one more working source.

## Known limitations

- A paper whose title changed on publication is not found unless DBLP or Semantic Scholar links it to the arXiv version.
- Only main conferences and journals count. A workshop version is never treated as the published one.
- The automatic lookup covers only new items that carry an arXiv ID. Other preprints need the right-click action.
- There is no one-click undo. If a conversion is wrong, change the item type back to Preprint and look it up again.
- Acronyms come from a lookup table plus a few rules, so a less common conference may get only its full name.

If a paper is matched wrongly or not found, please open an [issue](https://github.com/shinmohuang/ZoteConf/issues) with its arXiv ID. For logs, enable Help → Debug Output Logging and search for `ZoteConf:`.

## Development

Plain JavaScript, with no dependencies and no build toolchain.

```sh
npm test                           # unit tests (node:test)
npm run build                      # writes build/zoteconf-<version>.xpi
node scripts/live-check.js         # run the lookup chain against the real APIs
scripts/e2e.sh /tmp/zoteconf-e2e   # end-to-end check in a throwaway Zotero instance (macOS; your library is not touched)
```

| Path | Contents |
|---|---|
| `src/core.js` | Logic that does not need Zotero: identifying items, parsing each source, the lookup chain, conference name rules, building the item update |
| `src/plugin.js` | Zotero glue: triggers, writing items, the pending list, the menu, the progress bar. All dependencies are injected, so it is tested under Node with a fake Zotero |
| `test/fixtures/` | Real API responses (`*.synthetic.json` files are hand-written) |

To fix a bug, save the real API response for the failing paper as a fixture, write a failing test, then change the code.

## Acknowledgements

The idea comes from [zotero-arxiv-workflow](https://github.com/AllanChain/zotero-arxiv-workflow). Thanks to DBLP, arXiv, Semantic Scholar, OpenAlex, Crossref and OpenReview for their open data APIs.

## License

[MIT](LICENSE)
