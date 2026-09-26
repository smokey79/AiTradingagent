"""
scripts/check_agent_keys.py
Reports which AI provider keys are present in .env WITHOUT printing any secrets.
Run:  python scripts/check_agent_keys.py
"""
import os
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / ".env"

# Agent -> possible env key names, in your requested priority order
AGENTS = [
    ("1. Claude      (PRIMARY)", ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]),
    ("2. Gemini      (Google) ", ["GEMINI_API_KEY", "GOOGLE_API_KEY"]),
    ("3. Copilot     (Azure)  ", ["AZURE_OPENAI_KEY", "GITHUB_TOKEN", "COPILOT_API_KEY"]),
    ("4. OpenRouter  (multi)  ", ["OPENROUTER_API_KEY", "OPENROUTER_KEY"]),
    ("5. Ollama/Hermes (local)", ["OLLAMA_BASE_URL", "OLLAMA_MODEL"]),
    ("-- GPT-4o      (extra)  ", ["OPENAI_API_KEY"]),
    ("-- Grok        (extra)  ", ["GROK_API_KEY", "XAI_API_KEY"]),
    ("-- DeepSeek    (extra)  ", ["DEEPSEEK_API_KEY"]),
    ("-- Perplexity  (extra)  ", ["PERPLEXITY_API_KEY"]),
]

PLACEHOLDERS = ("your_", "YOUR_", "xxx", "placeholder", "changeme", "sk-...", "...")


def load_env(path):
    found = {}
    if not path.exists():
        return found
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        found[k.strip()] = v.strip().strip('"').strip("'")
    return found


def status(val):
    if val is None:
        return "MISSING", "key not in .env"
    if not val:
        return "EMPTY", "key present but blank"
    if any(p in val for p in PLACEHOLDERS):
        return "PLACEHOLDER", "still a template value"
    if len(val) < 12:
        return "TOO SHORT", f"only {len(val)} chars"
    return "SET", f"{len(val)} chars, ends ...{val[-4:]}"


def main():
    env = load_env(ENV)
    print()
    print("=" * 72)
    print("  AI PROVIDER KEY CHECK  (no secrets printed)")
    print(f"  Reading: {ENV}")
    print("=" * 72)

    ready = 0
    for label, candidates in AGENTS:
        hit_key, hit_val = None, None
        for c in candidates:
            if c in env:
                hit_key, hit_val = c, env[c]
                break
        st, detail = status(hit_val)
        mark = "OK  " if st == "SET" else "--  "
        if st == "SET":
            ready += 1
        keyname = hit_key or candidates[0]
        print(f"  {mark}{label}  {keyname:<22} {st:<12} {detail}")

    print("-" * 72)
    print(f"  {ready} provider keys ready to use")
    print("=" * 72)
    print()


if __name__ == "__main__":
    main()
