import io
import json
import subprocess
import sys

PY = sys.executable
SCRIPT = r"f:\aitradingagent\bridge\python_to_node.py"


def run(stdin_text=None, args=None):
    cmd = [PY, SCRIPT] + (args or [])
    p = subprocess.run(
        cmd,
        input=stdin_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return p.returncode, (p.stdout or "").strip(), (p.stderr or "").strip()


cases = [
    ("empty stdin",                 "",                        None),
    ("whitespace stdin",            "   \n  ",                 None),
    ("malformed JSON",              "{not json",               None),
    ("JSON null",                   "null",                    None),
    ("JSON array",                  "[1,2,3]",                 None),
    ("unknown command",             '{"command":"bogus"}',     None),
    ("decision missing action",     '{"command":"decision","symbol":"BTC"}', None),
    ("arb bad type",                '{"command":"arb","opportunities":"nope"}', None),
    ("portfolio bad trades",        '{"command":"portfolio","open_trades":5}', None),
]

for name, stdin_text, args in cases:
    rc, out, err = run(stdin_text, args)
    try:
        parsed = json.loads(out.splitlines()[-1]) if out else None
        summ = "ok=%s error_type=%s" % (parsed.get("ok"), parsed.get("error_type"))
    except Exception:
        summ = "NON-JSON OUTPUT: %r" % out[:120]
    print("%-26s rc=%s  %s" % (name, rc, summ))
