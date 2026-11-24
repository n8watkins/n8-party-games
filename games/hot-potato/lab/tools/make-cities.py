"""Builds games/hot-potato/shared/cities.json from GeoNames: every town over 15,000 people (the
wider list, "Also allow lesser-known cities"), each marked with why it is, or is not, in the default list of well-known places.

Download and unzip, in an empty folder of their own:
  https://download.geonames.org/export/dump/cities15000.zip     -> cities15000.txt
  https://download.geonames.org/export/dump/cities500.zip       -> cities500.txt (for famous small towns)
  https://download.geonames.org/export/dump/alternateNamesV2.zip -> alternateNamesV2.txt
  https://download.geonames.org/export/dump/admin1CodesASCII.txt
  https://download.geonames.org/export/dump/countryInfo.txt
and build shared/words.json first (tools/make-words.py).

Then: python3 -I games/hot-potato/lab/tools/make-cities.py <geonames folder> <words.json> <famous-places.txt> <out.json> <date fetched>

Each place keeps its name, ASCII name, up to five English alternate names (not nicknames; old
names such as Bombay are kept), up to two abbreviations (NYC), country code, population, why it is
well known, and its state or province. City sections (PPLX),
numbered districts and abandoned or destroyed places are left out, except the hand-listed famous places.

Well known (the default list), "why":
  c  a national capital or seat of government (GeoNames PPLC, PPLG)
  s  a US state, Canadian province or Australian state capital (PPLA in US, CA, AU)
  f  on the hand list tools/famous-places.txt
  p  100,000 people or more
  0  none of these: lesser known (only in the wider list)
A place whose name is also an ordinary English word (Orange, Surprise, Independence) must be a
capital, on the hand list, or have 250,000 people or more; otherwise it is lesser known.
"""
import json
import os
import sys
import unicodedata

geo_dir, words_path, famous_path, out_path, fetched = sys.argv[1:6]
SKIP_CODES = {"PPLX", "PPLQ", "PPLW", "PPLH", "PPLCH"}
POPULATION_FLOOR = 100000
WORD_NAME_FLOOR = 250000
STATE_CAPITAL_COUNTRIES = {"US", "CA", "AU"}


def letters(s):
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s.lower() if "a" <= c <= "z")


def norm(s):
    s = unicodedata.normalize("NFD", s).lower()
    s = "".join(c if "a" <= c <= "z" or c.isdigit() else " " for c in s if not unicodedata.combining(c))
    return " ".join(s.split())


ordinary = set(json.load(open(words_path, encoding="utf-8"))["words"])

regions = {}
for line in open(os.path.join(geo_dir, "admin1CodesASCII.txt"), encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    if len(f) >= 2:
        regions[f[0]] = f[1]

country_names = {}
for line in open(os.path.join(geo_dir, "countryInfo.txt"), encoding="utf-8"):
    if line.startswith("#"):
        continue
    f = line.rstrip("\n").split("\t")
    if len(f) > 4:
        country_names[f[0]] = f[4]


def parse(line):
    f = line.rstrip("\n").split("\t")
    return {
        "gid": f[0], "name": f[1], "ascii": f[2], "altnames": f[3], "code": f[7], "cc": f[8],
        "admin1": f[10], "pop": int(f[14] or 0), "alts": [], "abbr": [], "why": "",
    }


rows = {}
for line in open(os.path.join(geo_dir, "cities15000.txt"), encoding="utf-8"):
    r = parse(line)
    # Numbered districts ("Paris 11 Popincourt") are never said aloud.
    if r["code"] in SKIP_CODES or not letters(r["ascii"] or r["name"]) or any(c.isdigit() for c in r["name"]):
        continue
    rows[r["gid"]] = r

# The hand list, looked up among all places over 500 people: the biggest place of that name in
# that country (by its name, ASCII name or any alternate name).
wanted = {}
for line in open(famous_path, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    name, cc = line.split("|")
    wanted[(norm(name), cc)] = None
for line in open(os.path.join(geo_dir, "cities500.txt"), encoding="utf-8"):
    r = parse(line)
    if r["code"] in ("PPLQ", "PPLW", "PPLH", "PPLCH"):
        continue
    keys = {norm(r["name"]), norm(r["ascii"])} | {norm(a) for a in r["altnames"].split(",") if a}
    for k in keys:
        if (k, r["cc"]) in wanted:
            best = wanted[(k, r["cc"])]
            if best is None or r["pop"] > best["pop"]:
                wanted[(k, r["cc"])] = r
missing = [f"{k[0]}|{k[1]}" for k, v in wanted.items() if v is None]
if missing:
    sys.exit(f"famous places not found in cities500: {', '.join(missing)}")
famous = set()
for r in wanted.values():
    rows.setdefault(r["gid"], r)
    famous.add(r["gid"])

for line in open(os.path.join(geo_dir, "alternateNamesV2.txt"), encoding="utf-8"):
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


def why(r):
    capital = r["code"] in ("PPLC", "PPLG")
    state = r["code"] == "PPLA" and r["cc"] in STATE_CAPITAL_COUNTRIES
    word_name = norm(r["name"]) in ordinary or norm(r["ascii"]) in ordinary
    if capital:
        return "c"
    if state:
        return "s"
    if r["gid"] in famous:
        return "f"
    floor = WORD_NAME_FLOOR if word_name else POPULATION_FLOOR
    return "p" if r["pop"] >= floor else 0


out = []
used_countries = set()
region_list, region_ids = [], {}
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
    w = why(r)
    region = regions.get(f"{r['cc']}.{r['admin1']}")
    if region and region not in region_ids:
        region_ids[region] = len(region_list) + 1
        region_list.append(region)
    used_countries.add(r["cc"])
    out.append([r["name"], ascii_name, alts or 0, abbr or 0, r["cc"], r["pop"], w, region_ids.get(region, 0)])

doc = {
    "source": "GeoNames cities15000, cities500 (hand-listed famous places), alternateNamesV2, admin1CodesASCII and countryInfo, https://www.geonames.org/, CC BY 4.0",
    "fetched": fetched,
    "fields": [
        "name", "ascii name (0: same as name)", "English alternate names", "abbreviations", "country", "population",
        "why well known (c capital, s state capital, f famous list, p population; 0 lesser known, only in the wider list)",
        "state or province (its number in regions, counting from 1; 0: not known)",
    ],
    "countries": {cc: country_names.get(cc, cc) for cc in sorted(used_countries)},
    "regions": region_list,
    "rows": out,
}
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
known = sum(1 for r in out if r[6])
print(f"{len(out)} places written to {out_path}, {known} well known")
