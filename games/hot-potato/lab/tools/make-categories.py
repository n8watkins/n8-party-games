"""Builds the Hot Potato category lists other than cities, in games/hot-potato/shared:
countries.json, animals.json and food.json. (Cities come from tools/make-cities.py; the "Anything"
category uses words.json as it is.)

Download, in an empty folder of their own:
  https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025.xml.gz
      (Open English WordNet 2025, CC BY 4.0: which nouns are animals, foods and drinks)
  https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
      (how common each word is, to choose the well-known entries)
  https://download.geonames.org/export/dump/countryInfo.txt
  https://download.geonames.org/export/dump/alternateNamesV2.zip -> alternateNamesV2.txt
      (GeoNames, CC BY 4.0: the countries and their English names)

Then: python3 -I games/hot-potato/lab/tools/make-categories.py <download folder> games/hot-potato/lab/tools games/hot-potato/shared <date fetched>

Each output is {category, source, fetched, fields, groups, rows}; a row is
[name, other names|0, abbreviations|0, well known (1) or lesser known (0), group number|0],
best known first. Hand lists in tools/ (one entry per line, "#" starts a comment):
  animals-drop.txt, food-drop.txt   names WordNet files under animals or food whose everyday
                                    meaning is something else ("queen", "frank"): left out;
                                    "name|group" leaves it out of that group only
  animals-add.txt, food-add.txt     well-known entries the frequency rule misses ("seal" is rare
                                    in film subtitles as an animal); a name or "multi word name"
  countries-extra.txt               name|continent|note: countries that are not on the ISO list
                                    (England, Scotland, Wales, Northern Ireland)

Well known, for animals and food: a one-word name among the SINGLE_RANK most frequent subtitle
words whose animal or food sense is one of its first SENSE_LIMIT noun senses in WordNet, or a name
on the add list (every well-known name of two or three words, such as "polar bear", is there).
Every other WordNet name of an animal, a food or a drink is lesser known: only in the wider list
("Also allow lesser-known ones").
"""
import collections
import gzip
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

src, tools, out_dir, fetched = sys.argv[1:5]
SINGLE_RANK = 40000
SENSE_LIMIT = 3
# Letters, spaces, hyphens and apostrophes; capitals allowed ("Komodo dragon", "German shepherd").
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z' -]*[a-z]$")
LETTERS = "abcdefghijklmnopqrstuvwxyz"


def hand_list(name):
    path = os.path.join(tools, name)
    out = []
    for line in open(path, encoding="utf-8"):
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(line)
    return out


rank = {}
for i, line in enumerate(open(os.path.join(src, "en_50k.txt"), encoding="utf-8")):
    parts = line.split()
    if parts:
        rank.setdefault(parts[0].lower(), i + 1)


def word_rank(name):
    return max(rank.get(w, 10**6) for w in re.split(r"[ -]", name.lower()))


# ---- WordNet: the noun synsets, their hypernyms and their names in sense order --------------------

synsets = {}
senses = collections.defaultdict(list)  # name -> synsets, in WordNet's sense order
for _, el in ET.iterparse(gzip.open(os.path.join(src, "english-wordnet-2025.xml.gz")), events=("end",)):
    if el.tag == "LexicalEntry":
        lemma = el.find("Lemma")
        if lemma.get("partOfSpeech") == "n":
            senses[lemma.get("writtenForm")] += [s.get("synset") for s in el.findall("Sense")]
        el.clear()
    elif el.tag == "Synset":
        if el.get("partOfSpeech") == "n":
            rels = el.findall("SynsetRelation")
            synsets[el.get("id")] = {
                "lex": el.get("lexfile"),
                "hyp": [r.get("target") for r in rels if r.get("relType") == "hypernym"],
                "instance": any(r.get("relType") == "instance_hypernym" for r in rels),
                "names": [],
            }
        el.clear()
for name, ids in senses.items():
    for sid in ids:
        if sid in synsets:
            synsets[sid]["names"].append(name)
