# syntax=docker/dockerfile:1.7

FROM python:3.12-slim-bookworm

LABEL org.opencontainers.image.title="AI Crop Disease Detection System inference service" \
      org.opencontainers.image.description="Private Flask/OpenCV/TensorFlow crop disease inference service"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    MODEL_DIR=/app/model

ARG APP_UID=10001
ARG APP_GID=10001

# libgomp is required by numerical wheels; libglib supports OpenCV headless on
# Debian. No compiler or development server is installed.
RUN set -eux; \
    apt-get update; \
    apt-get install --no-install-recommends -y libglib2.0-0 libgomp1; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --gid "${APP_GID}" cropai; \
    useradd --uid "${APP_UID}" --gid "${APP_GID}" --no-create-home \
        --home-dir /nonexistent --shell /usr/sbin/nologin cropai

WORKDIR /app

# Copy dependency metadata separately to retain Docker layer caching.
COPY --chown=root:root requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --requirement requirements.txt

COPY --chown=root:root app ./app
COPY --chown=root:root wsgi.py ./wsgi.py

# Production Compose bind-mounts the artifact directory with `:ro`. Keeping the
# image's fallback directory root-owned and non-writable also fails closed when
# the mount is accidentally omitted.
RUN mkdir -p /app/model; \
    chmod 0555 /app/model; \
    chmod -R a-w /app/app /app/wsgi.py /app/requirements.txt

USER cropai:cropai

EXPOSE 5000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=8 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=2)"]

# One process avoids duplicating a large TensorFlow model. The bounded threaded
# worker cooperates with the application's inference semaphore; Gunicorn owns
# worker timeout/recycling and graceful termination in production.
CMD ["gunicorn", "--bind=0.0.0.0:5000", "--worker-class=gthread", "--workers=1", "--threads=2", "--timeout=60", "--graceful-timeout=30", "--keep-alive=5", "--max-requests=1000", "--max-requests-jitter=100", "--worker-tmp-dir=/tmp", "--access-logfile=-", "--error-logfile=-", "--capture-output", "wsgi:app"]
