#!/bin/bash
# End-to-end check in a throwaway Zotero instance (own profile, own data dir, own port).
# Your real library is never touched. Usage: scripts/e2e.sh <empty-work-dir>
set -euo pipefail
WORK="${1:?usage: e2e.sh <empty-work-dir>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=23129
ZOTERO=/Applications/Zotero.app/Contents/MacOS/zotero

(cd "$ROOT" && npm run -s build >/dev/null)
rm -rf "$WORK/profile"; mkdir -p "$WORK/profile/extensions"
cp "$ROOT"/build/zoteconf-*.xpi "$WORK/profile/extensions/zoteconf@shinmohuang.github.io.xpi"
cat > "$WORK/profile/user.js" <<P
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.zotero.httpServer.port", $PORT);
user_pref("extensions.zotero.httpServer.localAPI.enabled", true);
user_pref("extensions.zotero.firstRunGuidance", false);
user_pref("extensions.zotero.automaticSnapshots", false);
user_pref("extensions.zotero.downloadAssociatedFiles", false);
user_pref("extensions.zotero.sync.autoSync", false);
user_pref("app.update.enabled", false);
user_pref("extensions.logging.enabled", true);
user_pref("browser.dom.window.dump.enabled", true);
user_pref("extensions.zotero.automaticScraperUpdates", false);
P

"$ZOTERO" -profile "$WORK/profile" -datadir profile -no-remote -ZoteroDebugText > "$WORK/zotero.log" 2>&1 &
ZPID=$!
trap 'kill $ZPID 2>/dev/null || true' EXIT

echo "waiting for Zotero (pid $ZPID) on port ${PORT}…"
for i in $(seq 1 90); do
  curl -s -m 2 "http://127.0.0.1:$PORT/connector/ping" >/dev/null 2>&1 && break
  sleep 1
done
grep -q "ZoteConf: started" "$WORK/zotero.log" || { for i in $(seq 1 30); do grep -q "ZoteConf: started" "$WORK/zotero.log" && break; sleep 1; done; }
grep "ZoteConf: started" "$WORK/zotero.log" || { echo "PLUGIN DID NOT START"; grep -E "addons\.|hxm.local" "$WORK/zotero.log" | grep -v "Getting contents" | head -40; exit 1; }

save() { # arxivId title "First Last" ...
  local id="$1" title="$2"; shift 2
  local creators=""
  for n in "$@"; do creators+="{\"firstName\":\"${n% *}\",\"lastName\":\"${n##* }\",\"creatorType\":\"author\"},"; done
  curl -s -o /dev/null -w "save $id: HTTP %{http_code}\n" -X POST "http://127.0.0.1:$PORT/connector/saveItems" \
    -H 'Content-Type: application/json' -H 'X-Zotero-Connector-API-Version: 3' \
    -d "{\"sessionID\":\"e2e-$id-$RANDOM\",\"uri\":\"https://arxiv.org/abs/$id\",\"items\":[{\"itemType\":\"preprint\",\"title\":\"$title\",\"creators\":[${creators%,}],\"abstractNote\":\"ORIGINAL ABSTRACT\",\"url\":\"http://arxiv.org/abs/$id\",\"DOI\":\"10.48550/arXiv.$id\",\"repository\":\"arXiv\",\"archiveID\":\"arXiv:$id\",\"date\":\"2020-01-01\",\"attachments\":[]}]}"
}
save 2010.11929 "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale" "Alexey Dosovitskiy" "Lucas Beyer"
save 2103.14030 "Swin Transformer: Hierarchical Vision Transformer using Shifted Windows" "Ze Liu" "Yutong Lin"
save 2303.08774 "GPT-4 Technical Report" "Open AI"

echo "waiting for lookups…"
for i in $(seq 1 90); do
  n=$(grep -cE "ZoteConf: (arXiv:.* → |no published version)" "$WORK/zotero.log" || true)
  [ "$n" -ge 3 ] && break
  sleep 1
done
sleep 2
curl -s "http://127.0.0.1:$PORT/api/users/0/items?format=json" > "$WORK/items.json"
grep "ZoteConf:" "$WORK/zotero.log" | sed 's/^.*ZoteConf: /  log: /'
python3 - "$WORK/items.json" <<'PY'
import json, sys
for it in json.load(open(sys.argv[1])):
    d = it["data"]
    print("-", d["itemType"], "|", d["title"][:48])
    for k in ("proceedingsTitle", "conferenceName", "publicationTitle", "date", "pages", "DOI", "url", "extra", "repository", "publisher"):
        if d.get(k): print("     %s: %s" % (k, d[k].replace("\n", " ⏎ ")))
    print("     creators: %d (%s …)   abstract kept: %s" % (len(d["creators"]), ", ".join(c.get("lastName") or c.get("name", "") for c in d["creators"][:3]), d.get("abstractNote") == "ORIGINAL ABSTRACT"))
PY
grep -iE "zoteconf.*(error|exception)|error.*zoteconf" "$WORK/zotero.log" | head -5 || true
