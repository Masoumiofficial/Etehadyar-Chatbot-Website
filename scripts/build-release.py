#!/usr/bin/env python3
"""Reproducible deployment ZIP: public site files, no credentials or tooling."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
BASE_FILES = ["index.html", ".htaccess", "admin/.htaccess", "robots.txt", "sitemap.xml", "llms.txt", "README-FA.md", "CHANGELOG.md", "AUDIT-FULL-REPORT.md", "scripts/setup-admin.php", "deploy/nginx.conf.example"]
ALLOWED_SUFFIXES = {".html", ".css", ".js", ".php", ".webp", ".jpg", ".svg", ".woff2", ".mp3", ".txt"}


def release_files():
    files = {ROOT / name for name in BASE_FILES if (ROOT / name).is_file()}
    for folder in ["about", "docs", "changelog", "assets", "admin"]:
        for file in (ROOT / folder).rglob("*"):
            if file.is_symlink() or not file.is_file() or file.name.startswith("."):
                continue
            if file.suffix.lower() in ALLOWED_SUFFIXES:
                files.add(file)
    files.update([ROOT / "data/site_data.json", ROOT / "data/.htaccess"])
    return sorted(files, key=lambda file: file.relative_to(ROOT).as_posix())


def build(output):
    data = json.loads((ROOT / "data/site_data.json").read_text(encoding="utf-8"))
    assert data["config"] and isinstance(data["releases"], list)
    for key in ["purchaseUrlIR", "purchaseUrlInternational"]:
        url = data["config"].get(key, "")
        if url and (not url.startswith("https://") or url.rstrip("/") == data["config"]["productUrl"].rstrip("/")):
            raise ValueError("Configure a real HTTPS checkout URL or leave it empty")
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for file in release_files():
                name = file.relative_to(ROOT).as_posix()
                info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, file.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
        with ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise RuntimeError("Release CRC validation failed")
            count = len(archive.namelist())
        temporary.replace(output)
        print(f"Built {output.name}: {count} files, {output.stat().st_size:,} bytes; no private CMS data.")
    finally:
        if temporary.exists():
            temporary.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "ehehadyar-chat-theme.zip")
    build(parser.parse_args().output)
