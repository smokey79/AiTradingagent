"""tests/test_build_master_env.py (2026-10-03) -- offline tests for scripts/build_master_env.py using FAKE keys in a temp folder.
Run: .venv\\Scripts\\python.exe tests\\test_build_master_env.py
"""
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_master_env as b  # noqa: E402

FAKE_OR = "sk-or-v1-" + "a1b2c3d4" * 6
FAKE_OR_OLD = "sk-or-v1-" + "0f9e8d7c" * 6
FAKE_ANT = "sk-ant-api03-" + "Zz9Yy8Xx" * 5
FAKE_GEM = "AIza" + "SyFAKEFAKEFAKEFAKEFAKE1234567890ab"
FAKE_DS = "sk-" + "0123456789abcdef" * 2
FAKE_WALLET = "0x" + "ab" * 32
FAKE_ENV_REAL = "real-env-secret-value-1111"
FAKE_GROQ = "gsk_" + "Qq7Ww6Ee" * 6
FAKE_BINANCE = "fakebinancesecret" + "5" * 20
passed = failed = 0


def t(name, fn):
    global passed, failed
    try:
        fn()
        passed += 1
        print("PASS", name)
    except AssertionError as e:
        failed += 1
        print("FAIL", name, "-", e)


def make_world():
    d = Path(tempfile.mkdtemp(prefix="menv_"))
    (d / "src").mkdir()
    (d / "src" / "a.js").write_text(
        "const k=process.env.OPENROUTER_API_KEY; const g=process.env.GEMINI_API_KEY; const x=process.env.ANTHROPIC_API_KEY;"
        "const d=process.env.DEEPSEEK_API_KEY; const w=process.env.MY_WALLET_PRIVATE_KEY; const e=process.env.EXISTING_API_KEY; const m=process.env.NOWHERE_API_KEY;"
        "const q=process.env.GROQ_API_KEY; const bn=process.env.BINANCE_API_SECRET;")
    # .env: a real value, a placeholder, and raw bytes that are not valid UTF-8 (must survive untouched)
    env = (b"# comment with odd bytes \xe2\x80\x9c \xff\xfe end\r\n" b"EXISTING_API_KEY=" + FAKE_ENV_REAL.encode() + b"\r\n"
           b"ANTHROPIC_API_KEY=your_key_here\r\n" b"TRADING_MODE=paper\r\n")
    (d / ".env").write_bytes(env)
    src = d / "srcfiles"
    src.mkdir()
    (src / "or_new.env").write_text(f"OPENROUTER_API_KEY={FAKE_OR}\n")
    (src / "or_old.env").write_text(f"OPENROUTER_API_KEY={FAKE_OR_OLD}\n")
    os.utime(src / "or_old.env", (time.time() - 90 * 86400,) * 2)
    (src / "claude.txt").write_text(FAKE_ANT + "\n")                                  # bare key, named by prefix
    (src / "gem.env.txt").write_bytes(("GOOGLE_API_KEY=" + FAKE_GEM + "\n").encode("utf-16"))  # UTF-16 with BOM, alias name
    (src / "deepseek.env.txt").write_text(FAKE_DS + "\n")                              # bare hex key, named by file name
    (src / "wallet.env").write_text(f"MY_WALLET_PRIVATE_KEY={FAKE_WALLET}\nSEED_PHRASE=word word word\n")
    (src / "conflict.env").write_text('EXISTING_API_KEY=other-value-should-not-win-2222\nexport TELEGRAM_BOT_TOKEN: "tg-fake-token-3333"\n')
    (src / "placeholders.env").write_text("NOWHERE_API_KEY=your_api_key_here\nEMPTY_API_KEY=\n")
    (src / "provider_word.env").write_text(f"GROQ={FAKE_GROQ}\n")                       # provider name used as the variable name
    (src / "labels.env").write_text("Secret=abcdefghijklmnopqrstuvwxyz123456\nTOKENS=abcdefghijklmnopqrstuvwxyz\n")  # labels, not variables
    (src / "exch.env").write_text(f"BINANCE_API_SECRET={FAKE_BINANCE}\n")                # exchange credential: held back from .env
    return d, [str(p) for p in sorted(src.iterdir())], env


def run(d, srcs, *flags):
    lines = []
    args = ["--root", str(d), "--env", str(d / ".env"), "--master", str(d / "config" / "master.env"), "--candidates", str(d / "none.txt")]
    for s in srcs:
        args += ["--source", s]
    res = b.run(args + list(flags), out=lines.append)
    return res, "\n".join(lines)


ALL_SECRETS = [FAKE_OR, FAKE_OR_OLD, FAKE_ANT, FAKE_GEM, FAKE_DS, FAKE_WALLET, FAKE_ENV_REAL, FAKE_GROQ, FAKE_BINANCE,
               "other-value-should-not-win-2222", "tg-fake-token-3333", "abcdefghijklmnopqrstuvwxyz123456"]


