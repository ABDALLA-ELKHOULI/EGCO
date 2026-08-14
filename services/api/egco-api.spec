# -*- mode: python ; coding: utf-8 -*-
"""مواصفات بناء الخدمة كملف تنفيذي واحد.

uvicorn and pydantic resolve much of their machinery dynamically, so the imports have to
be collected explicitly — otherwise the binary builds fine and then fails at runtime.
"""
import sys

from PyInstaller.utils.hooks import collect_submodules

hidden = (
    collect_submodules('uvicorn')
    + collect_submodules('fastapi')
    + collect_submodules('pydantic')
    + collect_submodules('sqlalchemy.dialects.sqlite')
    + ['anyio', 'openpyxl', 'fitz', 'email.mime.multipart', 'email.mime.text']
)

a = Analysis(
    ['run_api.py'],
    pathex=['.'],
    binaries=[],
    datas=[],
    hiddenimports=hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'PyQt5', 'PySide6', 'pytest'],
    noarchive=False,
)
pyz = PYZ(a.pure)

# onedir, not onefile: a one-file bundle unpacks itself to a temp dir on every launch,
# which cost ~14s of cold start. The directory build starts in about a second.
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name='egco-api',
    debug=False,
    strip=False,
    upx=False,
    # On Windows a console=True child process pops a black terminal window on
    # every launch; the backend is a private child of the Electron app, so it
    # runs windowless there. macOS/Linux keep the console for log capture.
    console=(sys.platform != 'win32'),
)

coll = COLLECT(
    exe, a.binaries, a.datas,
    strip=False,
    upx=False,
    name='egco-api',
)
