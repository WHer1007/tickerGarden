#!/usr/bin/env python3
"""Generate the checked-in regular Phosphor subset used by the V1 web app.

Run from apps/web after installing FontTools in the developer environment.
The scanner intentionally covers source and browser fixtures, including
template-generated `ph-${name}` usages.
"""
import json, re, subprocess, sys
from pathlib import Path

root = Path(__file__).parents[1]
src = root / "src"
package = root / "node_modules/@phosphor-icons/web/src/regular"
out = src / "icons"
out.mkdir(exist_ok=True)
names = set()
for folder in (src, root / "tests/browser"):
    for path in folder.rglob("*"):
        if out not in path.parents and path.is_file() and path.suffix in {".ts", ".js", ".html", ".css"}:
            text = path.read_text(errors="ignore")
            names.update(re.findall(r"ph-([a-z0-9-]+)", text))
            if 'ph-${name}' in text:
                names.update(re.findall(r"icon\(['\"]([a-z0-9-]+)['\"]\)", text))
selection = json.loads((package / "selection.json").read_text())
codes = {i["properties"]["name"]: i["properties"]["code"] for i in selection["icons"]}
# `sprout` was used by the app but is not present in Phosphor 2.1.2; retain
# that class with the closest existing garden glyph.
aliases = {"sprout": "plant"}
missing = sorted(n for n in names if n not in codes and n not in aliases)
if missing:
    raise SystemExit("Missing Phosphor names: " + ", ".join(missing))
resolved = {n: codes[aliases.get(n, n)] for n in names}
(out / "names.txt").write_text("\n".join(sorted(names)) + "\n")
(out / "unicodes.txt").write_text(",".join(f"U+{c:04X}" for c in sorted(set(resolved.values()))) + "\n")
subprocess.run([sys.executable, "-m", "fontTools.subset", str(package / "Phosphor.ttf"),
                "--unicodes-file=" + str(out / "unicodes.txt"), "--flavor=woff2",
                "--output-file=" + str(out / "Phosphor-Regular-Subset.woff2")], check=True)
style = (package / "style.css").read_text()
header = style[:style.index(".ph.ph-")].replace('url("./Phosphor.woff2")', 'url("./Phosphor-Regular-Subset.woff2")')
header = re.sub(r'    url\("\./Phosphor\.(woff|ttf|svg#Phosphor).*?\n', '', header)
header = header.replace('format("woff2"),', 'format("woff2");')
css = header
for name in sorted(names):
    source = aliases.get(name, name)
    match = re.search(rf"\.ph\.ph-{re.escape(source)}:before \{{[^}}]+\}}", style)
    css += "\n" + match.group(0).replace(f"ph-{source}", f"ph-{name}")
(out / "regular.css").write_text(css + "\n")
