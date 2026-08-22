# Deployment guide

The supplied Docker Compose stack is a secure local/demo baseline. It preserves the intended trust boundaries, but it is not a turnkey public production platform: TLS termination, a managed secret store, off-host backups, monitoring/alerting, image scanning, and production orchestration remain deployment responsibilities.

> **Current inference state:** no dataset or validated model bundle is included. A deployment is healthy at the process level but not inference-ready until `/api/ready` returns `200` for an actually reviewed model. Without artifacts it must return `503 MODEL_NOT_READY`.

## Compose topology

| Service | Host exposure | Networks | Role |
| --- | --- | --- | --- |
| `frontend` | `127.0.0.1:8080` | `edge` | Nginx-served React build and `/api` reverse proxy |
| `admin` | `127.0.0.1:8000` | `edge`, `private` | Gunicorn/Django Admin only |
| `backend` | none (`expose: 3000`) | `edge`, `private` | Express public contract, reached through frontend proxy |
| `ai-service` | none (`expose: 5000`) | `private` | Authenticated Flask inference |
| `db` | none | `private` | PostgreSQL persistent state |
| `django-migrate` | none, one shot | `private` | Owner-run Django migration and bounded grants |

The `private` Docker network is `internal: true`. The browser has no route to PostgreSQL or Flask, and the backend port is not published directly. The host loopback bindings are appropriate for a local demonstration or a same-host TLS reverse proxy; remote browsers cannot reach them without an intentional edge proxy.

## Local/demo deployment on Windows

### 1. Prepare secrets

From the repository root:

```powershell
Copy-Item .env.example .env
notepad .env
```

Replace every placeholder. Generate a new value for each secret:

```powershell
$secretBytes = [byte[]]::new(48)
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
[Convert]::ToBase64String($secretBytes)
```

At minimum:

- use different long values for `POSTGRES_OWNER_PASSWORD`, `DATABASE_PASSWORD`, and `DJANGO_DATABASE_PASSWORD`;
- use a unique `AI_SERVICE_SECRET` of at least 32 characters;
- use a unique `DJANGO_SECRET_KEY` of at least 50 characters;
- keep `PUBLIC_ORIGIN=http://localhost:8080` for the standard local URL;
- keep Django cookies/SSL redirect false only for local HTTP; and
- never commit or share the resulting `.env`.

Validate the rendered configuration:

```powershell
docker compose config
```

This command prints resolved configuration and may expose secret values in the terminal buffer.

### 2. Provision an optional reviewed model

If no real model is available, skip this step and demonstrate the honest `MODEL_NOT_READY` state.

For a reviewed release, use the validated exporter rather than copying guessed files:

```powershell
Set-Location ml
.venv\Scripts\Activate.ps1
python -m tools.export_bundle `
  --artifacts artifacts `
  --destination ..\ai-service\model
Set-Location ..
```