def test_parse():
    pairs = dict(b.parse_text('export A_KEY="v 1"\nB_TOKEN: v2\nC_SECRET=v3 # note\n# D=x\n', "x.env"))
    assert pairs == {"A_KEY": "v 1", "B_TOKEN": "v2", "C_SECRET": "v3"}, pairs
    assert b.parse_text(FAKE_ANT, "claude.txt") == [("ANTHROPIC_API_KEY", FAKE_ANT)]
    assert b.parse_text(FAKE_DS, "deepseek.env.txt") == [("DEEPSEEK_API_KEY", FAKE_DS)]
    assert b.parse_text(FAKE_DS, "random.txt") == []  # an unlabelled hex key is NOT guessed
    assert b.decode_bytes("K=v\n".encode("utf-16")) .startswith("K=v")


def test_dry_run_writes_nothing_and_leaks_nothing():
    d, srcs, env0 = make_world()
    res, text = run(d, srcs)
    assert (d / ".env").read_bytes() == env0 and not (d / "config" / "master.env").exists()
    for s in ALL_SECRETS:
        assert s not in text, "a secret value appeared in the report"
    assert "DRY RUN" in text


def test_apply_fills_correctly():
    d, srcs, env0 = make_world()
    res, text = run(d, srcs, "--apply")
    new = (d / ".env").read_bytes()
    assert FAKE_ENV_REAL.encode() in new, "real value must be kept"
    assert b"other-value-should-not-win-2222" not in new, "must not overwrite a real .env value"
    assert b"# comment with odd bytes \xe2\x80\x9c \xff\xfe end\r\n" in new, "unrelated bytes must be preserved exactly"
    assert b"TRADING_MODE=paper\r\n" in new
    assert FAKE_ANT.encode() in new and b"your_key_here" not in new, "placeholder replaced in place"
    assert ("OPENROUTER_API_KEY=" + FAKE_OR).encode() in new, "newest source wins when .env has none"
    assert FAKE_OR_OLD.encode() not in new
    assert ("GEMINI_API_KEY=" + FAKE_GEM).encode() in new, "alias GOOGLE_API_KEY fills GEMINI_API_KEY"
    assert ("DEEPSEEK_API_KEY=" + FAKE_DS).encode() in new
    assert FAKE_WALLET.encode() not in new and b"SEED_PHRASE" not in new
    assert b"NOWHERE_API_KEY=" not in new, "a name with only placeholder sources must not be invented"
    for s in ALL_SECRETS:
        assert s not in text, "a secret value appeared in the report"


def test_master_file():
    d, srcs, _ = make_world()
    run(d, srcs, "--apply")
    m = (d / "config" / "master.env").read_text()
    assert f"OPENROUTER_API_KEY={FAKE_OR}" in m and f"ANTHROPIC_API_KEY={FAKE_ANT}" in m
    assert FAKE_WALLET not in m and "SEED_PHRASE" not in m and "MY_WALLET_PRIVATE_KEY" not in m
    assert "TELEGRAM_BOT_TOKEN=tg-fake-token-3333" in m
    assert "EXISTING_API_KEY=" + FAKE_ENV_REAL in m, "current .env value wins in the master too"


def test_idempotent():
    d, srcs, _ = make_world()
    run(d, srcs, "--apply")
    after1 = (d / ".env").read_bytes()
    res, text = run(d, srcs, "--apply")
    assert (d / ".env").read_bytes() == after1 and res["fills"] == [], res


def test_wallet_reported_by_name_only():
    d, srcs, _ = make_world()
    res, text = run(d, srcs)
    assert "MY_WALLET_PRIVATE_KEY" in res["wallet_skipped"] and "SEED_PHRASE" in res["wallet_skipped"]
    assert "NOWHERE_API_KEY" in res["missing"]


def test_provider_word_exchange_holdback_and_labels():
    d, srcs, _ = make_world()
    res, text = run(d, srcs, "--apply")
    env = (d / ".env").read_bytes()
    m = (d / "config" / "master.env").read_text()
    assert ("GROQ_API_KEY=" + FAKE_GROQ).encode() in env, "GROQ=<key> must be filed as GROQ_API_KEY"
    assert b"BINANCE_API_SECRET" not in env, "exchange credentials must not be copied into .env by default"
    assert "BINANCE_API_SECRET=" + FAKE_BINANCE in m, "...but they are kept in master.env"
    assert "BINANCE_API_SECRET" in text and "NOT copied into .env" in text
    assert "Secret=" not in m and "TOKENS=" not in m, "bare labels are not variables"
    assert "TRADING_MODE" not in m, "master.env holds credentials only, not the whole .env"
    d2, srcs2, _ = make_world()
    run(d2, srcs2, "--apply", "--include-exchange-keys")
    assert ("BINANCE_API_SECRET=" + FAKE_BINANCE).encode() in (d2 / ".env").read_bytes()


