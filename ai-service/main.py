"""
FastAPI Statistical Engine & Chat AI Service

Service tích hợp đầy đủ:
1. Statistical Engine: Tính toán thống kê mô tả, tương quan, outlier, hypothesis testing
2. Chat AI: Intent routing, AI insights generation
3. Dashboard Planning: Gợi ý biểu đồ và template dashboard
4. Legacy BI Analysis: Endpoint /analyze từ version cũ (tương thích ngược)
"""
import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load environment variables
load_dotenv(Path(__file__).parent / ".env")

# Import routers
from app.routers import stats_router, hypothesis_router, chat_router, legacy_analyze

# Tạo FastAPI app
app = FastAPI(
    title="Statistical Engine & Chat AI Service",
    description="""
    FastAPI service cho phân tích thống kê và Chat AI thông minh.

    ## Modules

    ### Module A: Statistical Analysis
    - **Thống kê mô tả**: Mean, median, std, quartiles, skewness, kurtosis
    - **Tương quan**: Pearson, Spearman correlation
    - **Outlier Detection**: IQR, Z-score methods

    ### Module B: Hypothesis Testing
    - Shapiro-Wilk (kiểm định phân phối chuẩn)
    - Independent T-Test, Paired T-Test
    - ANOVA (3+ nhóm)
    - Chi-Square (biến phân loại)
    - Mann-Whitney U, Kruskal-Wallis (phi tham số)

    ### Module C: Chat AI
    - Intent Recognition (nhận diện ý định câu hỏi tiếng Việt)
    - AI Insights Generation (diễn giải kết quả)
    - Chart & Dashboard Recommendations

    ### Legacy
    - `/analyze`: Endpoint phân tích BI từ version cũ (tương thích ngược)
    """,
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Trong production nên chỉ định cụ thể
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(stats_router.router)
app.include_router(hypothesis_router.router)
app.include_router(chat_router.router)
app.include_router(legacy_analyze.router)  # Legacy /analyze endpoint


@app.get("/", tags=["Health Check"])
def root():
    """Health check endpoint"""
    return {
        "status": "running",
        "service": "Statistical Engine & Chat AI",
        "version": "2.0.0",
        "model": os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        "modules": {
            "statistical_analysis": "available",
            "hypothesis_testing": "available",
            "chat_ai": "available",
            "legacy_bi_analysis": "available"
        }
    }


@app.get("/health", tags=["Health Check"])
def health_check():
    """Detailed health check"""
    api_key_configured = bool(os.getenv("GEMINI_API_KEY")) and \
                        os.getenv("GEMINI_API_KEY") != "your_gemini_api_key_here"

    return {
        "status": "healthy",
        "components": {
            "statistical_engine": "operational",
            "hypothesis_testing": "operational",
            "chat_ai": "operational" if api_key_configured else "degraded",
            "gemini_api": "configured" if api_key_configured else "not_configured"
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=os.getenv("SERVICE_HOST", "127.0.0.1"),
        port=int(os.getenv("SERVICE_PORT", "8082"))
    )
