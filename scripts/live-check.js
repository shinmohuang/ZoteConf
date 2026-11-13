// Manual smoke test against the real APIs: node scripts/live-check.js [arxivId "Title" "First Author" ...]
const core = require("../src/core.js");

const SAMPLES = [
  ["2010.11929", "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale", "Alexey Dosovitskiy"],
  ["1706.03762", "Attention Is All You Need", "Ashish Vaswani"],
  ["2103.14030", "Swin Transformer: Hierarchical Vision Transformer using Shifted Windows", "Ze Liu"],
  ["1207.7214", "Observation of a new particle in the search for the Standard Model Higgs boson with the ATLAS detector at the LHC", "ATLAS Collaboration"],
  ["2406.09415", "An Image is Worth More Than 16x16 Patches: Exploring Transformers on Individual Pixels", "Duy-Kien Nguyen"],
  ["2303.08774", "GPT-4 Technical Report", "OpenAI"],
];

const fetchImpl = async (url, opts = {}) => {
  const res = await fetch(url, { headers: opts.headers, signal: AbortSignal.timeout(30000) });
  return { status: res.status, text: await res.text() };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const args = process.argv.slice(2);
  const samples = args.length ? [args] : SAMPLES;
  for (const [arxivId, title, ...authors] of samples) {
    const t0 = Date.now();
    const r = await core.findPublished({ arxivId, title, authors }, { fetch: fetchImpl, sleep });
    const c = r.candidate;
    console.log(
      `${arxivId}  ${r.status}` +
        (c ? `  [${c.source}] ${c.venue || c.journalRef || ""} ${c.year || ""} doi=${c.doi || "-"} authors=${(c.authors || []).length}` : "") +
        `  (${Date.now() - t0}ms)` +
        (r.errors.length ? `  errors: ${r.errors.map((e) => e.source + ":" + e.error).join(", ")}` : ""),
    );
  }
})();
