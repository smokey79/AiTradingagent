"""
orchestrator/google_drive_auth.py
=================================
Google Drive OAuth2 Client & File Ingestion Helper for AiTradingAgent.
Safely lists and downloads strategy configs, .py scripts, and alpha logs from Drive.
Provides clean fallback if Google Drive credentials are not configured or offline.
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional

logger = logging.getLogger("GoogleDriveAuth")


def get_drive_service():
    """Build and return an authorized Google Drive v3 API service, or None if offline."""
    creds_path = os.getenv("GOOGLE_DRIVE_CREDS")
    if not creds_path or not os.path.exists(creds_path):
        logger.info("[DriveAuth] No local GOOGLE_DRIVE_CREDS found; running in local mode.")
        return None

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        scopes = ["https://www.googleapis.com/auth/drive.readonly"]
        creds = service_account.Credentials.from_service_account_file(creds_path, scopes=scopes)
        service = build("drive", "v3", credentials=creds)
        return service
    except Exception as e:
        logger.warning(f"[DriveAuth] Could not initialize Drive API: {e}")
        return None


def list_files(folder_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """List files in the specified Google Drive folder, or return local cached files."""
    if not folder_id:
        folder_id = os.getenv("GOOGLE_DRIVE_FOLDER_ID")

    service = get_drive_service()
    if not service or not folder_id:
        # Local mock/cache fallback
        cache_dir = Path("drive_cache")
        if cache_dir.exists():
            return [{"id": f.name, "name": f.name} for f in cache_dir.glob("*.*")]
        return []

    try:
        query = f"'{folder_id}' in parents and trashed = false"
        results = service.files().list(q=query, fields="files(id, name, mimeType, modifiedTime)").execute()
        return results.get("files", [])
    except Exception as e:
        logger.warning(f"[DriveAuth] list_files error: {e}")
        return []


def download_file(file_id: str, dest_path: Path) -> bool:
    """Download a file by ID from Google Drive to local destination path."""
    dest_path = Path(dest_path)
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    service = get_drive_service()
    if not service:
        logger.info(f"[DriveAuth] Drive offline; checking local destination {dest_path}")
        return dest_path.exists()

    try:
        from googleapiclient.http import MediaIoBaseDownload
        import io

        request = service.files().get_media(fileId=file_id)
        fh = io.FileIO(str(dest_path), "wb")
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            status, done = downloader.next_chunk()
        return True
    except Exception as e:
        logger.warning(f"[DriveAuth] download_file error: {e}")
        return False
