"""
scripts/test_agent_keys.py  v2
Makes ONE tiny live call per provider using the CORRECT keys/endpoints from .env
Covers: Claude (direct Anthropic), CheaperInference proxy, Gemini, Copilot,
        OpenRouter, Ollama, Grok/xAI
Run:  python scripts\\test_agent_keys.py
"""
import json, urllib.error, urllib.request
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / ".env"
TIMEOUT = 25
PING = "Reply with only the word: OK"

def load_env():
    out = {}
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out

def post(url, headers, payload):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())

def err(e):
    if isinstance(e, urllib.error.HTTPError):
        try:
            msg = json.loads(e.read().decode())
            msg = msg.get("error", {})
            msg = msg.get("message", str(msg)) if isinstance(msg, dict) else str(msg)
        except Exception:
            msg = e.reason
        return f"HTTP {e.code} — {str(msg)[:90]}"
    return f"{type(e).__name__}: {str(e)[:90]}"

E = load_env()
results = []

def check(name, fn):
    try:
        out = fn()
        results.append((name, "PASS", str(out).strip()[:50]))
    except Exception as e:
        results.append((name, "FAIL", err(e)))

# ── 1. Claude — Direct Anthropic ─────────────────────────────────────────────
def claude_direct():
    k = E.get("ANTHROPIC_API_KEY", "")
    if not k or not k.startswith("sk-ant-"):
        raise ValueError(f"Key wrong format: {k[:12]}...")
    r = post("https://api.anthropic.com/v1/messages",
             {"x-api-key": k, "anthropic-version": "2023-06-01",
              "content-type": "application/json"},
             {"model": "claude-sonnet-4-6", "max_tokens": 10,
              "messages": [{"role": "user", "content": PING}]})
    return r["content"][0]["text"]

# ── 2. Claude — CheaperInference proxy ───────────────────────────────────────
def claude_cheaper():
    k   = E.get("CLAUDE_API_KEY", E.get("OPENAI_API_KEY", ""))
    url = E.get("CLAUDE_BASE_URL", "https://api.cheaperinference.com/v1")
    mdl = E.get("CLAUDE_MODEL", "claude-haiku-4.5")
    if not k:
        raise ValueError("No CheaperInference key")
    r = post(f"{url}/chat/completions",
             {"Authorization": f"Bearer {k}", "Content-Type": "application/json"},
             {"model": mdl, "max_tokens": 10,
              "messages": [{"role": "user", "content": PING}]})
    return r["choices"][0]["message"]["content"]

# ── 3. Gemini ─────────────────────────────────────────────────────────────────
def gemini():
    k   = E.get("GEMINI_API_KEY", E.get("GOOGLE_API_KEY", ""))
    mdl = E.get("GEMINI_MODEL", "gemini-3.7-flash")
    if not k:
        raise ValueError("No GEMINI_API_KEY")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{mdl}:generateContent?key={k}"
    r = post(url, {"Content-Type": "application/json"},
             {"contents": [{"parts": [{"text": PING}]}]})
    return r["candidates"][0]["content"]["parts"][0]["text"]

# ── 4. Copilot (GitHub Models) ────────────────────────────────────────────────
def copilot():
    k = E.get("GITHUB_TOKEN", "")
    if not k:
        raise ValueError("No GITHUB_TOKEN")
    r = post("https://models.github.ai/inference/chat/completions",
             {"Authorization": f"Bearer {k}", "Content-Type": "application/json"},
             {"model": "gpt-4o-mini", "max_tokens": 10,
              "messages": [{"role": "user", "content": PING}]})
    return r["choices"][0]["message"]["content"]

# ── 5. OpenRouter ─────────────────────────────────────────────────────────────
def openrouter():
    k = E.get("OPENROUTER_API_KEY", "")
    if not k:
        raise ValueError("No OPENROUTER_API_KEY")
    mdl = E.get("OPENROUTER_FREE_MODEL", "inclusionai/ling-3.0-flash-fin:free")
    r = post("https://openrouter.ai/api/v1/chat/completions",
             {"Authorization": f"Bearer {k}", "Content-Type": "application/json"},
             {"model": mdl,
              "max_tokens": 10,
              "messages": [{"role": "user", "content": PING}]})
    return r["choices"][0]["message"]["content"]

# ── 6. Ollama (local) ─────────────────────────────────────────────────────────
def ollama():
    base  = E.get("OLLAMA_HOST", E.get("OLLAMA_URL", "http://127.0.0.1:11434"))
    model = E.get("OLLAMA_MODEL", "llama3.2")
    r = post(f"{base}/api/generate", {"Content-Type": "application/json"},
             {"model": model, "prompt": PING, "stream": False})
    return r.get("response", "")

# ── 7. Grok / xAI ────────────────────────────────────────────────────────────
def grok():
    k   = E.get("XAI_API_KEY") or E.get("GROK_API_KEY", "")
    mdl = E.get("XAI_MODEL", "grok-3-mini")
    if not k:
        raise ValueError("No XAI_API_KEY")
    r = post("https://api.x.ai/v1/chat/completions",
             {"Authorization": f"Bearer {k}", "Content-Type": "application/json"},
             {"model": mdl, "max_tokens": 10,
              "messages": [{"role": "user", "content": PING}]})
    return r["choices"][0]["message"]["content"]

# ── Run all ───────────────────────────────────────────────────────────────────
print("\n" + "=" * 75)
print("  LIVE AGENT KEY TEST v2 — one call per provider")
print("=" * 75)

check("1. Claude    (Direct Anthropic) ", claude_direct)
check("2. Claude    (CheaperInference) ", claude_cheaper)
check("3. Gemini    (Google AI Studio) ", gemini)
check("4. Copilot   (GitHub Models)    ", copilot)
check("5. OpenRouter(free multi-model) ", openrouter)
check("6. Ollama    (local llama3.2)   ", ollama)
check("7. Grok      (xAI direct)       ", grok)

for name, st, detail in results:
    mark = "OK  " if st == "PASS" else "XX  "
    print(f"  {mark}{name} {st:<5}  {detail}")

passed = sum(1 for _, s, _ in results if s == "PASS")
print("-" * 75)
print(f"  {passed}/{len(results)} providers responding")
print("=" * 75 + "\n")
