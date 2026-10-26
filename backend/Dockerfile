# Popsicle's API, for self-hosting with Docker (see compose.yaml and README.md → "Self-hosting with
# Docker"). Settings come from the environment, the same ones as on Railway.
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first, so changing the code doesn't reinstall them. Every pinned package has a
# prebuilt wheel for x86 and 64-bit ARM (e.g. Apple Silicon), so no compiler is needed.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# Nothing is written to disk at runtime (attachments live in Postgres), so run as a plain user.
RUN useradd --create-home --uid 10001 popsicle
USER popsicle

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"]

# One process, no --workers: sending and the scheduled-batch sweeper run in background threads of
# this process (the same rule as backend/railway.json).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
