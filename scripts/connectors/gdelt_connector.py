"""
GDELT Connector — wraps existing gdelt_news_compare.py
Preserves full backward compatibility with rose-glass-news.
"""
import os, sys
IPAI_DIR = os.path.expanduser("~/IPAI")
sys.path.insert(0, IPAI_DIR)

from scripts.gdelt_news_compare import (
    gdelt_query,
    map_source_to_type,
    _extract_domain,
)
from scripts.connector_base import ConnectorBase


class GDELTConnector(ConnectorBase):

    def name(self) -> str:
        return "GDELT (BigQuery)"

    def query(self, entity: str, date_str: str, limit: int = 10) -> list[dict]:
        articles = gdelt_query(entity, date_str, limit=limit * 3)
        if not articles:
            return []

        seen_domains = set()
        results = []
        for article in articles:
            domain = _extract_domain(article["url"])
            if domain and domain not in seen_domains:
                seen_domains.add(domain)
                results.append({
                    "url": article["url"],
                    "source": article["source"],
                    "source_type": map_source_to_type(domain),
                    "text": "",  # fetched downstream by run_analysis
                    "v2tone": article.get("v2tone"),
                })
            if len(results) >= limit:
                break
        return results
