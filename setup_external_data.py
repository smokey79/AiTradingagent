#!/usr/bin/env python3
"""
setup_external_data.py
======================
One-time setup script for SD card and Google Drive integration.
Run: python setup_external_data.py
"""

import os
import sys
import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [SETUP] %(message)s")
log = logging.getLogger("Setup")


def setup_directories():
    """Create necessary cache and config directories."""
    directories = [
        "cache",
        "cache/unified_data",
        "cache/sd_card",
        "cache/google_drive",
        "config",
    ]
    
    for dir_path in directories:
        Path(dir_path).mkdir(parents=True, exist_ok=True)
    
    log.info(f"✓ Created {len(directories)} directories")


def create_config_file():
    """Create configuration file from template."""
    from config_external_data import EXTERNAL_DATA_CONFIG
    
    config_path = "config/external_data_config.json"
    with open(config_path, "w") as f:
        json.dump(EXTERNAL_DATA_CONFIG, f, indent=2)
    
    log.info(f"✓ Configuration file created: {config_path}")


def update_env_file():
    """Add external data configuration to .env file."""
    env_file = ".env"
    
    new_vars = """
# ===== EXTERNAL DATA INTEGRATION (SD CARD & GOOGLE DRIVE) =====

# SD Card Configuration
SD_CARD_ROOT=E:/
SD_CARD_ENABLED=true

# Google Drive Configuration
GOOGLE_DRIVE_CREDENTIALS=google_service_account.json
GOOGLE_DRIVE_FOLDER=AiTradingAgent
GOOGLE_DRIVE_ENABLED=true
GOOGLE_DRIVE_AUTO_SYNC=true

# Cache Configuration
CACHE_DIR=./cache/unified_data
DATA_LOADER_ENABLED=true
DATA_LOADER_AUTO_SYNC=true
"""
    
    if os.path.exists(env_file):
        with open(env_file, "a") as f:
            f.write(new_vars)
        log.info(f"✓ Updated .env file with external data variables")
    else:
        log.warning(f"⚠ .env file not found. Create it and add these variables manually:")
        print(new_vars)


def verify_google_drive_setup():
    """Check if Google Drive credentials are available."""
    creds_file = "google_service_account.json"
    
    if os.path.exists(creds_file):
        log.info(f"✓ Google service account found: {creds_file}")
        return True
    else:
        log.warning(f"⚠ Google service account NOT found: {creds_file}")
        print("\nTo set up Google Drive sync:")
        print("1. Go to: https://console.cloud.google.com/iam-admin/serviceaccounts")
        print("2. Create a service account named 'aitradingagent-sync'")
        print("3. Create and download a JSON key")
        print("4. Save as 'google_service_account.json' in project root")
        print("5. Share your Google Drive 'AiTradingAgent' folder with the service account email")
        return False


def verify_sd_card():
    """Check if SD card is accessible."""
    sd_root = "E:/"
    
    if os.path.exists(sd_root):
        files = os.listdir(sd_root)
        log.info(f"✓ SD card accessible at {sd_root} ({len(files)} items)")
        return True
    else:
        log.warning(f"⚠ SD card not found at {sd_root}")
        print(f"Check your SD card drive letter and update SD_CARD_ROOT in .env")
        return False


def test_imports():
    """Test if required packages are installed."""
    required = [
        "google.auth",
        "google.oauth2",
        "googleapiclient.discovery",
    ]
    
    missing = []
    for package in required:
        try:
            __import__(package)
        except ImportError:
            missing.append(package)
    
    if missing:
        log.warning(f"⚠ Missing packages: {', '.join(missing)}")
        print("\nInstall with:")
        print("pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client")
        return False
    else:
        log.info(f"✓ All required packages installed")
        return True


def main():
    """Run setup sequence."""
    print("=" * 70)
    print("AI TRADING AGENT — EXTERNAL DATA SETUP")
    print("=" * 70)
    print()
    
    log.info("Starting setup...")
    
    # Step 1: Create directories
    setup_directories()
    
    # Step 2: Create config
    create_config_file()
    
    # Step 3: Update .env
    update_env_file()
    
    # Step 4: Verify setup
    print("\n" + "=" * 70)
    print("VERIFICATION CHECKS")
    print("=" * 70)
    
    google_ok = verify_google_drive_setup()
    sd_ok = verify_sd_card()
    imports_ok = test_imports()
    
    print("\n" + "=" * 70)
    if google_ok and sd_ok and imports_ok:
        print("✓ SETUP COMPLETE")
        print("\nYou can now use external data with:")
        print("  from data_sources.unified_data_loader import UnifiedDataLoader")
        print("  loader = UnifiedDataLoader()")
        print("  print(loader.generate_data_report())")
    else:
        print("⚠ SETUP INCOMPLETE — Address issues above")
        if not imports_ok:
            print("\nRun: pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client")
        if not google_ok:
            print("\nSet up Google Drive API (see GOOGLE_DRIVE_SD_CARD_SETUP.md)")
    
    print("=" * 70)


if __name__ == "__main__":
    main()
