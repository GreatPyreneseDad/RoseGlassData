"""
RoseGlassData — Generic Connector Base
=======================================
Replace gdelt_query() with any data source by implementing this interface.
The scoring pipeline, artifact generation, and chat architecture are unchanged.

To add a new connector:
1. Create a new file in scripts/connectors/ (e.g., connectors/sql_connector.py)
2. Implement the query_source() function matching the signature below
3. Set DATA_CONNECTOR env var to your connector module name
4. The rest of the pipeline is unchanged
"""

from abc import ABC, abstractmethod
from typing import Optional


class ConnectorBase(ABC):
    """
    Base class for all RoseGlassData source connectors.
    
    A connector's only job: receive an entity key + date, return records.
    Each record must have: url (or id), source, text.
    Everything else — scoring, artifact generation, chat — is invariant.
    """

    @abstractmethod
    def query(
        self,
        entity: str,
        date_str: str,
        limit: int = 10,
    ) -> list[dict]:
        """
        Fetch records for a given entity and date.

        Args:
            entity: The grouping key (topic, case_id, customer_id, ticker, etc.)
            date_str: ISO date string YYYY-MM-DD
            limit: Max records to return

        Returns:
            List of dicts, each containing:
                - url (str): Unique identifier or URL for the record
                - source (str): Source name / author / system
                - text (str): The content to be scored — this is what Rose Glass reads
                - source_type (str, optional): Category label
                - calibration (str, optional): Known bias or context note
        """
        pass

    @abstractmethod
    def name(self) -> str:
        """Human-readable connector name for logging and UI display."""
        pass


def load_connector(connector_name: Optional[str] = None) -> ConnectorBase:
    """
    Load a connector by name. Falls back to GDELT for backward compatibility
    with rose-glass-news. Set DATA_CONNECTOR env var to switch connectors.

    Available connectors:
        gdelt       — GDELT BigQuery (news, default/legacy)
        csv         — Local CSV file upload
        sql         — Generic SQL database
        api         — REST API endpoint
        file        — Local file directory (txt, json, pdf text)
    """
    import os
    name = connector_name or os.getenv("DATA_CONNECTOR", "gdelt")

    if name == "gdelt":
        from scripts.connectors.gdelt_connector import GDELTConnector
        return GDELTConnector()
    elif name == "csv":
        from scripts.connectors.csv_connector import CSVConnector
        return CSVConnector()
    elif name == "sql":
        from scripts.connectors.sql_connector import SQLConnector
        return SQLConnector()
    elif name == "api":
        from scripts.connectors.api_connector import APIConnector
        return APIConnector()
    elif name == "file":
        from scripts.connectors.file_connector import FileConnector
        return FileConnector()
    else:
        raise ValueError(f"Unknown connector: {name}. Check DATA_CONNECTOR env var.")
