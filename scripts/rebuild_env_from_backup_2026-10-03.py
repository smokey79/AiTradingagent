r"""
rebuild_env_from_backup_2026-10-03.py

My first .env edit read the file with Windows PowerShell's default (ANSI) decoding, which turned multi-byte UTF-8
characters in COMMENTS into mojibake (the file grew by ~3 KB). This rebuilds .env from the untouched pre-change backup at BYTE level:
  1. comment out ROUND_TRIP_COST_PCT=...  2. append the CALIBRATION block  3. keep every other byte (line endings, comments, values) as it was.
The current .env is kept as .env.bak-20261003-mojibake. Prints only key NAMES (never values).
Run: F:\aitradingagent\.venv\Scripts\python.exe scripts\rebuild_env_from_backup_2026-10-03.py
"""
import os, re, shutil

R = r"F:\aitradingagent"
SRC = os.path.join(R, "backups", "2026-10-03_precalibration", ".env")
CUR = os.path.join(R, ".env")

raw = open(SRC, "rb").read()
text = raw.decode("utf-8")                       # original is valid UTF-8 (checked)
nl = "\r\n" if "\r\n" in text else "\n"

out, commented = [], 0
for line in text.split(nl):
    if re.match(r"^\s*ROUND_TRIP_COST_PCT\s*=", line):
        out.append("# " + line + "   # disabled 2026-10-03: the default now comes from config/realism.json (0.16% round trip)")
        commented += 1
    else:
        out.append(line)
while out and out[-1] == "":
    out.pop()
out += ["",
        "# ---- CALIBRATION 2026-10-03 (non-secret) ----",
        "# Flash-loan arbitrage stays observation-only until flashloan-sim writes a passing fork-test marker AND this is set to live.",
        "ARB_MODE=observe",
        "# Random synthetic candles were a fallback when exchanges failed; they are off. Offline demos only.",
        "ALLOW_SYNTHETIC_CANDLES=false"]
new_bytes = (nl.join(out) + nl).encode("utf-8")


def parse(b):
    d = {}
    for ln in b.decode("utf-8").splitlines():
        if ln.strip() and not ln.lstrip().startswith("#") and "=" in ln:
            k, v = ln.split("=", 1)
            d[k.strip()] = v.strip()
    return d


cur_dict, new_dict = parse(open(CUR, "rb").read()), parse(new_bytes)
differ = sorted(k for k in set(cur_dict) | set(new_dict) if cur_dict.get(k) != new_dict.get(k))
print("keys now:", len(cur_dict), "| keys after rebuild:", len(new_dict), "| ROUND_TRIP lines commented:", commented)
print("keys whose VALUE differs between current .env and the rebuild:", differ if differ else "none")

shutil.copy2(CUR, os.path.join(R, ".env.bak-20261003-mojibake"))
open(CUR, "wb").write(new_bytes)
chk = open(CUR, "rb").read()
chk.decode("utf-8")
print("written:", len(chk), "bytes (backup original was", len(raw), "bytes) | BOM:", chk[:3] == b"\xef\xbb\xbf", "| line ending:", repr(nl))
