"""
google_drive_connector.py
========================
Connects to Google Drive to fetch project files, historical data, models, and backtests.
Stores files locally and syncs on-demand.
"""

import os
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime
import json

try:
    from google.auth.transport.requests import Request
    from google.oauth2.service_account import Credentials
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
    import io
except ImportError:
    logging.warning("Google Drive libraries not installed. Install: pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client")

log = logging.getLogger("GoogleDriveConnector")


class GoogleDriveConnector:
    """
    Manages Google Drive synchronization for project files, historical data, models, and backtests.
    """

    def __init__(self, credentials_file: str = "google_service_account.json", cache_dir: str = "./cache/google_drive"):
        """
        Initialize Google Drive connector.
        
        Args:
            credentials_file: Path to Google service account JSON file
            cache_dir: Local cache directory for downloaded files
        """
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.service = None
        self.credentials_file = credentials_file
        self._authenticate()

    def _authenticate(self) -> None:
        """
        Authenticate with Google Drive API using service account.
        """
        if not os.path.exists(self.credentials_file):
            log.warning(f"Service account file not found: {self.credentials_file}")
            log.info("Create a service account at: https://console.cloud.google.com/iam-admin/serviceaccounts")
            return

        try:
            credentials = service_account.Credentials.from_service_account_file(
                self.credentials_file,
                scopes=["https://www.googleapis.com/auth/drive.readonly"],
            )
            self.service = build("drive", "v3", credentials=credentials)
            log.info("Google Drive authenticated successfully")
        except Exception as e:
            log.error(f"Failed to authenticate Google Drive: {e}")

    def list_files(self, folder_name: str = "AiTradingAgent", mime_type: str = None) -> List[Dict[str, Any]]:
        """
        List all files in a Google Drive folder.
        
        Args:
            folder_name: Folder name in Google Drive
            mime_type: Optional MIME type filter (e.g., "application/json", "text/csv")
        
        Returns:
            List of file metadata dicts with id, name, size, modified_time
        """
        if not self.service:
            log.error("Google Drive service not initialized")
            return []

        try:
            query = f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
            folder_result = self.service.files().list(q=query, spaces="drive", fields="files(id)", pageSize=1).execute()
            folder_id = folder_result.get("files", [{}])[0].get("id")

            if not folder_id:
                log.warning(f"Folder '{folder_name}' not found in Google Drive")
                return []

            query = f"'{folder_id}' in parents and trashed=false"
            if mime_type:
                query += f" and mimeType='{mime_type}'"

            results = self.service.files().list(
                q=query,
                spaces="drive",
                fields="files(id, name, size, mimeType, modifiedTime)",
                pageSize=100,
            ).execute()

            files = results.get("files", [])
            log.info(f"Found {len(files)} files in '{folder_name}'")
            return files
        except Exception as e:
            log.error(f"Error listing Google Drive files: {e}")
            return []

    def download_file(self, file_id: str, file_name: str, local_path: str = None) -> Optional[str]:
        """
        Download a file from Google Drive.
        
        Args:
            file_id: Google Drive file ID
            file_name: Original file name
            local_path: Local directory to save (default: cache_dir)
        
        Returns:
            Local file path if successful, None otherwise
        """
        if not self.service:
            log.error("Google Drive service not initialized")
            return None

        try:
            local_dir = Path(local_path) if local_path else self.cache_dir
            local_dir.mkdir(parents=True, exist_ok=True)
            local_file = local_dir / file_name

            request = self.service.files().get_media(fileId=file_id)
            file_handler = io.FileIO(str(local_file), "wb")
            downloader = MediaIoBaseDownload(file_handler, request)

            done = False
            while not done:
                _, done = downloader.next_chunk()

            file_handler.close()
            log.info(f"Downloaded: {local_file}")
            return str(local_file)
        except Exception as e:
            log.error(f"Error downloading file {file_name}: {e}")
            return None

    def sync_folder(self, drive_folder: str, local_folder: str, file_pattern: str = None) -> Dict[str, Any]:
        """
        Sync entire folder from Google Drive to local.
        
        Args:
            drive_folder: Google Drive folder name
            local_folder: Local destination folder
            file_pattern: Optional pattern filter (e.g., "*.json", "*.csv")
        
        Returns:
            Sync summary dict with counts and status
        """
        files = self.list_files(drive_folder)
        if not files:
            return {"status": "error", "message": f"Folder '{drive_folder}' not found or empty"}

        downloaded = 0
        failed = 0
        local_path = Path(local_folder)

        for file_meta in files:
            if file_pattern and not file_meta["name"].endswith(file_pattern.replace("*", "")):
                continue

            result = self.download_file(file_meta["id"], file_meta["name"], str(local_path))
            if result:
                downloaded += 1
            else:
                failed += 1

        return {
            "status": "success",
            "folder": drive_folder,
            "downloaded": downloaded,
            "failed": failed,
            "total": len(files),
            "local_path": str(local_path),
            "timestamp": datetime.utcnow().isoformat(),
        }

    def get_file_metadata(self, file_id: str) -> Optional[Dict[str, Any]]:
        """
        Get metadata for a specific file.
        """
        if not self.service:
            return None

        try:
            file_meta = self.service.files().get(
                fileId=file_id,
                fields="id, name, size, mimeType, modifiedTime, webViewLink",
            ).execute()
            return file_meta
        except Exception as e:
            log.error(f"Error getting file metadata: {e}")
            return None