children = collections.defaultdict(list)
for sid, s in synsets.items():
    for h in s["hyp"]:
        children[h].append(sid)


def find(name, first_def_word=None):
    """The synsets named `name` (all of them; callers pick by the group they head)."""
    return [sid for sid in senses.get(name, []) if sid in synsets]


def below(roots, stop=()):
    seen, todo = set(), list(roots)
    while todo:
        sid = todo.pop()
        if sid in seen or sid in stop:
            continue
        seen.add(sid)
        todo += children[sid]
    return seen


def pick(name, under):
    """The synset of `name` that lies inside the set `under`."""
    hits = [sid for sid in find(name) if sid in under]
    if not hits:
        sys.exit(f"no synset {name!r} in the tree")
    return hits[0]


def wordnet_category(key, roots, stops, groups, drop, add, lexfile):
    tree = below(roots, set(stops))
    # An add-list name WordNet files elsewhere in the same lexicographer file ("milk shake" under
    # a serving of drink, "olive oil" under oils) brings its own synset in; "name|lexfile" names
    # another file ("nut|noun.plant": WordNet's nuts are plant parts).
    wanted = [a.split("|") + [lexfile] for a in add]
    for n, lex, *_ in wanted:
        if not any(sid in tree for sid in senses.get(n, [])):
            tree.update(sid for sid in senses.get(n, []) if synsets.get(sid, {}).get("lex") == lex)
    add = [a.split("|")[0] for a in add]
    # Each synset's group: the first group in the list whose head is above it, so a drink made
    # from tea leaves is a drink, not a seasoning.
    labels = list(dict.fromkeys(label for label, _ in groups))

    def ancestors(sid):
        seen, todo = set(), [sid]
        while todo:
            s = todo.pop()
            if s in seen:
                continue
            seen.add(s)
            todo += [h for h in synsets[s]["hyp"] if h in tree]
        return seen

    def group(sid):
        above = ancestors(sid)
        for label, head in groups:
            if head in above:
                return labels.index(label) + 1
        return 0

    # "name|group" drops the name only from that group's sense ("cobbler|drink": the pie stays).
    drop_in = {tuple(d.split("|")) for d in drop if "|" in d}
    drop, add = {d for d in drop if "|" not in d}, set(add)
    root_names = {n for r in roots for n in synsets[r]["names"]}
    rows = {}
    for sid in tree:
        s = synsets[sid]
        if s["instance"]:
            continue
        g = group(sid)
        label = labels[g - 1] if g else "other"
        names = []
        for n in s["names"]:
            if not NAME_RE.match(n) or n in drop or (n, label) in drop_in or n in root_names or len(n.split()) > 3:
                continue
            # A scientific name ("Ursus americanus") has no word anyone says in everyday English.
            if n != n.lower() and word_rank(n.split()[-1]) >= 10**6:
                continue
            names.append(n)
        if names:
            rows[sid] = names

    def known_name(n, sid):
        if n in add:
            return True
        if " " in n or "-" in n or n != n.lower() or rank.get(n, 10**6) > SINGLE_RANK:
            return False
        return sid in senses[n][:SENSE_LIMIT]

    # One entry per name: a name that WordNet gives to two animals ("peacock", a bird and a
    # butterfly; "dolphin", a whale and a fish) belongs to the one with the fewest other names:
    # the butterfly is also a "peacock butterfly", the fish a "dolphinfish" or "mahimahi", while
    # the bird and the whale have no other name. Then WordNet's order decides.
    primary = {}
    pref = lambda n, sid: (len(rows[sid]), senses[n].index(sid))
    for sid, names in rows.items():
        for n in names:
            if n not in primary or pref(n, sid) < pref(n, primary[n]):
                primary[n] = sid
    entries = []
    for sid, names in rows.items():
        names = [n for n in names if primary[n] == sid]
        if not names:
            continue
        names.sort(key=lambda n: (not known_name(n, sid), len(n.split()), word_rank(n), len(n)))
        known = any(known_name(n, sid) for n in names)
        entries.append({"names": names, "known": known, "rank": word_rank(names[0]), "group": group(sid)})
    unused = [f"{n}|{g}" for n, g in drop_in if not any(n in synsets[sid]["names"] for sid in tree)]
    if unused:
        sys.exit(f"{key}: drop-list names not in the tree: {', '.join(unused)}")
    entries.sort(key=lambda e: (not e["known"], e["rank"], e["names"][0]))
    out = [[e["names"][0], e["names"][1:] or 0, 0, 1 if e["known"] else 0, e["group"]] for e in entries]
    seen = set(primary)
    missing = [n for n in add if n not in seen]
    if missing:
        sys.exit(f"{key}: add-list names not found: {', '.join(sorted(missing))}")
    return out, labels


