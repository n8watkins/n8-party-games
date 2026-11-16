"""Builds lab/hot-potato/public/cities.json from GeoNames.

Download and unzip, in an empty folder of their own:
  https://download.geonames.org/export/dump/cities15000.zip     -> cities15000.txt
  https://download.geonames.org/export/dump/alternateNamesV2.zip -> alternateNamesV2.txt

Then: python3 -I lab/hot-potato/tools/make-cities.py <cities15000.txt> <alternateNamesV2.txt> <out.json> <date fetched>

Keeps each populated place's name, ASCII name, up to five English alternate names (not historic,
not nicknames; old names such as Bombay are kept), up to two abbreviations (NYC), country code and population, biggest first.
City sections (PPLX) and abandoned or destroyed places are left out.
"""
import json
import sys
import unicodedata

cities_path, alt_path, out_path, fetched = sys.argv[1:5]
SKIP_CODES = {"PPLX", "PPLQ", "PPLW", "PPLH", "PPLCH"}


def letters(s):
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s.lower() if "a" <= c <= "z")


rows = {}
for line in open(cities_path, encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    gid, name, ascii_name, code, cc, pop = f[0], f[1], f[2], f[7], f[8], int(f[14] or 0)
    if code in SKIP_CODES or not letters(ascii_name or name):
        continue
    rows[gid] = {"name": name, "ascii": ascii_name, "cc": cc, "pop": pop, "alts": [], "abbr": []}

for line in open(alt_path, encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    if len(f) < 4 or f[1] not in rows or f[2] not in ("en", "abbr"):
        continue
    preferred, short, colloquial, historic = (f + ["", "", "", ""])[4:8]
    # Old English names are kept (people still say Bombay and Saigon); nicknames are not.
    if colloquial == "1":
        continue
    row, alt = rows[f[1]], f[3].strip()
    if not letters(alt):
        continue
    if f[2] == "abbr":
        if 2 <= len(letters(alt)) <= 5:
            row["abbr"].append(alt)
    else:
        rank = 0 if preferred == "1" else 1 if short == "1" else 3 if historic == "1" else 2
        row["alts"].append((rank, alt))

out = []
for r in sorted(rows.values(), key=lambda r: -r["pop"]):
    seen = {letters(r["name"]), letters(r["ascii"])}
    alts = []
    for _, alt in sorted(r["alts"], key=lambda a: a[0]):
        if letters(alt) not in seen and len(alts) < 5:
            seen.add(letters(alt))
            alts.append(alt)
    abbr = []
    for a in r["abbr"]:
        if letters(a) not in seen and len(abbr) < 2:
            seen.add(letters(a))
            abbr.append(a)
    ascii_name = r["ascii"] if r["ascii"] != r["name"] else 0
    out.append([r["name"], ascii_name, alts or 0, abbr or 0, r["cc"], r["pop"]])

doc = {
    "source": "GeoNames cities15000 and alternateNamesV2, https://www.geonames.org/, CC BY 4.0",
    "fetched": fetched,
    "fields": ["name", "ascii name (0: same as name)", "English alternate names", "abbreviations", "country", "population"],
    "rows": out,
}
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
print(f"{len(out)} places written to {out_path}")
