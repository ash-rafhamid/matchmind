"""Smoke test for the deployed AI: checks the crew's stories, match reports, Ask answers, what-if
explanations and commentator calls against the match's own facts.

Usage: python scripts/live_check.py [match_id] [base_url]
Costs a few cents (two Ask questions and one what-if explanation per run).
"""
import json
import re
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

MID = sys.argv[1] if len(sys.argv) > 1 else "red-iro-189"
U = sys.argv[2] if len(sys.argv) > 2 else "https://matchmind.blackisland-4799a434.japaneast.azurecontainerapps.io"


def get(path, body=None, timeout=180):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(U + path, data=data, method="POST" if body is not None else "GET",
                                 headers={"Content-Type": "application/json"})
    t = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read()), time.time() - t


def ok(cond, label):
    print(("  PASS " if cond else "  FAIL ") + label)
    return cond


pkg, dt = get(f"/api/matches/{MID}?rev=2")
meta = pkg["meta"]
names = meta["player_names"]
teams = meta["teams"]
surname = lambda pid: names[pid].split(" ")[-1]
goals = [e for e in pkg["events"] if e["type"] == "goal"]
final = meta["score"]
print(f"Match {teams['home']['name']} {final['home']}-{final['away']} {teams['away']['name']}  ({dt:.1f}s, cold start included)")
print("Goals:", ", ".join(f"{surname(g['player'])} {g['clock']}" for g in goals))
results = []


def says_final(text):
    """The final score is stated: as "2-4"/"4-2", or both clubs and both numbers in one sentence."""
    text = re.sub(r"[\u00a0\u202f\u2009]", " ", text)
    h, a = final["home"], final["away"]
    pairs = {(int(x), int(y)) for x, y in re.findall(r"(?<![\d.,])(\d{1,2})\s?[-\u2013]\s?(\d{1,2})(?![\d.,]\d)(?!\d)", text)}
    named = any(teams["home"]["name"] in s and teams["away"]["name"] in s
                and re.search(rf"\b{h}\b", s) and re.search(rf"\b{a}\b", s)
                for s in re.split(r"(?<=[.!?])\s", text))
    return (h, a) in pairs or (a, h) in pairs or bool(named)

print("\n1. Goal stories (casual fan, English): right scorer, minute and team, and passed the fact-checker?")
moments = pkg["analytics"]["moments"]
for g in goals:
    m = next((x for x in moments if x["type"] == "goal" and abs(x["ts"] - g["ts"]) < 4), None)
    if m is None:
        continue
    s, dt = get(f"/api/matches/{MID}/moments/{m['id']}/story?persona=fan&lang=en")
    text = s["text"]
    after = (g["score"]["home"], g["score"]["away"])
    before = list(after)
    before[0 if g["team"] == "home" else 1] -= 1
    allowed = {after, after[::-1], tuple(before), tuple(before[::-1])}
    lines_ = {(int(x), int(y)) for x, y in re.findall(r"(?<![\d.,])(\d{1,2})\s?[-–]\s?(\d{1,2})(?![\d.,]\d)(?!\d)", text)}
    level_wrong = bool(re.search(r"level|tied?|equali[sz]", text, re.I)) and after[0] != after[1]
    good = (s["mode"] == "ai" and (s.get("verdict") or {}).get("passed") and surname(g["player"]) in text
            and lines_ <= allowed and not level_wrong)
    results.append(ok(good, f"{g['clock']} {surname(g['player'])} (score after {after[0]}-{after[1]}, story says {sorted(lines_) or 'no score'}): {text[:100]}..."))

print("\n2. Other languages and fan types: written in the right language, verified?")
m = next(x for x in moments if x["type"] == "goal")
checks = [("es", "fan", lambda t: bool(re.search(r"\b(el|gol|de|la|que)\b", t))),
          ("ar", "fan", lambda t: len(re.findall(r"[؀-ۿ]", t)) > 40),
          ("ja", "fan", lambda t: len(re.findall(r"[぀-ヿ一-鿿]", t)) > 40),
          ("bn", "fan", lambda t: len(re.findall(r"[ঀ-৿]", t)) > 40),
          ("en", "analyst", lambda t: "xG" in t or "expected" in t.lower())]
for lang, persona, rule in checks:
    s, dt = get(f"/api/matches/{MID}/moments/{m['id']}/story?persona={persona}&lang={lang}")
    good = rule(s["text"]) and (s.get("verdict") or {}).get("passed")
    results.append(ok(bool(good), f"{lang}/{persona} ({s['mode']}, {dt:.1f}s): {s['text'][:90]}..."))

print("\n3. Match report: right final score?")
r, dt = get(f"/api/matches/{MID}/recap?persona=fan&lang=en")
score_ok = says_final(r["text"])
results.append(ok(score_ok and (r.get("verdict") or {}).get("passed"), f"recap ({dt:.1f}s): {r['text'][:140]}..."))

print("\n4. Ask the AI a question (it looks things up with its tools):")
q = "Who scored the first goal, and in which minute?"
a, dt = get(f"/api/matches/{MID}/ask", {"question": q, "persona": "fan", "lang": "en"})
first = goals[0]
ans = a.get("text") or a.get("answer") or json.dumps(a)[:400]
good = surname(first["player"]) in ans and re.sub(r"\D.*", "", first["clock"]) in ans
results.append(ok(good, f"Q: {q}\n       A ({dt:.1f}s): {ans[:220]}"))
q2 = "What was the final score?"
a2, dt = get(f"/api/matches/{MID}/ask", {"question": q2, "persona": "fan", "lang": "en"})
ans2 = a2.get("text") or a2.get("answer") or json.dumps(a2)[:400]
results.append(ok(says_final(ans2),
                  f"Q: {q2}\n       A ({dt:.1f}s): {ans2[:220]}"))

print("\n5. What-if (home team presses harder from minute 60, 200 replays of the rest of the match):")
w, dt = get(f"/api/matches/{MID}/whatif", {"team": "home", "from_minute": 60, "changes": {"press": 0.9}, "runs": 200,
                                           "persona": "fan", "lang": "en"})
res = w["result"]
probs = {k: v for k, v in res.items() if isinstance(v, (int, float)) and k.endswith(("win", "draw", "loss"))}
flat = json.dumps(res)[:300]
exp = w.get("explanation", {})
results.append(ok(bool(exp.get("text")) and (exp.get("verdict") or {}).get("passed", False),
                  f"({dt:.1f}s) result: {flat}\n       explanation: {exp.get('text', '')[:200]}"))

print("\n6. Commentator lines: goal calls name the right scorer and the right running score?")
lines, _ = get(f"/api/matches/{MID}/commentary?lang=en")
calls = [l for l in lines["lines"] if l["text"].startswith(("GOAL", "It's in"))]
score = {"home": 0, "away": 0}
all_ok = len(calls) == len(goals)
for g, c in zip(goals, calls):
    score[g["team"]] += 1
    want = f"{teams['home']['name']} {score['home']}, {teams['away']['name']} {score['away']}"
    all_ok &= surname(g["player"]) in c["text"] and want in c["text"]
results.append(ok(all_ok, f"{len(calls)} goal calls, e.g. \"{calls[-1]['text']}\""))

print(f"\n{sum(results)}/{len(results)} checks passed")