def write(key, rows, groups, source, fields_note):
    doc = {
        "category": key,
        "source": source,
        "fetched": fetched,
        "fields": ["name", "other names (0: none)", "abbreviations (0: none)", "well known (1) or lesser known, only in the wider list (0)", f"group (its number in groups, counting from 1; 0: {fields_note})"],
        "groups": groups,
        "rows": rows,
    }
    path = os.path.join(out_dir, f"{key}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
    report(key, rows, path)


def letters(s):
    return "".join(c for c in s.lower() if "a" <= c <= "z")


def report(key, rows, path):
    known = [r for r in rows if r[3]]
    first = collections.Counter(letters(r[0])[0] for r in known)
    last = collections.Counter(letters(r[0])[-1] for r in known)
    print(f"\n{key}: {len(rows)} entries, {len(known)} well known, {os.path.getsize(path):,} bytes -> {path}")
    print("  starting letter (well known): " + " ".join(f"{c}{first[c]}" for c in LETTERS))
    print("  ending letter (well known):   " + " ".join(f"{c}{last[c]}" for c in LETTERS))
    dead = [c for c in LETTERS if first[c] < 3 and last[c]]
    print("  ending letters with fewer than 3 well-known entries to follow: " + (", ".join(f"{c} ({last[c]} end in it, {first[c]} start with it)" for c in dead) or "none"))


# ---- Animals ---------------------------------------------------------------------------------------

animal_tree = below(find("animal"))
chordate = pick("chordate", animal_tree)
invertebrate = pick("invertebrate", animal_tree)
animal_groups = [(g, pick(g, animal_tree)) for g in ("mammal", "bird", "fish", "reptile", "amphibian", "insect", "arachnid", "crustacean", "mollusk", "worm")]
# Young animals (lamb, kitten, cub) and larvae (caterpillar) sit beside the chordates in WordNet.
young = pick("young", animal_tree)
larva = pick("larva", animal_tree)
rows, groups = wordnet_category(
    "animals",
    [chordate, invertebrate, young, larva],
    [pick("hominid", animal_tree)],
    animal_groups,
    hand_list("animals-drop.txt"),
    hand_list("animals-add.txt"),
    "noun.animal",
)
write("animals", rows, groups, "Open English WordNet 2025 (CC BY 4.0), well-known entries chosen by FrequencyWords en_50k (CC BY-SA 4.0)", "an animal of no group listed")

# ---- Food and drink ------------------------------------------------------------------------------------

food_top = [sid for sid in find("food") if "nutrient" in synsets[sid]["names"]][0]
# WordNet files edible nuts under plant parts, not under food; they are added as a root of their own.
edible_nut = find("edible nut")[0]
food_tree = below([food_top, edible_nut])
food_roots = [food_top, edible_nut]
# Animal feed, diets and menus, stores of food, vitamins and manna are not things to name.
food_stops = [pick(n, food_tree) for n in ("vitamin", "feed", "fare", "provisions", "manna")]
# Only food or drink: WordNet's finer food families put meatloaf with the cakes (a loaf) and
# chips with the vegetables, which would read wrong on the page.
food_groups = [(label, pick(name, food_tree)) for label, name in (
    # Tea leaves are filed under seasonings in WordNet; black and green tea are drinks to a player.
    ("drink", "beverage"), ("drink", "tea leaf"),
)]
rows, groups = wordnet_category("food", food_roots, food_stops, food_groups, hand_list("food-drop.txt"), hand_list("food-add.txt"), "noun.food")
write("food", rows, groups, "Open English WordNet 2025 (CC BY 4.0), well-known entries chosen by FrequencyWords en_50k (CC BY-SA 4.0)", "a food of no group listed")

# ---- Countries ------------------------------------------------------------------------------------------

CONTINENTS = {"AF": "Africa", "AN": "Antarctica", "AS": "Asia", "EU": "Europe", "NA": "North America", "OC": "Oceania", "SA": "South America"}
GONE = {"CS", "AN"}  # Serbia and Montenegro, Netherlands Antilles: no longer exist
FORMAL = re.compile(r"\b(republic|kingdom of|principality|sultanate|commonwealth|federation|federal|federated|union of|state of|emirate|grand duchy|country of|territory of|colony of|province of|collectivity)\b", re.I)
country_drop = set(hand_list("countries-drop.txt"))
by_id, countries = {}, []
for line in open(os.path.join(src, "countryInfo.txt"), encoding="utf-8"):
    if line.startswith("#"):
        continue
    f = line.rstrip("\n").split("\t")
    if len(f) < 17 or f[0] in GONE:
        continue
    c = {"cc": f[0], "name": f[4].strip(), "continent": f[8], "pop": int(f[7] or 0), "alts": [], "abbr": []}
    by_id[f[16]] = c
    countries.append(c)
for line in open(os.path.join(src, "alternateNamesV2.txt"), encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    if len(f) < 4 or f[1] not in by_id or f[2] not in ("en", "abbr"):
        continue
    name = f[3].strip()
    if not letters(name) or "(" in name or "," in name:
        continue
    # Formal names ("Republic of Turkey", "Union of Burma") are not what anyone says in a game,
    # and would make R and K look like easy letters. "Czech Republic" is said, and stays.
    if f[2] == "en" and FORMAL.search(name) and " of " in name or name in country_drop:
        continue
    c = by_id[f[1]]
    if f[2] == "abbr":
        # Two-letter codes ("AS", "PR") are words or are said for other things.
        if 3 <= len(letters(name)) <= 4:
            c["abbr"].append(name)
    else:
        preferred, short = (f + [""] * 8)[4:6]
        c["alts"].append((0 if short == "1" else 1 if preferred == "1" else 2, name))
continent_list = sorted(set(CONTINENTS.values()))
# An abbreviation GeoNames gives two countries ("USA" for South Africa too) is left out.
abbr_count = collections.Counter(letters(a) for c in countries for a in set(c["abbr"]))
for c in countries:
    c["abbr"] = [a for a in c["abbr"] if abbr_count[letters(a)] == 1]
rows = []
for c in sorted(countries, key=lambda c: -c["pop"]):
    seen = {letters(c["name"])}
    alts = []
    for _, a in sorted(c["alts"]):
        if letters(a) not in seen and len(alts) < 8:
            seen.add(letters(a))
            alts.append(a)
    abbr = []
    for a in c["abbr"]:
        if letters(a) not in seen and len(abbr) < 3:
            seen.add(letters(a))
            abbr.append(a)
    rows.append([c["name"], alts or 0, abbr or 0, 1, continent_list.index(CONTINENTS[c["continent"]]) + 1])
for line in hand_list("countries-extra.txt"):
    name, continent, _note = line.split("|")
    rows.append([name, 0, 0, 1, continent_list.index(continent) + 1])
write("countries", rows, continent_list, "GeoNames countryInfo and alternateNamesV2 (CC BY 4.0), with England, Scotland, Wales and Northern Ireland added by hand", "continent not known")
