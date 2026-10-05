"""remove_dead_openrouter_models_2026-09-29.py
Removes three retired OpenRouter free models (404 on every call, not listed at
https://openrouter.ai/api/v1/models on 2026-09-29) from every model list, and
swaps single-model defaults to the still-live inclusionai/ling-3.0-flash-sante:free.
Backs up each file to runs/2026-09-29_200gbp/archive before editing. Prints a diff summary.
"""
import pathlib, re, shutil

ROOT = pathlib.Path(r"F:\aitradingagent")
ARCH = ROOT / "runs" / "2026-09-29_200gbp" / "archive"
DEAD = ["inclusionai/ling-3.0-flash-fin:free", "inclusionai/ling-3.0-flash-vl:free", "z-ai/glm-5.2:free"]
REPLACEMENT = "inclusionai/ling-3.0-flash-sante:free"
FILES = ["src/health/selfHealer.js", "src/agents/providerRotator.js", "src/agents/geminiAgent.js",
         "src/agents/deepseekAgent.js", "core/config.py", "core/llm_router.py"]
dead_re = "|".join(re.escape(d) for d in DEAD)
list_entry = re.compile(r"^\s*['\"](" + dead_re + r")['\"]\s*,?\s*(//.*|#.*)?$")

for rel in FILES:
    p = ROOT / rel
    src = p.read_text(encoding="utf-8")
    shutil.copy2(p, ARCH / (p.name + ".bak"))
    out, changes = [], 0
    for line in src.splitlines(keepends=True):
        if list_entry.match(line.rstrip("\r\n")):
            changes += 1
            continue                                   # drop a whole list-entry line
        new = line
        # inline arrays: remove dead entries ("'x', " forms)
        new = re.sub(r"['\"](" + dead_re + r")['\"]\s*,\s*", "", new)
        # remaining single-value defaults -> live replacement
        new = re.sub(r"(['\"])(" + dead_re + r")(['\"])", lambda m: m.group(1) + REPLACEMENT + m.group(3), new)
        if new != line:
            changes += 1
        out.append(new)
    p.write_text("".join(out), encoding="utf-8")
    print(f"{rel}: {changes} line(s) changed")
