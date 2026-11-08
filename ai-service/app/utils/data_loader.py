"""Data Loader - Utility để load dataset (giả lập hoặc từ Spring Boot API)"""
import pandas as pd
import os
from typing import Optional
import requests


class DataLoader:
    """
    Utility để load dataset từ ID.
    Trong POC này, có thể load từ file CSV giả lập.
    Trong production, sẽ gọi API Spring Boot để lấy dữ liệu.
    """

    # Thư mục chứa sample data cho testing
    SAMPLE_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "sample_data")

    # URL của Spring Boot API (lấy từ env)
    BACKEND_API_URL = os.getenv("BACKEND_API_URL", "http://localhost:8080")

    @staticmethod
    def load_dataset(dataset_id: str) -> pd.DataFrame:
        """
        Load dataset từ dataset_id.

        Args:
            dataset_id: ID của dataset

        Returns:
            pandas DataFrame

        Raises:
            ValueError: Nếu không tìm thấy dataset
        """
        # Option 1: Load từ sample CSV (cho testing)
        if dataset_id.startswith("sample_"):
            return DataLoader._load_from_sample(dataset_id)

        # Option 2: Gọi Spring Boot API (production)
        try:
            return DataLoader._load_from_backend_api(dataset_id)
        except Exception as e:
            # Fallback: Nếu API không khả dụng, thử load sample
            print(f"Warning: Không thể load từ backend API ({e}), fallback sang sample data")
            return DataLoader._load_from_sample(f"sample_{dataset_id}")

    @staticmethod
    def _load_from_sample(dataset_id: str) -> pd.DataFrame:
        """Load từ file CSV sample"""
        # Map dataset_id sang file CSV
        sample_files = {
            "sample_sales": "sales_data.csv",
            "sample_products": "product_data.csv",
            "sample_orders": "order_data.csv"
        }

        filename = sample_files.get(dataset_id, f"{dataset_id}.csv")
        filepath = os.path.join(DataLoader.SAMPLE_DATA_DIR, filename)

        if not os.path.exists(filepath):
            # Tạo sample data mặc định nếu không có file
            return DataLoader._create_default_sample_data(dataset_id)

        return pd.read_csv(filepath)

    @staticmethod
    def _load_from_backend_api(dataset_id: str) -> pd.DataFrame:
        """
        Load dữ liệu từ Spring Boot API.

        Endpoint giả định: GET /api/datasets/{dataset_id}/data
        """
        url = f"{DataLoader.BACKEND_API_URL}/api/datasets/{dataset_id}/data"

        response = requests.get(url, timeout=10)

        if response.status_code == 404:
            raise ValueError(f"Dataset '{dataset_id}' không tồn tại")
        elif response.status_code != 200:
            raise ValueError(f"Lỗi khi tải dataset: HTTP {response.status_code}")

        # Parse JSON thành DataFrame
        data = response.json()
        return pd.DataFrame(data)

    @staticmethod
    def _create_default_sample_data(dataset_id: str) -> pd.DataFrame:
        """Tạo sample data mặc định cho testing"""
        import numpy as np

        # Tạo dữ liệu mẫu với distribution khác nhau
        np.random.seed(42)

        n = 100
        data = {
            "id": range(1, n + 1),
            "revenue": np.random.normal(10000, 2000, n),
            "quantity": np.random.poisson(50, n),
            "price": np.random.uniform(100, 500, n),
            "region": np.random.choice(["North", "South", "East", "West"], n),
            "category": np.random.choice(["Electronics", "Clothing", "Food"], n),
            "date": pd.date_range("2024-01-01", periods=n, freq="D")
        }

        return pd.DataFrame(data)

    @staticmethod
    def get_column_metadata(df: pd.DataFrame) -> list[dict]:
        """
        Trích xuất metadata cột từ DataFrame.

        Returns:
            List[dict]: [{"name": "...", "type": "...", "kind": "..."}]
        """
        metadata = []

        for col in df.columns:
            dtype = df[col].dtype

            # Xác định kind
            if pd.api.types.is_numeric_dtype(dtype):
                kind = "number"
            elif pd.api.types.is_datetime64_any_dtype(dtype):
                kind = "date"
            else:
                kind = "text"

            metadata.append({
                "name": col,
                "type": str(dtype),
                "kind": kind
            })

        return metadata
