# -*- coding: utf-8 -*-
"""الإعدادات — local only. Nothing here points at a network."""
import os
import sys
from pathlib import Path


def app_data_dir() -> Path:
    """Writable per-OS location for the database and imported files."""
    env = os.environ.get('EGCO_DATA_DIR')
    if env:
        return Path(env)
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / 'EGCO Dashboard'
    if sys.platform == 'win32':
        return Path(os.environ.get('APPDATA', Path.home())) / 'EGCO Dashboard'
    return Path.home() / '.local' / 'share' / 'egco-dashboard'


class Settings:
    APP_NAME = 'EGCO Dashboard API'
    API_PREFIX = '/api/v1'

    # Loopback only. Never change to 0.0.0.0.
    HOST = '127.0.0.1'
    PORT = int(os.environ.get('EGCO_API_PORT', '8756'))

    DATA_DIR = app_data_dir()
    DB_PATH = DATA_DIR / 'egco.db'
    DB_URL = f'sqlite:///{DB_PATH}'

    CURRENCY = 'SAR'
    DUE_SOON_DAYS = 7
    DEBUG = os.environ.get('EGCO_DEBUG') == '1'

    def ensure_dirs(self) -> None:
        self.DATA_DIR.mkdir(parents=True, exist_ok=True)
        (self.DATA_DIR / 'imports').mkdir(exist_ok=True)


settings = Settings()
