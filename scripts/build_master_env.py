#!/usr/bin/env python
"""
build_master_env.py  (2026-10-03)

Gathers the API keys that are scattered across your project folders (.env files AND loose .txt/.env.txt files, UTF-8 or UTF-16)
into ONE master file, and fills the gaps in the active .env that the code actually reads.

  default   dry run: prints a report only
  --validate  also asks each provider's API "is this key alive?" (one cheap GET) and prefers a working key
  --apply     writes config/master.env (user-only permissions) and fills missing/placeholder keys in .env (backup first)

Safety rules built in:
  * SECRET VALUES ARE NEVER PRINTED OR LOGGED. Reports show names, source file names and value LENGTHS only.
  * An existing, real value in .env is NEVER overwritten. Only empty / placeholder / missing names are filled.
  * Wallet and signing secrets (private keys, seed phrases, mnemonics) are NEVER copied anywhere; they are only counted.
  * .env edits are byte-safe (no re-encoding of the rest of the file) and a backup is written first.
  * config/master.env is checked against git ignore rules before it is written.

Sources come from the discovery list written by find_key_files_2026-10-03.ps1 (names only) plus any --source paths.
Run:  .venv\\Scripts\\python.exe scripts\\build_master_env.py [--validate] [--apply]
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CANDIDATES = ROOT / "runs" / "2026-10-03_calibration" / "key_file_candidates.txt"

PLACEHOLDER_RE = re.compile(
    r"^(|your[_\- ].*|.*[_\-]here|x{3,}.*|changeme|change_me|replace.*|todo|none|null|undefined|<.*>|\.{3,}|example.*)$", re.I)
SECRET_NAME_RE = re.compile(r"(API|KEY|TOKEN|SECRET|PASSPHRASE|PASSWORD|BEARER|WEBHOOK|ACCOUNT_ID|ACCOUNT_SID|CLIENT_ID|CHAT_ID)", re.I)
NOT_SECRET_NAME_RE = re.compile(
    r"(MODEL|_URL$|URL_|ENDPOINT|HOST|PORT|PATH|FILE|ENABLED|_MODE$|ALLOW|LIMIT|TIMEOUT|INTERVAL|ORDER|SIZE|COUNT|MAX_|MIN_|PCT|RATE|THRESHOLD|CONFIDENCE|PAPER|LIVE_TRADING|KEYWORD|KEYS_PER)", re.I)
WALLET_RE = re.compile(r"(PRIVATE_KEY|PRIV_KEY|MNEMONIC|SEED|SECRET_PHRASE|KEYSTORE|SIGNER_KEY|WALLET_KEY|(^|_)WIF($|_))", re.I)
SKIP_PATH_RE = re.compile(r"(VSCode\\extensions|\.example|\.bak|backup|mojibake|LICENSE|\\\.git\\|\\node_modules\\|\.env\.paper$)", re.I)

# several names that mean the same key; used to fill a name the code wants from an alias that has a value
ALIASES = [
    ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_AI_API_KEY"],
    ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
    ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"],
    ["DEEPSEEK_API_KEY", "DEEPSEEK_KEY"],
    ["XAI_API_KEY", "GROK_API_KEY"],
    ["HF_TOKEN", "HUGGINGFACE_API_KEY", "HUGGINGFACE_TOKEN", "HF_API_KEY"],
    ["GITHUB_TOKEN", "GH_TOKEN", "GITHUB_API_KEY"],
    ["ALPACA_API_KEY", "APCA_API_KEY_ID", "ALPACA_KEY_ID"],
    ["ALPACA_SECRET_KEY", "APCA_API_SECRET_KEY", "ALPACA_API_SECRET"],
    ["COINGECKO_API_KEY", "CG_API_KEY", "COINGECKO_DEMO_API_KEY"],
    ["PERPLEXITY_API_KEY", "PPLX_API_KEY"],
    ["X_BEARER_TOKEN", "TWITTER_BEARER_TOKEN"],
]

# bare key (a .txt that holds only the key) -> which variable it belongs to, judged by its prefix
BARE_PATTERNS = [
    (re.compile(r"^sk-ant-"), "ANTHROPIC_API_KEY"), (re.compile(r"^sk-or-"), "OPENROUTER_API_KEY"),
    (re.compile(r"^AIza[0-9A-Za-z_\-]{30,}$"), "GEMINI_API_KEY"), (re.compile(r"^gsk_"), "GROQ_API_KEY"),
    (re.compile(r"^xai-"), "XAI_API_KEY"), (re.compile(r"^nvapi-"), "NVIDIA_API_KEY"), (re.compile(r"^csk-"), "CEREBRAS_API_KEY"),
    (re.compile(r"^hf_"), "HF_TOKEN"), (re.compile(r"^(ghp_|github_pat_)"), "GITHUB_TOKEN"), (re.compile(r"^fc-"), "FIRECRAWL_API_KEY"),
    (re.compile(r"^sk-(proj|svcacct)-"), "OPENAI_API_KEY"),
]
DEEPSEEK_BARE = re.compile(r"^sk-[0-9a-f]{32}$")

# loose files often use just the provider's name as the variable (DEEPSEEK=sk-...): map those to the real variable name
PROVIDER_WORDS = {
    "DEEPSEEK": "DEEPSEEK_API_KEY", "GEMINI": "GEMINI_API_KEY", "OPENROUTER": "OPENROUTER_API_KEY", "CEREBRAS": "CEREBRAS_API_KEY",
    "GROQ": "GROQ_API_KEY", "ANTHROPIC": "ANTHROPIC_API_KEY", "CLAUDE": "ANTHROPIC_API_KEY", "OPENAI": "OPENAI_API_KEY",
    "XAI": "XAI_API_KEY", "GROK": "XAI_API_KEY", "NVIDIA": "NVIDIA_API_KEY", "MISTRAL": "MISTRAL_API_KEY", "PERPLEXITY": "PERPLEXITY_API_KEY",
    "FIRECRAWL": "FIRECRAWL_API_KEY", "VERCEL": "VERCEL_TOKEN", "WAKATIME": "WAKATIME_API_KEY", "WAKA": "WAKATIME_API_KEY",
    "TRADINGKIT": "TRADINGKIT_API_KEY", "COINGECKO": "COINGECKO_API_KEY", "OLLAMA": "OLLAMA_API_KEY", "GITHUB": "GITHUB_TOKEN",
    "HUGGINGFACE": "HF_TOKEN",
}
# exchange / wallet-adjacent trading credentials: kept in master.env but NOT copied into .env unless --include-exchange-keys
EXCHANGE_RE = re.compile(r"^(BINANCE|BITGET|BYBIT|CRYPTOCOM|CRYPTO_COM|KRAKEN|COINBASE|NEXO|KUCOIN|OKX|MEXC|GATE|FREQTRADE__EXCHANGE)", re.I)


# ---------------------------------------------------------------- parsing
def decode_bytes(b: bytes) -> str:
    if b.startswith((b"\xff\xfe", b"\xfe\xff")):
        return b.decode("utf-16", errors="replace")
    if b.startswith(b"\xef\xbb\xbf"):
        return b.decode("utf-8-sig", errors="replace")
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("cp1252", errors="replace")


def is_placeholder(v: str) -> bool:
    v = (v or "").strip().strip("\"'")
    return bool(PLACEHOLDER_RE.match(v)) or "***" in v or "..." in v


def clean_value(raw: str) -> str:
    v = raw.strip()
    if v[:1] in "\"'" and len(v) >= 2 and v[-1] == v[0]:
        return v[1:-1]
    return re.split(r"\s+#", v, maxsplit=1)[0].strip()


KV_RE = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*[=:]\s*(.*)$")


def parse_text(text: str, filename: str):
    """-> list of (name, value). Handles KEY=VALUE, export KEY=VALUE, KEY: VALUE and bare keys (named by prefix / file name)."""
    out = []
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln and not ln.startswith("#")]
    for ln in lines:
        m = KV_RE.match(ln)
        if m:
            out.append((m.group(1), clean_value(m.group(2))))
            continue
        if len(lines) <= 3 and " " not in ln and len(ln) >= 20:  # a loose file that is just the key
            name = None
            for rx, nm in BARE_PATTERNS:
                if rx.match(ln):
                    name = nm
                    break
            if name is None and DEEPSEEK_BARE.match(ln) and "deepseek" in filename.lower():
                name = "DEEPSEEK_API_KEY"
            if name:
                out.append((name, ln))
    return out


def read_pairs(path: Path):
    try:
        return parse_text(decode_bytes(path.read_bytes()), path.name)
    except OSError:
        return []


def disp(p: Path) -> str:
    """File name for reports; long hex runs in a file name (some key files have the key in the name) are hidden."""
    return re.sub(r"[0-9A-Fa-f]{16,}", "...", p.name)


def wanted_name(name: str) -> bool:
    return bool(SECRET_NAME_RE.search(name)) and not NOT_SECRET_NAME_RE.search(name)


def canonical_name(name: str, value: str):
    """The variable name to file this pair under, or None if it is not an API credential."""
    up = name.upper()
    if up in PROVIDER_WORDS and len(value) >= 20:
        return PROVIDER_WORDS[up]
    if wanted_name(name):
        if "_" not in name or re.search(r"\d{6,}", name):   # 'Secret', 'TOKENS', 'Telegrame_API_8288429645': labels, not variables
            return None
        return up + "_KEY" if up.endswith("_API") else name
    for rx, nm in BARE_PATTERNS:                           # a known key format sitting under an odd name
        if rx.match(value):
            return nm
    return None


# ---------------------------------------------------------------- sources
def candidate_paths(candidates_file: Path, extra):
    paths = []
    if candidates_file.exists():
        for ln in decode_bytes(candidates_file.read_bytes()).splitlines():
            m = re.match(r"^([A-Za-z]:\\.*?)\s{2,}\d+ B\s+\d{4}-\d\d-\d\d\s*$", ln.rstrip())
            if m:
                paths.append(Path(m.group(1)))
    paths += [Path(p) for p in extra]
    seen, out = set(), []
    low_ok = lambda n: n.endswith((".env", ".txt")) or ".env" in n or n.startswith(".env")
    for p in paths:
        key = str(p).lower()
        if key in seen or SKIP_PATH_RE.search(str(p)) or not low_ok(p.name.lower()) or not p.is_file():
            continue
        seen.add(key)
        out.append(p)
    return out


def needed_names(root: Path, env_path: Path):
    names = set()
    rx = [re.compile(r"process\.env\.([A-Z][A-Z0-9_]+)"), re.compile(r"process\.env\[['\"]([A-Z0-9_]+)['\"]\]"),
          re.compile(r"os\.getenv\(\s*['\"]([A-Z0-9_]+)"), re.compile(r"os\.environ(?:\.get)?[\(\[]\s*['\"]([A-Z0-9_]+)")]
    for sub in ("src", "agents", "core", "orchestrator", "scripts"):
        base = root / sub
        if not base.exists():
            continue
        for f in base.rglob("*"):
            if f.suffix not in (".js", ".cjs", ".py") or any(x in f.parts for x in ("node_modules", "venv", ".venv", "_archive", "AI-Trading-Agent", "assets")):
                continue
            try:
                if f.stat().st_size > 1_000_000:
                    continue
                txt = f.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for r in rx:
                names.update(r.findall(txt))
    for p in (root / ".env.example", env_path):
        if p.exists():
            names.update(n for n, _ in read_pairs(p))
    return {n for n in names if wanted_name(n) and not WALLET_RE.search(n)}


# ---------------------------------------------------------------- validation (names + status only, never values)
def _get(url, headers, timeout=15):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(20000)
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        return None, b""


def check_key(name: str, value: str):
    """-> (state, note). state in ok / no_balance / rate_limited / invalid / unreachable / untested."""
    n = name.upper()
    bearer = {"Authorization": f"Bearer {value}", "User-Agent": "aitradingagent-keycheck"}
    if re.match(r"^DEEPSEEK.*KEY", n):
        st, body = _get("https://api.deepseek.com/user/balance", bearer)
        if st == 200:
            try:
                j = json.loads(body)
                bal = (j.get("balance_infos") or [{}])[0]
                return ("ok" if j.get("is_available") else "no_balance"), f"is_available={j.get('is_available')} balance={bal.get('total_balance')} {bal.get('currency')}"
            except Exception:
                return "ok", ""
        if st == 402:
            return "no_balance", "HTTP 402"
    elif re.match(r"^OPENROUTER.*KEY", n):
        st, _ = _get("https://openrouter.ai/api/v1/auth/key", bearer)
    elif re.match(r"^(GEMINI|GOOGLE).*API_KEY", n) and value.startswith("AIza"):
        st, _ = _get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {"x-goog-api-key": value})
    elif re.match(r"^(ANTHROPIC|CLAUDE).*KEY", n):
        st, _ = _get("https://api.anthropic.com/v1/models", {"x-api-key": value, "anthropic-version": "2023-06-01"})
    elif re.match(r"^GROQ.*KEY", n):
        st, _ = _get("https://api.groq.com/openai/v1/models", bearer)
    elif re.match(r"^CEREBRAS.*KEY", n):
        st, _ = _get("https://api.cerebras.ai/v1/models", bearer)
    elif re.match(r"^(XAI|GROK).*KEY", n):
        st, _ = _get("https://api.x.ai/v1/models", bearer)
    elif re.match(r"^NVIDIA.*KEY", n):
        st, _ = _get("https://integrate.api.nvidia.com/v1/models", bearer)
    elif re.match(r"^OPENAI_API_KEY$", n):
        st, _ = _get("https://api.openai.com/v1/models", bearer)
    elif re.match(r"^(HF|HUGGINGFACE).*(TOKEN|KEY)", n):
        st, _ = _get("https://huggingface.co/api/whoami-v2", bearer)
    elif re.match(r"^(GITHUB|GH).*TOKEN", n):
        st, _ = _get("https://api.github.com/user", {**bearer, "Accept": "application/vnd.github+json"})
    else:
        return "untested", "no checker for this provider"
    if st is None:
        return "unreachable", "network error"
    if st == 200:
        return "ok", ""
    if st == 429:
        return "rate_limited", "HTTP 429 (key accepted, quota hit)"
    if st in (401, 403):
        return "invalid", f"HTTP {st}"
    return "invalid", f"HTTP {st}"


# ---------------------------------------------------------------- writing
def fmt_value(v: str) -> str:
    return '"' + v.replace('"', '\\"') + '"' if re.search(r"[\s#\"']", v) else v


def fill_env_bytes(env_bytes: bytes, fills: dict, stamp: str, force=frozenset()) -> bytes:
    """Replace empty/placeholder values in place (and real ones only for names in `force`); append names that are not present.
    Everything else in the file stays byte-identical."""
    text = env_bytes.decode("utf-8", errors="surrogateescape")
    lines = text.splitlines(keepends=True)
    present, out = set(), []
    for ln in lines:
        # [ \t] not \s: a greedy \s would swallow the line break of an EMPTY value (KEY=<newline>) and put the new value on the next line
        m = re.match(r"^([ \t]*(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_.]*)([ \t]*=[ \t]*)(.*?)(\r?\n?)$", ln)
        if m and m.group(2) in fills:
            present.add(m.group(2))
            if is_placeholder(clean_value(m.group(4))) or m.group(2) in force:
                ln = f"{m.group(1)}{m.group(2)}{m.group(3)}{fmt_value(fills[m.group(2)])}{m.group(5) or chr(10)}"
        out.append(ln)
    add = [n for n in fills if n not in present]
    if add:
        if out and not out[-1].endswith("\n"):
            out[-1] += "\n"
        out.append(f"\n# ---- added {stamp} by scripts/build_master_env.py (values came from other key files; see config/master.env) ----\n")
        for n in add:
            out.append(f"{n}={fmt_value(fills[n])}\n")
    return "".join(out).encode("utf-8", errors="surrogateescape")


def git_ignored(root: Path, rel: str) -> bool:
    try:
        return subprocess.run(["git", "-C", str(root), "check-ignore", "-q", rel], capture_output=True).returncode == 0
    except Exception:
        return False


# ---------------------------------------------------------------- main
def run(argv=None, out=print):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--root", default=str(ROOT))
    ap.add_argument("--env", default=None, help="active .env (default <root>/.env)")
    ap.add_argument("--master", default=None, help="output master file (default <root>/config/master.env)")
    ap.add_argument("--candidates", default=str(DEFAULT_CANDIDATES))
    ap.add_argument("--source", action="append", default=[])
    ap.add_argument("--max-validate", type=int, default=4, help="max candidate values tried per provider")
    ap.add_argument("--include-exchange-keys", action="store_true",
                    help="also copy exchange trading credentials (Binance, Bitget, Crypto.com, Nexo, ...) into .env; by default they stay only in master.env")
    ap.add_argument("--replace-invalid", action="store_true",
                    help="also swap a REAL .env value that the provider rejects (401/403) for a working one from another file (needs --validate)")
    a = ap.parse_args(argv)

    root = Path(a.root)
    env_path = Path(a.env) if a.env else root / ".env"
    master_path = Path(a.master) if a.master else root / "config" / "master.env"
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    cur = {n: v for n, v in read_pairs(env_path)} if env_path.exists() else {}
    # only credentials count (the master file is NOT a copy of the whole .env)
    cur_good = {n for n, v in cur.items() if wanted_name(n) and not WALLET_RE.search(n) and not is_placeholder(v)}

    sources = [p for p in candidate_paths(Path(a.candidates), a.source) if p.resolve() != env_path.resolve()]
    out(f"sources read: {len(sources)} files | active .env keys: {len(cur)} ({len(cur_good)} with real values)")

    found = {}       # name -> list of (value, mtime, source path)
    wallet_skipped, placeholders, unidentified = set(), 0, 0
    for p in sources:
        mt = p.stat().st_mtime
        pairs = read_pairs(p)
        if not pairs and p.stat().st_size < 400:
            unidentified += 1
        for n, v in pairs:
            if WALLET_RE.search(n):
                wallet_skipped.add(n)
                continue
            cn = canonical_name(n, v)
            if cn is None:
                continue
            if is_placeholder(v):
                placeholders += 1
                continue
            found.setdefault(cn, []).append((v, mt, p))

    # candidate order per name: the current .env value first, then newest sources first, de-duplicated by value
    ordered = {}
    for n, items in found.items():
        seen, lst = set(), []
        if n in cur_good:
            lst.append((cur[n], None, env_path))
            seen.add(cur[n])
        for v, mt, p in sorted(items, key=lambda t: -t[1]):
            if v not in seen:
                seen.add(v)
                lst.append((v, mt, p))
        ordered[n] = lst
    for n in cur_good:
        ordered.setdefault(n, [(cur[n], None, env_path)])

    verdict = {}
    if a.validate:
        out("validating keys (status only, no values printed):")
        for n, lst in sorted(ordered.items()):
            results = []
            for i, (v, mt, p) in enumerate(lst[: a.max_validate]):
                st, note = check_key(n, v)
                results.append((st, note, i))
                if st in ("untested", "ok", "rate_limited"):
                    break                      # no checker, or a working key: stop trying more candidates
            if results[0][0] == "untested":
                verdict[n] = ("untested", 0, lst[0][2], results[0][1])
                continue
            # prefer a working key; a key that is valid but has no balance is the fallback; otherwise keep the first and mark its state
            pick = (next((r for r in results if r[0] in ("ok", "rate_limited")), None)
                    or next((r for r in results if r[0] == "no_balance"), None) or results[0])
            verdict[n] = (pick[0], pick[2], lst[pick[2]][2], pick[1])
            out(f"  {n:34} {pick[0]:13} tried {len(results)} candidate(s); using #{pick[2] + 1} from {disp(lst[pick[2]][2])} {pick[1]}")

    chosen = {}
    dead = sorted(n for n, vd in verdict.items() if vd[0] == "invalid")   # every candidate rejected by the provider
    for n, lst in ordered.items():
        if n in dead:
            continue                                                       # a rejected key is not carried into master.env or .env
        chosen[n] = lst[verdict[n][1] if n in verdict else 0]

    # what the active .env is missing among the names the code reads
    need = needed_names(root, env_path)
    fills, fill_src, force, rejected_kept, held_back = {}, {}, set(), [], []
    alias_of = {a_: grp for grp in ALIASES for a_ in grp}
    for n in sorted(need):
        if EXCHANGE_RE.search(n) and not a.include_exchange_keys:
            if n not in cur_good and (n in chosen or any(al in chosen for al in alias_of.get(n, []))):
                held_back.append(n)
            continue
        if n in cur_good:
            better = n in chosen and chosen[n][0] != cur[n]  # validation found a working alternative to a rejected value
            if not better:
                continue
            if not a.replace_invalid:
                rejected_kept.append(n)
                continue
            force.add(n)
        # candidates: this name, then its aliases; a key the provider confirmed beats an untested one; rejected keys are never used
        group = [n] + [x for x in alias_of.get(n, []) if x != n]
        works = lambda g: g in verdict and verdict[g][0] in ("ok", "rate_limited")
        cand = next((chosen[g] for g in group if g in chosen and works(g)), None) or next((chosen[g] for g in group if g in chosen), None)
        if cand and not (n in cur_good and cand[0] == cur.get(n)):
            fills[n], fill_src[n] = cand[0], disp(cand[2])

    out("")
    out(f"{'NAME':36}{'in .env':9}{'sources':8}{'distinct':9}  note")
    for n in sorted(ordered):
        srcs = len(found.get(n, [])) + (1 if n in cur_good else 0)
        note = []
        if n in dead:
            note.append("ALL candidates rejected by the provider - not carried over")
        if n in fills:
            note.append(f"WILL FILL .env from {fill_src[n]}")
        if len({v for v, _, _ in ordered[n]}) > 1:
            note.append("different values exist (kept the working/current one)")
        ln_ = len(chosen[n][0]) if n in chosen else 0
        out(f"{n:36}{('yes' if n in cur_good else 'no'):9}{srcs:<8}{len({v for v, _, _ in ordered[n]}):<9}  {'; '.join(note)} (len {ln_})")
    missing = sorted(n for n in need if n not in cur_good and n not in fills and n not in chosen)
    if dead:
        out("")
        out(f"rejected by the provider, so NOT carried over ({len(dead)}): {', '.join(dead)}")
    out("")
    out(f"names the code reads that no source file has a real value for ({len(missing)}): {', '.join(missing) if missing else 'none'}")
    out(f"wallet/signing secrets found and deliberately NOT copied ({len(wallet_skipped)}): {', '.join(sorted(wallet_skipped)) if wallet_skipped else 'none'}")
    out(f"placeholder/empty values skipped: {placeholders} | tiny files with no recognisable key: {unidentified}")
    if held_back:
        out(f"exchange trading credentials found but NOT copied into .env (only in master.env; add --include-exchange-keys to copy): {', '.join(held_back)}")
    if rejected_kept:
        out(f"current .env value is REJECTED by the provider but a working alternative exists (not swapped; add --replace-invalid to swap): {', '.join(rejected_kept)}")
    out(f"will fill/replace in .env: {len(fills)} name(s): {', '.join(sorted(fills)) if fills else 'none'}")

    if not a.apply:
        out("\nDRY RUN - nothing was written. Re-run with --apply to write config/master.env and fill .env.")
        return {"fills": sorted(fills), "master_names": sorted(chosen), "missing": missing, "wallet_skipped": sorted(wallet_skipped)}

    # ---- apply
    rel = os.path.relpath(master_path, root).replace("\\", "/")
    if (root / ".git").exists() and not git_ignored(root, rel):
        gi = root / ".gitignore"
        with open(gi, "ab") as f:
            f.write(("\n# secrets master file (added by build_master_env.py)\n" + rel + "\n").encode())
        out(f"added {rel} to .gitignore")
    master_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"# MASTER ENV - generated {stamp} by scripts/build_master_env.py. SECRET FILE: never commit, never paste.",
             "# One value per name (the working/current one). Alternatives still live in the original source files.", ""]
    for n in sorted(chosen):
        v, mt, p = chosen[n]
        lines.append(f"# {n} <- {disp(p)}" + (f" ({datetime.fromtimestamp(mt):%Y-%m-%d})" if mt else " (active .env)"))
        lines.append(f"{n}={fmt_value(v)}")
    master_path.write_bytes(("\n".join(lines) + "\n").encode("utf-8"))
    if os.name == "nt":
        subprocess.run(["icacls", str(master_path), "/inheritance:r", "/grant:r", f"{os.environ.get('USERNAME', 'user')}:F"], capture_output=True)
    out(f"wrote {master_path} ({len(chosen)} names)")

    if fills:
        bdir = root / "backups" / "2026-10-03_master_env"
        bdir.mkdir(parents=True, exist_ok=True)
        bak = bdir / f".env.before-{datetime.now():%H%M%S}"
        shutil.copy2(env_path, bak)
        env_path.write_bytes(fill_env_bytes(env_path.read_bytes(), fills, stamp, force))
        out(f"backed up .env -> {bak}")
        out(f"updated .env: {len(fills)} name(s) filled/added")
    else:
        out(".env needed no changes")
    return {"fills": sorted(fills), "master_names": sorted(chosen), "missing": missing, "wallet_skipped": sorted(wallet_skipped)}


if __name__ == "__main__":
    run()
