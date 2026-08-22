# Flask AI inference service

This private service performs authenticated, memory-only crop image inference. It validates the filename, declared media type, binary signature, encoded dimensions, decoded pixels, model input, and model output. Uploaded bytes are not retained.

## Local setup

```powershell
cd ai-service
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
$env:AI_SERVICE_SECRET = "replace-with-a-long-random-secret"
flask --app wsgi run --host 127.0.0.1 --port 5000
```

Use Waitress on Windows or Gunicorn on Linux in production. Keep this service on a private network behind the Node API and configure the reverse proxy/process manager with request and worker timeouts.

`POST /predict` requires header `X-Service-Secret` and one multipart field named `image`. The exact file limit is 8 MiB; JPEG, PNG, and WEBP are accepted. Run tests with `pytest -q`.
