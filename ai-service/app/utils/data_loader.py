"""Dataset frames supplied by authenticated Spring Boot; no synthetic fallback."""
from contextlib import contextmanager
from contextvars import ContextVar
import pandas as pd
_dataset = ContextVar("statistical_dataset", default=None)
class DataLoader:
    @staticmethod
    @contextmanager
    def bind(dataset_id, frame):
        token = _dataset.set((dataset_id, frame))
        try:
            yield
        finally:
            _dataset.reset(token)
    @staticmethod
    def load_dataset(dataset_id):
        current = _dataset.get()
        if current is None or current[0] != dataset_id:
            raise ValueError("Dataset must be supplied through authenticated Spring Boot; no sample fallback")
        return current[1]
    @staticmethod
    def get_column_metadata(df):
        return [{"name": name, "type": str(df[name].dtype), "kind": "number" if pd.api.types.is_numeric_dtype(df[name]) else "date" if pd.api.types.is_datetime64_any_dtype(df[name]) else "text"} for name in df.columns]
