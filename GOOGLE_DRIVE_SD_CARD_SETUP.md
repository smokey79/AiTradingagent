# AI Trading Agent — SD Card & Google Drive Integration Setup

## Overview

Your AI trading agent now integrates all data sources:
- **SD Card (E:/)**: Historical market data, models, backtests
- **Google Drive**: Project files, configs, additional datasets
- **Local Cache**: Fast access with automatic sync

## Quick Start

### 1. Install Dependencies

```bash
pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client
```

### 2. Set Up Google Drive API

#### a. Create a Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project: **AiTradingAgent**
3. Enable the **Google Drive API**

#### b. Create a Service Account
1. In Cloud Console → **IAM & Admin** → **Service Accounts**
2. Create a new service account: `aitradingagent-sync`
3. Create a JSON key and download it
4. Save as `google_service_account.json` in your project root

#### c. Share Your Google Drive Folder
1. Create or identify your `AiTradingAgent` folder on Google Drive
2. Share it with the service account email (e.g., `aitradingagent-sync@PROJECT_ID.iam.gserviceaccount.com`)
3. Grant **Editor** access

### 3. Configure Environment Variables

Update `.env`:

```env
# SD Card Configuration
SD_CARD_ROOT=E:/

# Google Drive Configuration
GOOGLE_DRIVE_CREDENTIALS=google_service_account.json
GOOGLE_DRIVE_FOLDER=AiTradingAgent
GOOGLE_DRIVE_AUTO_SYNC=true

# Cache Configuration
CACHE_DIR=./cache
DATA_LOADER_ENABLED=true
```

### 4. Initialize the Data Loader

```python
from data_sources.unified_data_loader import UnifiedDataLoader

# Initialize with auto-sync
loader = UnifiedDataLoader(
    sd_root="E:/",
    google_drive_creds="google_service_account.json",
    cache_dir="./cache/unified_data",
    auto_sync=True,
)

# Generate data report
print(loader.generate_data_report())
```

## Usage Examples

### Load Market Data from Any Source

```python
loader = UnifiedDataLoader()

# Loads from: local cache → SD card → Google Drive (in order)
btc_data = loader.load_market_data("BTC/USDT")
eth_data = loader.load_market_data("ETH/USDT")
```

### Load Backtest Results

```python
# Get all backtests
all_backtests = loader.load_backtest_results()

# Get backtests for specific strategy
rsi_backtests = loader.load_backtest_results("rsi_strategy")
```

### Load Model Files

```python
# Get all models
all_models = loader.load_model_files()

# Get neural network models only
nn_models = loader.load_model_files("neural_network")

for model in nn_models:
    print(f"{model['name']}: {model['source']} → {model['local_path']}")
```

### List All Available Data

```python
inventory = loader.list_all_available_data()

print(f"Market Data Files: {len(inventory['market_data'])}")
print(f"Backtest Results: {len(inventory['backtests'])}")
print(f"Models: {len(inventory['models'])}")
print(f"Configs: {len(inventory['configs'])}")
```

### Generate Data Inventory Report

```python
report = loader.generate_data_report()
print(report)
```

## Updated Data Pipeline (v5)

The `data_pipeline.py` now includes historical data:

```python
from data_pipeline import DataPipeline

pipeline = DataPipeline(
    use_external_data=True,
    sd_root="E:/",
    google_drive_creds="google_service_account.json",
)

# Run with historical data included
package = pipeline.run(
    account_balance=1000.0,
    symbol="BTC/USDT",
    include_historical=True,
)

# Access historical data
print(f"Backtests loaded: {len(package.get('historical_data', {}).get('backtests', []))}")
print(f"Models available: {len(package.get('historical_data', {}).get('models', []))}")
```

## File Organization

```
F:\aitradingagent\
├── data_sources/
│   ├── google_drive_connector.py    # New: Google Drive sync
│   ├── unified_data_loader.py       # New: Unified loader
│   ├── ccxt_feed.py
│   └── sosovalue_feed.py
├── cache/
│   ├── unified_data/
│   │   ├── sd_card/
│   │   │   ├── market_data/
│   │   │   ├── backtests/
│   │   │   └── models/
│   │   ├── google_drive/
│   │   │   ├── sync/
│   │   │   ├── backtests/
│   │   │   └── models/
│   │   └── data_load_log.json       # Sync history
│   └── ...
├── data_pipeline.py                 # Updated v5
├── .env                             # Updated with new vars
└── google_service_account.json      # (Add after GCP setup)
```

## Troubleshooting

### Google Drive Not Connecting
```python
# Check authentication
from data_sources.google_drive_connector import GoogleDriveConnector
drive = GoogleDriveConnector()
if drive.service:
    print("Connected!")
else:
    print("Check credentials file and folder sharing")
```

### SD Card Not Found
```python
# Verify SD card path
import os
sd_root = "E:/"
if os.path.exists(sd_root):
    print(f"SD card found at {sd_root}")
    print(os.listdir(sd_root)[:10])
else:
    print(f"SD card not found at {sd_root}, update SD_CARD_ROOT in .env")
```

### Cache Growing Too Large
```python
# Clear old cache files
import shutil
shutil.rmtree("./cache/unified_data/sd_card", ignore_errors=True)
shutil.rmtree("./cache/unified_data/google_drive", ignore_errors=True)
```

## Features

✅ **Automatic SD Card Indexing** — Scans all files on first load
✅ **Google Drive Sync** — One-time setup, automatic refresh
✅ **Smart Caching** — Faster access on repeated loads
✅ **Data Inventory** — Full report of all available data
✅ **Multi-Source Priority** — Uses fastest available source
✅ **Pipeline Integration** — v5 includes historical data in trading decisions

## Next Steps

1. ✅ Create Google service account & download JSON key
2. ✅ Share Google Drive folder with service account
3. ✅ Place `google_service_account.json` in project root
4. ✅ Update `.env` with SD card path and settings
5. ✅ Run `python -c "from data_sources.unified_data_loader import UnifiedDataLoader; loader = UnifiedDataLoader(); print(loader.generate_data_report())"`
6. ✅ Test with real trading cycle

