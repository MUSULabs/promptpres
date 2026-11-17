# Build once, serve React and API on one origin.
FROM node:22-bookworm-slim AS web-build
WORKDIR /repo/web
COPY web/package*.json ./
RUN npm ci
# the type check reads the contract mocks at ../../contracts/mocks (web/src/contract.check.ts)
COPY contracts/ /repo/contracts/
COPY web/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS api
WORKDIR /repo
COPY api/requirements-linux.lock /tmp/api.lock
RUN pip install --no-cache-dir -r /tmp/api.lock
COPY api/ api/
COPY promptpres_shared/ promptpres_shared/
COPY contracts/ contracts/
COPY config/ config/
COPY worker/prompts/ worker/prompts/
COPY --from=web-build /repo/web/dist/ web/dist/
ENV PYTHONPATH=/repo:/repo/api PROMPTPRES_DATA=/data PROMPTPRES_UPLOADS=/data/uploads PROMPTPRES_RUNS=/data/runs
EXPOSE 8000
CMD ["uvicorn", "api.app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 AS worker
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libegl1 libgl1 libglib2.0-0 ca-certificates && rm -rf /var/lib/apt/lists/*
# Python 3.12 like the API image, CI and Modal (the distro interpreter on Ubuntu 22.04 is 3.10).
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR=/opt/python VIRTUAL_ENV=/opt/venv PATH=/opt/venv/bin:$PATH
RUN uv venv --python 3.12 /opt/venv
COPY worker/requirements.txt /tmp/worker-requirements.txt
RUN uv pip install --no-cache -r /tmp/worker-requirements.txt "psycopg[binary]"
COPY worker/ worker/
COPY promptpres_shared/ promptpres_shared/
COPY contracts/ contracts/
COPY config/ config/
COPY tools/download_models.py tools/download_models.py
ENV PYTHONPATH=/repo PROMPTPRES_DATA=/data PROMPTPRES_RUNS=/data/runs PROMPTPRES_MODELS=/models
CMD ["sh", "-c", "python tools/download_models.py && python -m worker.runner"]
