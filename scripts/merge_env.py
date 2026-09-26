"""
scripts/merge_env.py
Safely merges new keys into F:\\aitradingagent\\.env
- Reads uploaded files
- Updates existing keys in place (preserves all comments)
- Adds new keys at bottom if not already present
- Never prints secret values
Run: python scripts\\merge_env.py
"""
import re
import shutil
from datetime import datetime
from pathlib import Path

ROOT     = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"

# ── Keys to inject ────────────────────────────────────────────────────────────
# Claude API key from Claude_API_env.txt
CLAUDE_KEY_FILE = Path(r"C:\Users\barcl\AppData\Local\Temp\claude_key.txt")

# Google Cloud from Data1.env
DATA1_ENV = ROOT / "Data1.env"   # we'll copy it here first

# ─────────────────────────────────────────────────────────────────────────────

def load_env_file(path):
    """Returns dict of key->value from an env file."""
    result = {}
    if not path.exists():
        return result
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            result[k.strip()] = v.strip().strip('"').strip("'")
    return result


def patch_env(env_path, updates: dict):
    """
    Updates env_path in-place for any key in `updates`.
    Keys already present are updated; new keys appended.
    """
    lines = env_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    found = set()

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            continue
        k = stripped.split("=", 1)[0].strip()
        if k in updates:
            lines[i] = f"{k}={updates[k]}"
            found.add(k)

    # Append keys not yet in file
    missing = [k for k in updates if k not in found]
    if missing:
        lines.append("")
        lines.append("# ── Merged " + datetime.now().strftime("%Y-%m-%d") + " ──")
        for k in missing:
            lines.append(f"{k}={updates[k]}")

    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return found, missing


def status(val):
    if not val:
        return "EMPTY"
    if len(val) < 10:
        return f"SHORT({len(val)})"
    return f"SET [{val[:6]}...{val[-4:]}] len={len(val)}"


def main():
    updates = {}

    # ── 1. Claude key ─────────────────────────────────────────────────────────
    claude_key = None
    # Try temp file first (written by parent script)
    if CLAUDE_KEY_FILE.exists():
        claude_key = CLAUDE_KEY_FILE.read_text().strip()
    else:
        print("  [SKIP] Claude key temp file not found — will be handled separately")

    if claude_key and claude_key.startswith("sk-ant-"):
        updates["ANTHROPIC_API_KEY"] = claude_key
        print(f"  Claude key: {status(claude_key)}")
    elif claude_key:
        print(f"  [WARN] Claude key format unexpected: {claude_key[:12]}...")

    # ── 2. Google Cloud keys from Data1.env ───────────────────────────────────
    google_env_path = ROOT / "Data1.env"
    if google_env_path.exists():
        google = load_env_file(google_env_path)
        for k in ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_GENAI_USE_VERTEXAI"]:
            if k in google and google[k]:
                updates[k] = google[k]
                print(f"  {k}: {status(google[k])}")
    else:
        print("  [SKIP] Data1.env not found at project root")

    # ── 3. Also ensure GEMINI_API_KEY is set to use Vertex AI path ───────────
    # When GOOGLE_GENAI_USE_VERTEXAI=true, geminiAgent.js uses ADC (no separate key needed)
    existing = load_env_file(ENV_FILE)
    if "GOOGLE_GENAI_USE_VERTEXAI" in updates and "GEMINI_API_KEY" in existing:
        current_gemini = existing.get("GEMINI_API_KEY", "")
        if current_gemini.startswith("AQ."):
            # Old expired token — blank it, Vertex AI handles auth
            updates["GEMINI_API_KEY"] = ""
            print("  GEMINI_API_KEY: cleared (Vertex AI ADC will be used instead)")

    if not updates:
        print("  Nothing to update.")
        return

    # Backup
    backup = ENV_FILE.with_suffix(f".env.bak_{datetime.now().strftime('%H%M%S')}")
    shutil.copy2(ENV_FILE, backup)
    print(f"\n  Backup: {backup.name}")

    found, missing = patch_env(ENV_FILE, updates)
    print(f"  Updated in-place: {sorted(found)}")
    print(f"  Appended new:     {sorted(missing)}")
    print("\n  Done — run: python scripts\\test_agent_keys.py to verify")


if __name__ == "__main__":
    print("\n" + "="*60)
    print("  ENV MERGE")
    print("="*60)
    main()
    print("="*60 + "\n")
