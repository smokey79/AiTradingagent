"""
config_external_data.py
=======================
Configuration template for SD card and Google Drive integration.
Copy this to config/external_data_config.json and customize.
"""

EXTERNAL_DATA_CONFIG = {
    # SD Card Configuration
    "sd_card": {
        "enabled": True,
        "root_path": "E:/",
        "auto_index": True,
        "patterns": ["*.json", "*.csv", "*.db", "*.parquet", "*.pkl"],
        "cache_dir": "./cache/sd_card",
        "index_refresh_hours": 24,
    },

    # Google Drive Configuration
    "google_drive": {
        "enabled": True,
        "credentials_file": "google_service_account.json",
        "folder_name": "AiTradingAgent",
        "auto_sync": True,
        "cache_dir": "./cache/google_drive",
        "sync_on_startup": True,
        "sync_interval_hours": 6,
        "file_patterns": {
            "market_data": ["*market*.json", "*ohlcv*.csv"],
            "backtests": ["*backtest*.json", "*backtest*.csv"],
            "models": ["*.pkl", "*.pth", "*.h5", "*.onnx"],
            "configs": ["*.yaml", "*.json"],
        },
    },

    # Local Cache Configuration
    "cache": {
        "root_dir": "./cache/unified_data",
        "max_age_days": 7,
        "max_size_gb": 10,
        "auto_cleanup": True,
    },

    # Data Loader Configuration
    "data_loader": {
        "enabled": True,
        "priority_order": ["local_cache", "sd_card", "google_drive"],
        "default_timeframe": "1h",
        "default_lookback": 50,
        "batch_load": True,
        "batch_size": 10,
    },

    # Pipeline Integration
    "pipeline": {
        "include_historical_data": True,
        "backtest_weighting": 0.30,
        "model_ensemble": True,
        "data_augmentation": True,
    },

    # Logging
    "logging": {
        "level": "INFO",
        "save_sync_log": True,
        "log_file": "./cache/data_load_log.json",
    },
}


if __name__ == "__main__":
    import json
    import os
    
    # Create config file
    config_path = "config/external_data_config.json"
    os.makedirs("config", exist_ok=True)
    
    with open(config_path, "w") as f:
        json.dump(EXTERNAL_DATA_CONFIG, f, indent=2)
    
    print(f"Config template created at {config_path}")
    print("Edit and customize for your setup.")
