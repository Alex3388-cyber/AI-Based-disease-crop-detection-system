FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN groupadd --system app && \
    useradd --system --gid app --no-create-home --home-dir /nonexistent \
      --shell /usr/sbin/nologin app
WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY . .
RUN DJANGO_DEBUG=true \
    DJANGO_SECRET_KEY=build-only-not-a-runtime-secret \
    DATABASE_HOST=localhost \
    DATABASE_NAME=unused \
    DATABASE_USER=unused \
    DATABASE_PASSWORD=unused \
    python manage.py collectstatic --noinput && \
    chmod -R a-w /app
USER app

EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "2", "--timeout", "30", "--graceful-timeout", "20", "--max-requests", "1000", "--max-requests-jitter", "100", "--worker-tmp-dir", "/tmp", "--access-logfile", "-", "--error-logfile", "-"]
