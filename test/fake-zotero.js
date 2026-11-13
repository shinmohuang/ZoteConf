// A minimal stand-in for the parts of Zotero that src/plugin.js touches.
const { fakeFetch } = require("./helpers.js");

const COMMON = ["title", "abstractNote", "date", "url", "DOI", "extra", "language", "shortTitle", "accessDate", "rights"];
const VALID = {
  preprint: new Set([...COMMON, "repository", "archiveID", "genre", "place", "series", "seriesNumber", "citationKey"]),
  conferencePaper: new Set([...COMMON, "proceedingsTitle", "conferenceName", "place", "publisher", "volume", "pages", "series", "ISBN"]),
  journalArticle: new Set([...COMMON, "publicationTitle", "volume", "issue", "pages", "journalAbbreviation", "ISSN", "series"]),
};

class FakeItem {
  constructor({ id, key, libraryID = 1, itemType = "preprint", fields = {}, creators = [], dateAdded }) {
    Object.assign(this, { id, key, libraryID, itemType, deleted: false, saved: 0 });
    this.fields = { ...fields };
    this.creators = creators.map((c) => ({ ...c }));
    this.dateAdded = dateAdded;
  }
  get itemTypeID() { return this.itemType; }
  isRegularItem() { return this.itemType !== "attachment" && this.itemType !== "note"; }
  isFeedItem = false;
  getField(name) { return this.fields[name] || ""; }
  setField(name, value) {
    if (!VALID[this.itemType].has(name)) throw new Error(`'${name}' is not a valid field for type ${this.itemType}`);
    if (value === "" || value == null) delete this.fields[name];
    else this.fields[name] = value;
  }
  setType(type) {
    this.itemType = type;
    for (const k of Object.keys(this.fields)) if (!VALID[type].has(k)) delete this.fields[k];
  }
  getCreatorsJSON() { return this.creators.map((c) => ({ ...c })); }
  setCreators(list) { this.creators = list.map((c) => ({ ...c })); }
  async saveTx() { this.saved++; }
}

/**
 * @param routes     host → fixture routes, as in helpers.fakeFetch
 * @param translate  async (doi) => translator item JSON | null (may throw)
 */
function makeZotero({ items = [], routes = {}, prefs = {}, translate = async () => null } = {}) {
  const fetch = fakeFetch(routes);
  const store = new Map(items.map((i) => [i.id, i]));
  const prefStore = {
    "extensions.zoteconf.autoOnAdd": true,
    "extensions.zoteconf.recheckDays": 7,
    "extensions.zoteconf.s2ApiKey": "",
    "extensions.zoteconf.pending": "{}",
    ...prefs,
  };
  const translated = [];

  class Search {
    setIdentifier(id) { this.identifier = id; }
    async getTranslators() { return [{ label: "DOI" }]; }
    setTranslator() {}
    async translate(opts) {
      if (opts.libraryID !== false) throw new Error("translator would have saved a new item");
      translated.push(this.identifier.DOI);
      const item = await translate(this.identifier.DOI);
      return item ? [item] : [];
    }
  }

  const Zotero = {
    fetch,
    translated,
    debug() {},
    logError() {},
    ItemTypes: { getName: (id) => id, getID: (name) => name },
    ItemFields: {
      getID: (name) => (Object.values(VALID).some((s) => s.has(name)) ? name : false),
      isValidForType: (field, type) => VALID[type].has(field),
      getFieldIDFromTypeAndBase: () => false,
    },
    CreatorTypes: { getID: (name) => name, isValidForItemType: () => true },
    Items: {
      get: (id) => store.get(id) || false,
      getByLibraryAndKey: (lib, key) => [...store.values()].find((i) => i.libraryID === lib && i.key === key) || false,
    },
    Libraries: { get: () => ({ editable: true }) },
    Prefs: {
      // second argument "global" must be true: these are full pref names, not extensions.zotero.* ones
      get: (k, global) => { if (!global) throw new Error("pref read without global=true"); return prefStore[k]; },
      set: (k, v, global) => { if (!global) throw new Error("pref write without global=true"); prefStore[k] = v; },
    },
    HTTP: {
      request: async (method, url, options = {}) => {
        const r = await fetch(url, options);
        return { status: r.status, responseText: r.text };
      },
    },
    Translate: { Search },
    Date: { sqlToDate: (s) => (s ? new Date(s.replace(" ", "T") + "Z") : false) },
  };
  return Zotero;
}

module.exports = { FakeItem, makeZotero };
