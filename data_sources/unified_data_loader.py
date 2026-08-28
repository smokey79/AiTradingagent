"""
unified_data_loader.py
======================
Unified loader that prioritizes data from SD card, Google Drive, and local cache.
Automatically syncs and ingests all available data sources.
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime
import pandas as pd

from data_sources.google_drive_connector import GoogleDriveConnector, SDCardConnector

log = logging.getLogger("UnifiedDataLoader")


class UnifiedDataLoader:
    """
    Unified data loader combining SD card, Google Drive, and local sources.
    Prioritizes:
    1. Local cache (fastest)
    2. SD card (already local)
    3. Google Drive (synced on-demand)
    """

    def __init__(
        self,
        sd_root: str = "E:/",
        google_drive_creds: str = "google_service_account.json",
        cache_dir: str = "./cache",
        auto_sync: bool = True,
    ):
        """
        Initialize unified data loader.
        
        Args:
            sd_root: SD card root path
            google_drive_creds: Path to Google service account JSON
            cache_dir: Main cache directory
            auto_sync: Automatically sync Google Drive on initialization
        """
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        self.sd_connector = SDCardConnector(sd_root=sd_root, cache_dir=str(self.cache_dir / "sd_card"))
        self.drive_connector = GoogleDriveConnector(
            credentials_file=google_drive_creds,
            cache_dir=str(self.cache_dir / "google_drive"),
        )
        self.load_log = self.cache_dir / "data_load_log.json"
        self.load_history = self._load_history()

        if auto_sync:
            self._auto_sync()

    def _load_history(self) -> Dict[str, Any]:
        """Load previous sync history."""
        if self.load_log.exists():
            with open(self.load_log, "r") as f:
                return json.load(f)
        return {"syncs": []}

    def _save_history(self, event: Dict[str, Any]) -> None:
        """Save sync event to history."""
        self.load_history["syncs"].append(event)
        with open(self.load_log, "w") as f:
            json.dump(self.load_history, f, indent=2)

    def _auto_sync(self) -> None:
        """Automatically sync SD card and Google Drive on init."""
        log.info("Auto-syncing data sources...")

        # Index SD card
        try:
            sd_index = self.sd_connector.index_sd_card()
            self._save_history({
                "type": "sd_index",
                "timestamp": datetime.utcnow().isoformat(),
                "files_found": sd_index["total_files"],
            })
        except Exception as e:
            log.warning(f"SD card sync failed: {e}")

        # Sync Google Drive
        try:
            drive_result = self.drive_connector.sync_folder(
                "AiTradingAgent",
                str(self.cache_dir / "google_drive" / "sync"),
            )
            self._save_history(drive_result)
        except Exception as e:
            log.warning(f"Google Drive sync failed: {e}")

    def load_market_data(self, symbol: str = "BTC/USDT") -> Optional[pd.DataFrame]:
        """
        Load market data for a symbol from any available source.
        Priority: SD card cache → Google Drive → local cache
        """
        filename = f"market_data_{symbol.replace('/', '_')}.json"

        # 1. Check local cache
        local_cache = self.cache_dir / filename
        if local_cache.exists():
            log.info(f"Loading {symbol} from local cache")
            try:
                with open(local_cache, "r") as f:
                    data = json.load(f)
                return pd.DataFrame(data)
            except Exception as e:
                log.warning(f"Failed to load from local cache: {e}")

        # 2. Check SD card
        sd_files = self.sd_connector.list_data_files(filename)
        if sd_files:
            log.info(f"Loading {symbol} from SD card")
            try:
                local_path = self.sd_connector.copy_data_to_cache(sd_files[0]["path"])
                with open(local_path, "r") as f:
                    data = json.load(f)
                return pd.DataFrame(data)
            except Exception as e:
                log.warning(f"Failed to load from SD card: {e}")

        # 3. Check Google Drive
        drive_files = self.drive_connector.list_files("AiTradingAgent")
        for file_meta in drive_files:
            if symbol in file_meta["name"] and file_meta["name"].endswith(".json"):
                log.info(f"Downloading {symbol} from Google Drive")
                try:
                    local_path = self.drive_connector.download_file(file_meta["id"], file_meta["name"])
                    with open(local_path, "r") as f:
                        data = json.load(f)
                    return pd.DataFrame(data)
                except Exception as e:
                    log.warning(f"Failed to load from Google Drive: {e}")

        log.warning(f"No data found for {symbol}")
        return None

    def load_backtest_results(self, strategy_name: str = None) -> List[Dict[str, Any]]:
        """Load backtest results from all sources."""
        results = []

        # Check SD card
        sd_files = self.sd_connector.list_data_files("*backtest*.json")
        for file_meta in sd_files:
            if strategy_name is None or strategy_name in file_meta["name"]:
                try:
                    local_path = self.sd_connector.copy_data_to_cache(file_meta["path"], "backtests")
                    with open(local_path, "r") as f:
                        results.append(json.load(f))
                except Exception as e:
                    log.warning(f"Failed to load backtest {file_meta['name']}: {e}")

        # Check Google Drive
        drive_files = self.drive_connector.list_files("AiTradingAgent")
        for file_meta in drive_files:
            if "backtest" in file_meta["name"].lower() and "json" in file_meta["name"]:
                if strategy_name is None or strategy_name in file_meta["name"]:
                    try:
                        local_path = self.drive_connector.download_file(
                            file_meta["id"],
                            file_meta["name"],
                            str(self.cache_dir / "google_drive" / "backtests"),
                        )
                        with open(local_path, "r") as f:
                            results.append(json.load(f))
                    except Exception as e:
                        log.warning(f"Failed to load backtest from Drive: {e}")

        log.info(f"Loaded {len(results)} backtest results")
        return results

    def load_model_files(self, model_type: str = None) -> List[Dict[str, str]]:
        """
        Discover and locate model files across all sources.
        
        Args:
            model_type: Filter by model type (e.g., "neural_network", "random_forest")
        
        Returns:
            List of model file metadata with local paths
        """
        models = []

        # Check SD card for .pkl, .pth, .h5, .onnx files
        for pattern in ["*.pkl", "*.pth", "*.h5", "*.onnx", "*.joblib"]:
            sd_files = self.sd_connector.list_data_files(pattern)
            for file_meta in sd_files:
                if "model" in file_meta["name"].lower() or "weights" in file_meta["name"].lower():
                    if model_type is None or model_type in file_meta["name"]:
                        try:
                            local_path = self.sd_connector.copy_data_to_cache(file_meta["path"], "models")
                            models.append({
                                "name": file_meta["name"],
                                "source": "SD_CARD",
                                "local_path": local_path,
                                "size_mb": file_meta["size_mb"],
                                "type": file_meta["type"],
                            })
                        except Exception as e:
                            log.warning(f"Failed to load model {file_meta['name']}: {e}")

        # Check Google Drive
        drive_files = self.drive_connector.list_files("AiTradingAgent")
        for file_meta in drive_files:
            if any(file_meta["name"].endswith(ext) for ext in [".pkl", ".pth", ".h5", ".onnx"]):
                if model_type is None or model_type in file_meta["name"]:
                    try:
                        local_path = self.drive_connector.download_file(
                            file_meta["id"],
                            file_meta["name"],
                            str(self.cache_dir / "google_drive" / "models"),
                        )
                        models.append({
                            "name": file_meta["name"],
                            "source": "GOOGLE_DRIVE",
                            "local_path": local_path,
                            "size_mb": float(file_meta.get("size", 0)) / (1024 * 1024),
                            "type": file_meta["mimeType"],
                        })
                    except Exception as e:
                        log.warning(f"Failed to download model from Drive: {e}")

        log.info(f"Found {len(models)} model files")
        return models

    def list_all_available_data(self) -> Dict[str, List[Dict[str, Any]]]:
        """
        List all data available across all sources.
        
        Returns:
            Dict with data categories and file listings
        """
        inventory = {
            "market_data": [],
            "backtests": [],
            "models": [],
            "configs": [],
            "logs": [],
        }

        # Scan SD card
        sd_files = self.sd_connector.list_data_files("*")
        for file_meta in sd_files:
            if "market" in file_meta["name"]:
                inventory["market_data"].append({"source": "SD_CARD", **file_meta})
            elif "backtest" in file_meta["name"]:
                inventory["backtests"].append({"source": "SD_CARD", **file_meta})
            elif any(file_meta["name"].endswith(ext) for ext in [".pkl", ".pth", ".h5"]):
                inventory["models"].append({"source": "SD_CARD", **file_meta})
            elif file_meta["name"].endswith(".yaml") or file_meta["name"].endswith(".json"):
                inventory["configs"].append({"source": "SD_CARD", **file_meta})
            elif file_meta["name"].endswith(".log"):
                inventory["logs"].append({"source": "SD_CARD", **file_meta})

        # Scan Google Drive
        drive_files = self.drive_connector.list_files("AiTradingAgent")
        for file_meta in drive_files:
            if "market" in file_meta["name"].lower():
                inventory["market_data"].append({"source": "GOOGLE_DRIVE", **file_meta})
            elif "backtest" in file_meta["name"].lower():
                inventory["backtests"].append({"source": "GOOGLE_DRIVE", **file_meta})

        return inventory

    def generate_data_report(self) -> str:
        """Generate a report of all available data sources."""
        inventory = self.list_all_available_data()
        sd_index = self.sd_connector.index_sd_card()

        report = [
            "=" * 70,
            "UNIFIED DATA INVENTORY REPORT",
            "=" * 70,
            f"Generated: {datetime.utcnow().isoformat()}",
            "",
            f"SD CARD STATUS:",
            f"  Root: {self.sd_connector.sd_root}",
            f"  Total Files: {sd_index['total_files']}",
            f"  By Type: {sd_index['by_type']}",
            "",
            f"GOOGLE DRIVE STATUS:",
            f"  Connected: {self.drive_connector.service is not None}",
            "",
            f"DATA CATEGORIES:",
            f"  Market Data Files: {len(inventory['market_data'])}",
            f"  Backtest Results: {len(inventory['backtests'])}",
            f"  Models: {len(inventory['models'])}",
            f"  Configs: {len(inventory['configs'])}",
            f"  Logs: {len(inventory['logs'])}",
            "=" * 70,
        ]

        return "\n".join(report)


if __name__ == "__main__":
    loader = UnifiedDataLoader()
    print(loader.generate_data_report())

    # Load market data
    btc_data = loader.load_market_data("BTC/USDT")
    if btc_data is not None:
        print(f"\nLoaded {len(btc_data)} rows of BTC data")

    # List available models
    models = loader.load_model_files()
    for model in models:
        print(f"Model: {model['name']} ({model['size_mb']:.1f}MB) from {model['source']}")
