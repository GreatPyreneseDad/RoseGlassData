"""
CSV Connector — analyze any CSV file through Rose Glass.

Expected CSV columns (flexible):
    Required: text  (the content to score)
    Optional: url, source, source_type, date, entity

Usage:
    DATA_CONNECTOR=csv CSV_FILE_PATH=/path/to/data.csv
    Entity key maps to any column you designate via CSV_ENTITY_COLUMN env var.
"""
import os
import csv
from scripts.connector_base import ConnectorBase


class CSVConnector(ConnectorBase):

    def name(self) -> str:
        return "CSV File"

    def query(self, entity: str, date_str: str, limit: int = 10) -> list[dict]:
        file_path = os.getenv("CSV_FILE_PATH", "")
        entity_col = os.getenv("CSV_ENTITY_COLUMN", "entity")
        text_col = os.getenv("CSV_TEXT_COLUMN", "text")
        source_col = os.getenv("CSV_SOURCE_COLUMN", "source")
        url_col = os.getenv("CSV_URL_COLUMN", "url")

        if not file_path or not os.path.exists(file_path):
            raise FileNotFoundError(f"CSV_FILE_PATH not set or file not found: {file_path}")

        results = []
        with open(file_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Filter by entity if column exists, otherwise include all
                if entity_col in row and row[entity_col].strip().lower() != entity.strip().lower():
                    continue
                text = row.get(text_col, "").strip()
                if not text:
                    continue
                results.append({
                    "url": row.get(url_col, f"row-{len(results)}"),
                    "source": row.get(source_col, "CSV"),
                    "source_type": "document",
                    "text": text[:5000],
                })
                if len(results) >= limit:
                    break
        return results