def test_validation_prefers_working_keys_and_drops_dead_ones():
    d = Path(tempfile.mkdtemp(prefix="menv_v_"))
    (d / "src").mkdir()
    (d / "src" / "a.js").write_text("process.env.CLAUDE_API_KEY; process.env.DEEPSEEK_API_KEY; process.env.OPENAI_API_KEY; process.env.ANTHROPIC_API_KEY;")
    (d / ".env").write_text("TRADING_MODE=paper\n")
    s = d / "s"
    s.mkdir()
    good_ant, dead_claude, ds_new, ds_old, dead_oai = "ant-GOOD-" + "1" * 30, "claude-DEAD-" + "2" * 30, "ds-NOBALANCE-" + "3" * 30, "ds-WORKS-" + "4" * 30, "oai-DEAD-" + "5" * 30
    (s / "a.env").write_text(f"ANTHROPIC_API_KEY={good_ant}\n")
    (s / "b.env").write_text(f"CLAUDE_API_KEY={dead_claude}\nOPENAI_API_KEY={dead_oai}\n")
    (s / "ds_old.env").write_text(f"DEEPSEEK_API_KEY={ds_old}\n")
    os.utime(s / "ds_old.env", (time.time() - 40 * 86400,) * 2)
    (s / "ds_new.env").write_text(f"DEEPSEEK_API_KEY={ds_new}\n")
    states = {good_ant: "ok", dead_claude: "invalid", ds_new: "no_balance", ds_old: "ok", dead_oai: "invalid"}
    real = b.check_key
    b.check_key = lambda name, value: (states.get(value, "untested"), "")
    try:
        lines = []
        b.run(["--root", str(d), "--env", str(d / ".env"), "--master", str(d / "m.env"), "--candidates", str(d / "none"), "--validate", "--apply"]
              + sum([["--source", str(p)] for p in s.iterdir()], []), out=lines.append)
    finally:
        b.check_key = real
    env, m, text = (d / ".env").read_text(), (d / "m.env").read_text(), "\n".join(lines)
    assert f"CLAUDE_API_KEY={good_ant}" in env, "CLAUDE_API_KEY should be filled from the working ANTHROPIC key, not the rejected one"
    assert dead_claude not in env + m and dead_oai not in env + m, "rejected keys must not be carried over"
    assert f"DEEPSEEK_API_KEY={ds_old}" in env and ds_new not in env + m, "a key with balance beats a newer key with none"
    assert "OPENAI_API_KEY" in text and "rejected by the provider" in text
    for secret in (good_ant, dead_claude, ds_new, ds_old, dead_oai):
        assert secret not in text


def test_empty_value_with_crlf_is_filled_on_the_same_line():
    env = b"A_KEY=\r\nB_KEY=keep-me\r\nC_KEY=your_key_here\nD_KEY=\r\n"
    out = b.fill_env_bytes(env, {"A_KEY": "newA", "C_KEY": "newC", "D_KEY": "newD", "E_KEY": "newE"}, "stamp")
    lines = out.split(b"\n")
    assert lines[0] == b"A_KEY=newA\r" if lines[0].endswith(b"\r") else lines[0] == b"A_KEY=newA", lines[0]
    assert out.startswith(b"A_KEY=newA\r\nB_KEY=keep-me\r\nC_KEY=newC\nD_KEY=newD\r\n"), out[:80]
    assert b"\nE_KEY=newE\n" in out and out.count(b"newA") == 1, "no stray value lines"


def test_disp_hides_hex_in_file_names():
    assert b.disp(Path("Bitget api 4e38d923f576c069750d61e487c7368034a2a26.txt")) == "Bitget api ....txt"


for name, fn in [("parse formats / bare keys / utf-16", test_parse), ("dry run writes nothing and prints no secret", test_dry_run_writes_nothing_and_leaks_nothing),
                 ("apply: keeps real values, fills placeholders, byte-safe, newest wins, alias, no wallet", test_apply_fills_correctly),
                 ("master file content", test_master_file), ("second apply changes nothing", test_idempotent),
                 ("wallet secrets reported by name only", test_wallet_reported_by_name_only),
                 ("provider-word names, exchange keys held back, labels ignored", test_provider_word_exchange_holdback_and_labels),
                 ("validation: working key wins, dead keys dropped, alias fill", test_validation_prefers_working_keys_and_drops_dead_ones),
                 ("empty KEY= with CRLF is filled on the same line", test_empty_value_with_crlf_is_filled_on_the_same_line),
                 ("file names hide key-like hex", test_disp_hides_hex_in_file_names)]:
    t(name, fn)
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
