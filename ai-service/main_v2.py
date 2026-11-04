"""Compatibility entry point. Both commands use the same validated implementation."""
import os
import uvicorn
from main import app

if __name__ == "__main__":
    uvicorn.run(app, host=os.getenv("SERVICE_HOST", "127.0.0.1"), port=int(os.getenv("SERVICE_PORT", "8000")))