Training must have published `artifact_manifest.json` last as the SHA-256 commit marker for its four artifacts. Export verifies that source set, copies it to isolated staging, rechecks both source manifest and staged hashes, applies the runtime 1 MiB limit to every JSON artifact, validates completed history and version consistency, and uses only that coherent snapshot. It then replaces destination artifacts sequentially and publishes `bundle_manifest.json` last; it does not atomically swap the whole directory. On a new load, Flask verifies all four artifact hashes/JSON contracts, safely deserializes the model, checks its declared `float32` input/output contract, runs one bounded zero-batch smoke inference, and then re-reads the runtime manifest and hashes. A torn or changing on-disk release cannot become ready. A process that already loaded the old reviewed bundle continues using that coherent in-memory model until restart. Keep prediction traffic gated by readiness and restart Flask after the complete copy. The `ai-service\model` directory is mounted read-only at `/app/model`. Ensure the model version matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, the active database label set under active crops exactly equals the model class set, and all content is reviewed before accepting user traffic. See [model replacement](../DEVELOPMENT.md#replacing-the-model).

### 3. Build and start

```powershell
docker compose up --build --detach
docker compose ps
docker compose logs --tail 100
```

On a new PostgreSQL volume, the initialization sequence creates runtime roles, applies the initial SQL schema, inserts an inactive/unvalidated demo record, applies Django framework migrations, and grants bounded privileges. `backend` starts only after the database and Flask liveness checks pass and the one-shot migration service completes. Flask liveness does not claim that a model is ready.

### 4. Create administration access

No default administrator or password is created.

```powershell
docker compose exec admin python manage.py bootstrap_roles
docker compose exec admin python manage.py createsuperuser
```

Use the superuser only to bootstrap named users. Assign normal editors to the **Content manager** group, which can manage crops/diseases and view—but not change—predictions.

### 5. Verify

```powershell
curl.exe -i http://localhost:8080/api/health
curl.exe -i http://localhost:8080/api/ready
curl.exe -i http://localhost:8080/api/crops
```

Expected without artifacts:

- `/api/health`: `200`, process alive;
- `/api/ready`: `503`, `MODEL_NOT_READY`; and
- `/api/crops`: `200` with an empty active list on a fresh database.

With reviewed artifacts installed, `/api/ready` is `200` only when `checks.aiService` reports `reachable: true`, `modelReady: true`, and `catalogAligned: true`. The public endpoint compares deterministic SHA-256 digests of the complete loaded class set and the complete active database label set; it does not expose either private digest.

Open:

- PWA: <http://localhost:8080>
- Django Admin: <http://localhost:8000/admin/> (or the configured `DJANGO_ADMIN_PATH`)

Follow bounded logs:

```powershell
docker compose logs --follow --tail 100 backend ai-service admin
```

### 6. Stop or rebuild

Stop while keeping data:

```powershell
docker compose down
```

Rebuild after source/dependency changes:

```powershell
docker compose build --pull
docker compose up --detach
```

Delete the volume only for an intentionally disposable local database:

```powershell
docker compose down --volumes
```

That command permanently deletes the Compose PostgreSQL volume. Export anything needed first.

## Environment contract

### Public routing

| Variable | Production requirement |
| --- | --- |
| `PUBLIC_ORIGIN` | Exact externally visible PWA origin, for example `https://crop-disease.example.edu`; no wildcard or path |
| `DJANGO_ALLOWED_HOSTS` | Exact admin host names, comma-separated |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Exact HTTPS admin origins, including scheme |
| `DJANGO_ADMIN_PATH` | One 1–64 character segment matching `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`; changing it is defence in depth, not authentication |

The Compose backend maps `PUBLIC_ORIGIN` to its `FRONTEND_ORIGINS` allowlist. If multiple browser origins are required, the backend supports a comma-separated `FRONTEND_ORIGINS` value, but the supplied Compose mapping should be reviewed/adjusted deliberately.

### Database

| Variable | Role |
| --- | --- |
| `POSTGRES_OWNER_USER`, `POSTGRES_OWNER_PASSWORD` | Initialization/migration only; never long-running application credentials |
| `DATABASE_USER`, `DATABASE_PASSWORD` | Express: select crops/diseases and insert/select predictions |
| `DJANGO_DATABASE_USER`, `DJANGO_DATABASE_PASSWORD` | Django: catalog CRUD, prediction read, required framework tables |
| `DATABASE_SSL` | Current Compose uses private-network plaintext; external/managed PostgreSQL should use verified TLS |

Changing `.env` passwords does not alter roles already stored in a persistent PostgreSQL volume. Rotate database credentials transactionally in PostgreSQL and the secret store, then restart affected services.

### Service and resource controls

| Variable | Notes |
| --- | --- |
| `AI_SERVICE_SECRET` | Shared Node-to-Flask credential; rotate as a coordinated restart; never expose to React |
| `AI_TIMEOUT_MS` | Express inference timeout; must stay below `REQUEST_TIMEOUT_MS` when the latter is customized |
| `AI_READINESS_TIMEOUT_MS` | Express timeout for authenticated Flask readiness; default `2000` ms |
| `MODEL_CONFIDENCE_THRESHOLD` | Root Compose input for the Express 0–1 operational uncertainty floor; default `0.70` |
| `AI_MODEL_CONFIDENCE_THRESHOLD` | Root Compose input mapped to Flask's process-local `MODEL_CONFIDENCE_THRESHOLD`; blank uses model metadata |
| `MIN_IMAGE_DIMENSION`, `MAX_IMAGE_DIMENSION`, `MAX_IMAGE_PIXELS` | Express decoded-image limits |
| `MIN_IMAGE_DIMENSION`, `MAX_IMAGE_WIDTH`, `MAX_IMAGE_HEIGHT`, `MAX_IMAGE_PIXELS` | Flask encoded/decoded-image limits; keep them deliberately compatible with Express |
| `MAX_CONCURRENT_INFERENCES` | Flask in-process semaphore; default 2 |
| `MAX_CONCURRENT_PREDICTIONS` | Express in-process prediction gate; default 2 |
| `REQUEST_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS` | Express request deadline and graceful-shutdown bound |
| `LOG_LEVEL` | Do not enable verbose production logging that could expose internals |

`MAX_UPLOAD_MB` and `MAX_IMAGE_BYTES` are Compose inputs but both service validators cap them at 8 MiB. Compose now also passes its documented minimum/maximum image, readiness-timeout, database-pool, rate, concurrency, request, and shutdown controls. It deliberately fixes `TRUST_PROXY=1`, `MODEL_DIR=/app/model`, internal hosts/ports, the frontend build-time API base, and `DJANGO_DEBUG=false`. A value merely present in the root `.env.example` is not a Compose control unless `docker-compose.yml` interpolates it. Do not raise the public limit without a resource/security review and coordinated tests at every layer.

### Administration defaults and static files

`DJANGO_DEBUG` defaults to false and the Compose service fixes it to false. When debug is false, Django rejects a placeholder or shorter-than-50-character `DJANGO_SECRET_KEY`; secure cookies default on when their environment variables are omitted. The local Compose stack explicitly sets secure cookies and SSL redirect false for loopback HTTP. Production must set them true only after trusted HTTPS forwarding is verified. HSTS remains disabled until `DJANGO_HSTS_SECONDS` is deliberately set.

The admin image runs `collectstatic` during its build. WhiteNoise serves compressed, manifest-named assets with a one-year maximum age, while the custom admin middleware sets dynamic responses to `Cache-Control: no-store` and adds CSP and Permissions Policy headers. Rebuild the admin image after static/dependency changes; do not serve production Admin with `runserver`.

SQL migrations remain authoritative for `crops`, `diseases`, and `predictions`; Django maps those tables as unmanaged models. Django mirrors database timestamp defaults and applicable case-insensitive uniqueness rules so admin forms can reject conflicts early, while PostgreSQL constraints remain the final enforcement boundary.

## Production edge architecture

Place a maintained TLS proxy, ingress, or load balancer in front of the loopback entry points:

```text
Internet
   |
   | HTTPS + HSTS
   v
Trusted reverse proxy / WAF
   |--------------------------|
   v                          v
PWA + /api                 Django Admin
(frontend:8080)            (admin:8000, preferably separate host/VPN)
   |
   v
Express --private--> Flask --local artifacts
   |
   `--private/TLS--> PostgreSQL
```

Production requirements:

1. Terminate HTTPS with a valid certificate and redirect HTTP at the trusted edge.
2. Forward the original scheme safely; keep `SECURE_PROXY_SSL_HEADER` valid only behind a proxy that overwrites untrusted forwarding headers.
3. Set `PUBLIC_ORIGIN` and Django hosts/origins to exact HTTPS values.
4. Set `DJANGO_SECURE_SSL_REDIRECT=true`, `DJANGO_SESSION_COOKIE_SECURE=true`, and `DJANGO_CSRF_COOKIE_SECURE=true` only after HTTPS forwarding is verified.
5. Set a reviewed `DJANGO_HSTS_SECONDS`; enable subdomains/preload only when every affected host is permanently HTTPS-ready.
6. Prefer a separate admin hostname behind VPN/IP policy/identity-aware access. Django authentication and lockout remain required.
7. Keep backend, Flask, and PostgreSQL on private networks/security groups. Do not add public `ports` for convenience.
8. Store secrets in the platform secret manager and inject them at runtime; restrict read/rotation permissions.
9. Use a dedicated migration job with the owner credential. Long-running containers keep only runtime roles.
10. Use managed PostgreSQL or encrypted persistent storage, verified TLS for cross-host database traffic, automated encrypted backups, and restore drills.
11. Centralize structured logs and metrics with retention/access controls. Alert on readiness, 5xx/429 rates, database pool failure, inference latency/busy responses, model load failure, and admin lockout anomalies.
12. Scan source dependencies, base images, built images, and the model bundle; pin/review deployed image versions and preserve software/model provenance.

The Compose file builds from the working tree and uses a local named volume. A production platform should publish immutable, scanned image tags and record exactly which application commit, database migrations, model version/hash, dataset evidence, and content review were deployed.

## Database migrations in deployment

PostgreSQL's `/docker-entrypoint-initdb.d` mechanism is fresh-volume initialization, not an upgrade system. For every later SQL migration:

1. back up and restore-test representative data;
2. stage the migration on a restored/disposable database;
3. confirm application compatibility and lock/runtime impact;
4. apply with the migration owner and `ON_ERROR_STOP`;
5. run Django framework/state migrations;
6. rerun `grant_runtime_permissions` if required;
7. run schema/readiness/smoke checks; and
8. record the applied migration.

Compose example from PowerShell, replacing the example file with the actual reviewed migration:

```powershell
Get-Content -Raw database\migrations\002_add_reviewed_by.sql | `
  docker compose exec -T db sh -c 'psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"'

docker compose run --rm django-migrate
```

Do not run `database/migrations/001_initial_schema.down.sql` on a production database; it drops all application tables. Prefer a forward corrective migration.

## Backups and restore tests

The repository contains no backup scheduler. Use the database/platform-native encrypted backup system and keep backups outside Git and outside the primary failure domain.

From an authorised Windows operations host with PostgreSQL client tools and a protected connection string:

```powershell
New-Item -ItemType Directory -Force .\backups
pg_dump --dbname "$env:DATABASE_URL" --format=custom `
  --file ".\backups\crop-disease-verified.dump"
pg_restore --list ".\backups\crop-disease-verified.dump"
```

Listing a dump is not a restore test. Restore to an isolated non-production database, run the schema contract and application smoke checks, then destroy that isolated copy according to policy. Protect backup credentials and output; `.dump` files are ignored by Git but that is not encryption or access control.

Uploaded images need no backup because neither service retains them. Back up PostgreSQL catalog/review/audit data and separately preserve reviewed model artifacts, hashes, evaluation reports, and provenance in an access-controlled model registry/artifact store.

## Model rollout and rollback

1. Complete the review/export checklist in [DEVELOPMENT.md](../DEVELOPMENT.md#replacing-the-model), including a hash-verified `evaluation_manifest.json` bound to the intended artifact and split digests.
2. Stage the bundle and exact knowledge-base mappings together; the complete active database label set must equal the model class set.
3. Restart `ai-service`, then verify authenticated Flask `/ready` reports the expected version and a valid class-set digest and Express `/api/ready` reports `catalogAligned: true`.
4. Run controlled smoke and failure cases before routing users.
5. Monitor uncertainty distribution, mapping failures, latency, resource usage, and model-load logs without logging images.
6. Keep the previous reviewed bundle and matching database/content release available for rollback.

The Flask runtime loads lazily and retains a successfully loaded model in memory. Replacing files does not hot-swap an already loaded process; restart `ai-service`, then verify readiness. Restarting `backend` clears its in-memory limits/state and ensures coordinated configuration.

```powershell
docker compose restart ai-service backend
curl.exe -i http://localhost:8080/api/ready
```

If readiness fails, do not bypass it. Restore the prior reviewed artifact set and mappings, restart the service, or keep inference unavailable with `MODEL_NOT_READY`.

## Health checks and monitoring

| Check | Meaning | Expected action |
| --- | --- | --- |
| Frontend container health/routing | Static server and proxy availability | Remove instance if it cannot serve/proxy |
| `GET /api/health` | Express process alive | Liveness/restart signal only |
| `GET /api/ready` | DB + Flask + real model + exact active catalog/class-set digest match | Gate prediction traffic; alert on sustained 503 or `catalogAligned: false` |
| Flask `GET /health` | Private process alive | Container liveness |
| Flask `GET /ready` | Authenticated all-artifact hash/history, safe-load, dtype/shape, and bounded smoke checks passed; returns model version and class-set digest | Internal inference readiness only; Express performs database alignment |
| PostgreSQL `pg_isready` | Database accepts connections | Container/platform database health |

Do not treat liveness as readiness. A model-free academic demonstration should show a healthy shell and explicit degraded readiness, not be marked as prediction-capable.

Structured logs include request IDs, method/path, status, durations, operational codes, model version, uncertainty, and prediction duration. They intentionally omit image bytes and user-supplied filenames. Restrict log access and retention because IP/network metadata may still be added by the external proxy/platform.

## Scaling limits

- Express rate limiters and prediction concurrency gates are process-local. Multiple replicas require a shared rate-limit store and globally bounded inference queue.
- Flask uses one Gunicorn process with threaded handling to avoid duplicating a large TensorFlow model. Changing worker count multiplies model memory.
- The model runtime serializes `model.predict`; benchmark with the actual artifact and target hardware before changing workers/threads/semaphores.
- PostgreSQL pool defaults to 10 connections per backend instance. Size the aggregate against database limits.
- The frontend is stateless. Django sessions/authentication live in PostgreSQL, but admin scaling still needs static/edge, proxy, and lockout behaviour verified.

Do not scale replicas until shared abuse controls and capacity measurements are in place.

## Production release checklist

- [ ] All source tests, type checks, lint, and builds completed successfully in CI.
- [ ] Flask and Django tests/checks completed in their pinned environments.
- [ ] SQL fresh/upgrade paths, constraints, least-privilege roles, the opt-in disposable PostgreSQL Django ORM contract, backup, and isolated restore were tested.
- [ ] No placeholder secret, committed `.env`, credential, dataset, raw image, dump, or unreviewed artifact is present.
- [ ] Dependencies, built containers, and model artifacts were scanned and reviewed.
- [ ] Exact HTTPS origins, hosts, proxy hop count, forwarding behaviour, headers, cookies, CSRF, and HSTS were verified.
- [ ] Database, Flask, and backend remain non-public; admin access is restricted and uses named least-privilege users/MFA at the surrounding identity layer where possible.
- [ ] Real dataset provenance/licence and representative coverage were reviewed.
- [ ] Metrics come from a complete `evaluation_manifest.json` whose artifact, exact split/dataset, immutable test snapshot, and report-file hashes were verified; per-class/failure limitations are reported.
- [ ] Confidence threshold was calibrated and documented; unknown/out-of-distribution risk remains disclosed.
- [ ] Model files, class order, completed history, metadata, both manifests/hashes, ASCII release ID, exact active DB label set, content sources, review timestamps, and model version agree.
- [ ] Authenticated Flask readiness reports the intended version/digest, `/api/ready` reports `catalogAligned: true`, and failure tests still return no fabricated prediction.
- [ ] PWA install/update/offline tests confirm `/api` remains network-only.
- [ ] Monitoring, alerts, incident response, secret rotation, backup retention, and rollback owners are assigned.

For detailed security requirements, use [SECURITY.md](../SECURITY.md) and [THREAT_MODEL.md](THREAT_MODEL.md).
