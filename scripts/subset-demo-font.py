"""Rebuild the checked-in demo font: python subset-demo-font.py NotoSansSC-Regular.otf.

Requires fonttools==4.66.1 only when refreshing this fixture, not for normal builds.
See examples/minimal/public/fonts/README.md for source and license.
"""
from pathlib import Path
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
target = root / "examples/minimal/public/fonts/mach-report-demo.otf"
target.parent.mkdir(parents=True, exist_ok=True)
font = TTFont(source)
options = subset.Options()
options.name_IDs = ["*"]
options.name_languages = ["*"]
options.recalc_timestamp = False
subsetter = subset.Subsetter(options=options)
sources = sorted(path for path in (root / "examples/minimal/src").rglob("*")
                 if path.suffix in {".ts", ".vue", ".json"})
text = "\n".join(path.read_text() for path in sources)
subsetter.populate(text=text, unicodes=range(0x20, 0x7F))
subsetter.subset(font)

# A distinct family name clearly identifies this modified subset.
names = {1: "MachReport Demo Sans", 2: "Regular", 3: "MachReportDemoSans-Regular",
         4: "MachReport Demo Sans Regular", 6: "MachReportDemoSans-Regular",
         16: "MachReport Demo Sans", 17: "Regular"}
for record in font["name"].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
if "CFF " in font:
    cff = font["CFF "].cff
    cff.fontNames = ["MachReportDemoSans-Regular"]
    cff.topDictIndex[0].FamilyName = "MachReport Demo Sans"
    cff.topDictIndex[0].FullName = "MachReport Demo Sans Regular"
font.save(target)
print(f"Saved {target}: {target.stat().st_size} bytes")
