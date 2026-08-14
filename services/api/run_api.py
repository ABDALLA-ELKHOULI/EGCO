# -*- coding: utf-8 -*-
"""نقطة الدخول للنسخة المحزومة.

PyInstaller bundles this file, not uvicorn's CLI: the packaged app has no shell to run
`python -m uvicorn` from. Electron passes the port and data dir through the environment.
"""
import os

import uvicorn

from app.main import app

if __name__ == '__main__':
    uvicorn.run(
        app,
        host='127.0.0.1',                                   # loopback only, never 0.0.0.0
        port=int(os.environ.get('EGCO_API_PORT', '8756')),
        log_level='warning',
    )
