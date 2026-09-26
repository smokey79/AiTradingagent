"""
export_ledger_to_csv.py -- converts one of the JSON trade-record files in
F:\\aitradingagent\\data\\ into the CSV shape jedai-match.jar needs
(header row, unique id as the FIRST column).

Handles BOTH shapes found in this project's data folder:
  - JSON Lines (one JSON object per line): trade_ledger.json,
    quarantine_simulated_trades.json, trade_ledger_backup_*.json
  - a single JSON array: lost_trades_memory.json

Usage:
  python export_ledger_to_csv.py <input.json> <output.csv>

Never edits the source file -- read-only.
"""
import csv
import json
import sys


def load_records(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read().strip()
    if not text:
        return []
    if text.startswith("["):
        return json.loads(text)
    records = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        records.append(json.loads(line))
    return records


def flatten(record, prefix=""):
    """Flattens nested dicts (e.g. marketSnapshot: {...}) into flat columns."""
    out = {}
    for k, v in record.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(flatten(v, key + "_"))
        else:
            out[key] = v
    return out


def main():
    if len(sys.argv) != 3:
        print("Usage: python export_ledger_to_csv.py <input.json> <output.csv>")
        sys.exit(1)
    in_path, out_path = sys.argv[1], sys.argv[2]

    records = [flatten(r) for r in load_records(in_path)]
    if not records:
        print(f"No records found in {in_path} -- nothing written.")
        return

    # id column first (falls back to row number if a record has no "id")
    fieldnames = ["id"]
    for r in records:
        for k in r:
            if k != "id" and k not in fieldnames:
                fieldnames.append(k)

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for i, r in enumerate(records):
            row = dict(r)
            row.setdefault("id", f"row{i}")
            w.writerow(row)

    print(f"Wrote {len(records)} rows, {len(fieldnames)} columns -> {out_path}")


if __name__ == "__main__":
    main()
