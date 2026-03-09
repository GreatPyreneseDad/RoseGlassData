"""
File Connector — analyze a directory of text files through Rose Glass.
Supports: .txt, .md, .json (with 'text' field)

Usage:
    DATA_CONNECTOR=file FILE_DIR=/path/to/docs/
"""
import os
import json
from scripts.connector_base import ConnectorBase


class FileConnector(ConnectorBase):

    def name(self) -> str:
        return "Local File Directory"

    def query(self, entity: str, date_str: str, limit: int = 10) -> list[dict]:
        file_dir = os.getenv("FILE_DIR", "")
        if not file_dir or not os.path.isdir(file_dir):
            raise NotADirectoryError(f"FILE_DIR not set or not a directory: {file_dir}")

        results = []
        for fname in sorted(os.listdir(file_dir)):
            if len(results) >= limit:
                break
            fpath = os.path.join(file_dir, fname)
            try:
                if fname.endswith(".json"):
                    with open(fpath, encoding="utf-8") as f:
                        data = json.load(f)
                    text = data.get("text", "") or data.get("content", "")
                    source = data.get("source", fname)
                elif fname.endswith((".txt", ".md")):
                    with open(fpath, encoding="utf-8") as f:
                        text = f.read()
                    source = fname
                else:
                    continue

                if not text.strip():
                    continue

                results.append({
                    "url": fpath,
                    "source": source,
                    "source_type": "document",
                    "text": text[:5000],
                })
            except Exception:
                continue

        return results
