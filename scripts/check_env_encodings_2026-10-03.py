r"""check_env_encodings_2026-10-03.py -- READ-ONLY. Which env files are valid UTF-8? Prints only byte offsets and the 6 bytes around a bad one (never values of keys)."""
import os
R = r"F:\aitradingagent"
for rel in [".env", ".env.paper", r"config\.env", r"config\master.env", ".env.example", r".env.bak-20261003-212120"]:
    p = os.path.join(R, rel)
    if not os.path.exists(p):
        print(f"{rel:32s} missing"); continue
    b = open(p, "rb").read()
    try:
        b.decode("utf-8"); print(f"{rel:32s} {len(b):6d} bytes  valid UTF-8  bom={b[:3]==b'\xef\xbb\xbf'}")
    except UnicodeDecodeError as e:
        ctx = b[max(0, e.start - 3): e.start + 3]
        # show only the line's non-value part: the comment/key text before '=' on that line
        ls = b.rfind(b"\n", 0, e.start) + 1; le = b.find(b"\n", e.start)
        line = b[ls: le if le != -1 else len(b)].decode("cp1252", "replace")
        key = line.split("=")[0][:60] if not line.lstrip().startswith("#") else line[:90]
        print(f"{rel:32s} {len(b):6d} bytes  INVALID at offset {e.start} (byte 0x{b[e.start]:02x}); line starts: {key!r}")
