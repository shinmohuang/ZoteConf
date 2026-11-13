// Packs the plugin into build/zoteconf-<version>.xpi (an .xpi is a plain zip).
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const out = path.join(root, "build", `zoteconf-${version}.xpi`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
execFileSync("zip", ["-r", "-X", out, "manifest.json", "bootstrap.js", "prefs.js", "src", "locale", "content"], {
  cwd: root,
  stdio: "inherit",
});
console.log("built " + path.relative(root, out));