class SDCardConnector:
    """
    Manages SD card data ingestion and synchronization.
    """

    def __init__(self, sd_root: str = "E:/", cache_dir: str = "./cache/sd_card"):
        """
        Initialize SD card connector.
        
        Args:
            sd_root: Root path of SD card (typically E:/ or /mnt/sdcard)
            cache_dir: Local cache for indexed/processed data
        """
        self.sd_root = Path(sd_root)
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.file_index = self.cache_dir / "sd_file_index.json"

    def list_data_files(self, pattern: str = "*.json") -> List[Dict[str, Any]]:
        """
        Scan SD card for data files matching pattern.
        
        Args:
            pattern: File pattern (e.g., "*.json", "*.csv", "*.db")
        
        Returns:
            List of file metadata dicts
        """
        files = []
        try:
            if not self.sd_root.exists():
                log.warning(f"SD card not found at {self.sd_root}")
                return files

            for file_path in self.sd_root.rglob(pattern):
                stat = file_path.stat()
                files.append({
                    "path": str(file_path),
                    "name": file_path.name,
                    "size_mb": stat.st_size / (1024 * 1024),
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "type": file_path.suffix,
                })

            log.info(f"Found {len(files)} files on SD card matching '{pattern}'")
            return files
        except Exception as e:
            log.error(f"Error scanning SD card: {e}")
            return []

    def index_sd_card(self, patterns: List[str] = None) -> Dict[str, Any]:
        """
        Create an index of all data files on SD card.
        
        Args:
            patterns: File patterns to index (default: common data formats)
        
        Returns:
            Index summary dict
        """
        if patterns is None:
            patterns = ["*.json", "*.csv", "*.db", "*.parquet", "*.pkl"]

        all_files = []
        for pattern in patterns:
            all_files.extend(self.list_data_files(pattern))

        index = {
            "sd_root": str(self.sd_root),
            "indexed_at": datetime.utcnow().isoformat(),
            "total_files": len(all_files),
            "by_type": {},
            "files": all_files,
        }

        for file_meta in all_files:
            file_type = file_meta["type"]
            if file_type not in index["by_type"]:
                index["by_type"][file_type] = 0
            index["by_type"][file_type] += 1

        with open(self.file_index, "w") as f:
            json.dump(index, f, indent=2)

        log.info(f"SD card indexed: {len(all_files)} files | Index saved to {self.file_index}")
        return index

    def copy_data_to_cache(self, file_path: str, dest_subdir: str = "") -> Optional[str]:
        """
        Copy a file from SD card to local cache.
        
        Args:
            file_path: Full path to file on SD card
            dest_subdir: Subdirectory in cache
        
        Returns:
            Local cache path if successful
        """
        try:
            source = Path(file_path)
            if dest_subdir:
                dest_dir = self.cache_dir / dest_subdir
            else:
                dest_dir = self.cache_dir
            dest_dir.mkdir(parents=True, exist_ok=True)

            dest_file = dest_dir / source.name
            with open(source, "rb") as src:
                with open(dest_file, "wb") as dst:
                    dst.write(src.read())

            log.info(f"Copied to cache: {dest_file}")
            return str(dest_file)
        except Exception as e:
            log.error(f"Error copying file: {e}")
            return None

    def get_latest_files(self, pattern: str = "*.json", limit: int = 10) -> List[Dict[str, Any]]:
        """
        Get the latest N files matching pattern.
        """
        files = self.list_data_files(pattern)
        return sorted(files, key=lambda x: x["modified"], reverse=True)[:limit]


if __name__ == "__main__":
    # Example: Sync Google Drive
    drive_conn = GoogleDriveConnector()
    sync_result = drive_conn.sync_folder("AiTradingAgent", "./cache/google_drive_sync", "*.json")
    print(json.dumps(sync_result, indent=2))

    # Example: Index SD card
    sd_conn = SDCardConnector(sd_root="E:/")
    index = sd_conn.index_sd_card()
    print(f"\nSD Card Index: {index['total_files']} files indexed")
    print(f"By type: {index['by_type']}")
