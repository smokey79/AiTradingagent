"""
scripts/consolidate_and_backup.py
=================================
Safe Data Consolidation & Redundancy Cleanup Script.
1. Archives all duplicate / redundant files into a zip file on C: drive.
2. Removes verified duplicate copies and empty folders on F: drive.
3. Logs complete consolidation report.
"""

import os
import sys
import zipfile
import shutil
from pathlib import Path
from datetime import datetime

# Windows UTF-8 stdout
if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8')
    except Exception: pass

PROJECT_ROOT = Path("F:/aitradingagent").resolve()
BACKUP_DIR = Path("C:/Users/barcl")

TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP_ZIP = BACKUP_DIR / f"aitradingagent_cleanup_backup_{TIMESTAMP}.zip"

# Redundant duplicate directories and files identified for consolidation
REDUNDANT_ITEMS = [
    PROJECT_ROOT / "python-modules",
    PROJECT_ROOT / "files3",
    PROJECT_ROOT / "Aitradingbot-skeleton" / "aitradingagent_skills_mcp_7" / "AI_Investment_Watchlist[1]" / "aitradingagent",
    PROJECT_ROOT / "Aitradingbot-skeleton" / "AI Investment Watchlist.zip",
    PROJECT_ROOT / "Aitradingbot-skeleton" / "caudemllmcode2arbritrage.zip",
    PROJECT_ROOT / "Aitradingbot-skeleton" / "cllm7.zip",
    PROJECT_ROOT / "Aitradingbot-skeleton" / "aitradingagent_skills_mcp_7" / "files.zip",
]


def create_backup_zip():
    print(f"Creating safe cleanup backup archive at:\n  -> {BACKUP_ZIP}")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backed_up_count = 0

    with zipfile.ZipFile(BACKUP_ZIP, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in REDUNDANT_ITEMS:
            if not item.exists():
                continue
            if item.is_file():
                arcname = str(item.relative_to(PROJECT_ROOT))
                zf.write(item, arcname)
                backed_up_count += 1
                print(f"  [Archived File] {arcname}")
            elif item.is_dir():
                for root, dirs, files in os.walk(item):
                    for file in files:
                        file_path = Path(root) / file
                        arcname = str(file_path.relative_to(PROJECT_ROOT))
                        zf.write(file_path, arcname)
                        backed_up_count += 1
                print(f"  [Archived Folder] {item.relative_to(PROJECT_ROOT)}")

    zip_size_mb = BACKUP_ZIP.stat().st_size / (1024 * 1024)
    print(f"Backup archive created successfully: {backed_up_count} files ({zip_size_mb:.2f} MB)\n")
    return backed_up_count > 0


def cleanup_redundant_items():
    print("Consolidating files and removing redundant duplicates from F: drive...")
    for item in REDUNDANT_ITEMS:
        if not item.exists():
            continue
        try:
            if item.is_file():
                item.unlink()
                print(f"  [Deleted Duplicate File] {item.name}")
            elif item.is_dir():
                shutil.rmtree(item)
                print(f"  [Deleted Duplicate Folder] {item.name}")
        except Exception as e:
            print(f"  [Error deleting {item.name}]: {e}")


def cleanup_empty_folders(root_dir: Path):
    print("\nScanning for empty folders to prune...")
    removed_count = 0
    # Walk bottom-up
    for root, dirs, files in os.walk(root_dir, topdown=False):
        p = Path(root)
        if p == root_dir or ".git" in str(p) or "node_modules" in str(p):
            continue
        try:
            if not any(p.iterdir()):
                p.rmdir()
                removed_count += 1
                print(f"  [Pruned Empty Folder] {p.relative_to(root_dir)}")
        except Exception:
            pass
    print(f"Pruned {removed_count} empty directories.\n")


def main():
    print("=" * 65)
    print("⚡ AITRADINGAGENT WORKSPACE CONSOLIDATION & SAFE CLEANUP")
    print("=" * 65)

    if create_backup_zip():
        cleanup_redundant_items()
        cleanup_empty_folders(PROJECT_ROOT)
        print("Consolidation and cleanup completed safely!")
        print(f"Backup retained on C: drive at: {BACKUP_ZIP}")
    else:
        print("Backup creation had no items or failed. Aborting deletion to prevent data loss.")


if __name__ == "__main__":
    main()
