"""Builds lab/hot-potato/public/words.json: the ordinary English words and common names that the
matcher must never stretch into a city by sound ("salmon" is a fish, not Salmas).

Download, in an empty folder of their own:
  https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
      (the 50,000 most frequent words in English film and TV subtitles, OpenSubtitles 2018)
  https://downloads.sourceforge.net/wordlist/scowl-2020.12.07.tar.gz  (unpack it)
      (SCOWL: which spellings are ordinary lower-case words, so names such as "paris" in the
      subtitle counts are left out of the word list)
  https://www2.census.gov/topics/genealogy/1990surnames/dist.male.first
  https://www2.census.gov/topics/genealogy/1990surnames/dist.female.first
  https://www2.census.gov/topics/genealogy/1990surnames/dist.all.last
      (US Census 1990 first names and family names, public domain)

Then: python3 -I lab/hot-potato/tools/make-words.py <en_50k.txt> <scowl final/ folder> <census folder> <out.json> <date fetched>

Keeps the WORD_COUNT most frequent subtitle words that SCOWL lists as common lower-case English words
(levels up to 50, American, British and Canadian spellings), every first name in the census
lists, and the SURNAME_COUNT most common family names. All lower case, letters a to z only.
"""
import json
import os
import re
import sys

freq_path, scowl_dir, census_dir, out_path, fetched = sys.argv[1:6]
WORD_COUNT = 30000
SURNAME_COUNT = 5000
# SCOWL levels up to 50 are its common words. Higher levels hold rare lower-case uses of place
# names ("berlin", a carriage; "geneva", a gin; "paris", "cairo"), which must not count as words.
LEVELS = ("10", "20", "35", "40", "50")
ONLY_LETTERS = re.compile(r"^[a-z]+$")

dictionary = set()
for name in os.listdir(scowl_dir):
    m = re.match(r"^(english|american|british|canadian)-words\.(\d+)$", name)
    if not m or m.group(2) not in LEVELS:
        continue
    with open(os.path.join(scowl_dir, name), encoding="latin-1") as fh:
        for line in fh:
            w = line.strip()
            if ONLY_LETTERS.match(w):
                dictionary.add(w)

words = []
seen = set()
with open(freq_path, encoding="utf-8") as fh:
    for line in fh:
        parts = line.split()
        if not parts:
            continue
        w = parts[0].lower()
        if w in seen or not ONLY_LETTERS.match(w) or w not in dictionary:
            continue
        if len(w) == 1 and w not in ("a", "i"):
            continue
        seen.add(w)
        words.append(w)
        if len(words) >= WORD_COUNT:
            break


def census(name, limit=None):
    out = []
    with open(os.path.join(census_dir, name), encoding="latin-1") as fh:
        for line in fh:
            parts = line.split()
            if parts and ONLY_LETTERS.match(parts[0].lower()):
                out.append(parts[0].lower())
            if limit and len(out) >= limit:
                break
    return out


first = census("dist.female.first") + census("dist.male.first")
last = census("dist.all.last", SURNAME_COUNT)
names = []
for n in first + last:
    if n not in seen:
        seen.add(n)
        names.append(n)

doc = {
    "source": "Words: FrequencyWords en_50k (OpenSubtitles 2018, CC BY-SA 4.0) filtered by SCOWL 2020.12.07 lower-case words. Names: US Census 1990 first names and top family names (public domain).",
    "fetched": fetched,
    "words": words,
    "names": names,
}
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, separators=(",", ":"))
print(f"{len(words)} words and {len(names)} names written to {out_path}")
