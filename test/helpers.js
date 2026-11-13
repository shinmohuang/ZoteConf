const fs = require("node:fs");
const path = require("node:path");

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function json(name) {
  return JSON.parse(fixture(name));
}

/**
 * Fake fetch: routes maps a hostname to a fixture name, a {status, text}
 * object, or a function (url, opts) => either of those. Unrouted hosts
 * answer 404. Every call is recorded in fetch.calls.
 */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    const host = new URL(url).hostname;
    let r = routes[host];
    if (typeof r === "function") r = await r(url, opts);
    if (r === undefined) return { status: 404, text: "" };
    if (typeof r === "string") return { status: 200, text: fixture(r) };
    return r;
  };
  fetch.calls = calls;
  fetch.hosts = () => calls.map((c) => new URL(c.url).hostname);
  return fetch;
}

const HOSTS = {
  dblp: "sparql.dblp.org",
  arxiv: "export.arxiv.org",
  s2: "api.semanticscholar.org",
  openalex: "api.openalex.org",
  crossref: "api.crossref.org",
  openreview: "api2.openreview.net",
};

module.exports = { fixture, json, fakeFetch, HOSTS };
