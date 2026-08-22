# Security policy and architecture

## Reporting a vulnerability

Do not publish exploit details or secrets in a public issue. Provide the maintainer with the affected component, reproducible steps, impact, and any suggested mitigation through the project's private reporting channel. Rotate any exposed credential immediately; never paste a real `.env` file into a report.

## Security boundary

The browser communicates only with the Express API through HTTPS. PostgreSQL and Flask are private services. Django Admin is an authenticated management surface and should be restricted by network policy in production. React contains no database or Flask credentials.

## Upload controls

Uploads are untrusted at every layer. The reverse proxy, Express multipart parser, and Flask request handler cap bytes. Express and Flask independently allow only JPEG, PNG, and WebP; inspect signatures/content; decode with image libraries; reject malformed images; and enforce width, height, and total-pixel limits. The normal flow keeps bytes in memory, does not expose an upload directory, never executes content, and never constructs shell commands from a filename.

Client validation exists for usability only. Server checks remain authoritative. If future requirements introduce storage, use generated identifiers outside executable/static roots, restrictive permissions, short retention, and a separate malware/content-disarm assessment.

## API and inter-service security

- Helmet provides CSP and other response headers; HSTS is production-only.
- CORS accepts configured origins, never a production wildcard.
- JSON, multipart, time, and rate limits constrain resource use.
- Zod schemas validate browser input, route parameters, environment configuration, and Flask responses.
- Error middleware returns stable codes without stack traces, paths, database internals, or internal addresses.
- Request IDs correlate logs without tracking a device or person.
- Express authenticates predictions to Flask with an environment-provided secret. Flask is not published by the production container topology.
- Flask responses are still treated as untrusted and validated before database use.

The shared secret is a pragmatic academic-project control, not a replacement for private networking and TLS. Production deployments should store it in a secret manager, rotate it, and consider workload identity or mutual TLS.

## Database security

Application queries are parameterized. Foreign keys, check constraints, unique labels, timestamps, and indexes protect integrity. Do not expose port 5432 publicly. Use distinct least-privilege roles where operationally possible: Express reads content and writes prediction metadata; Django manages content; migrations have DDL permission. Applications must not normally connect as a PostgreSQL superuser.

Backups must be encrypted, access controlled, kept outside Git, and periodically restored in a test environment. Database errors are logged in sanitized structured form and returned to clients only as stable error codes.

## Django authentication and authorization

Django uses its standard password hashing, session authentication, CSRF middleware, and permissions. Brute-force protection is configured through `django-axes`. No administrator is created automatically and no default password exists. Production requires `DEBUG=False`, explicit hosts/trusted origins, HTTPS redirect at the edge or application, secure cookies, HSTS, and a non-default/restricted admin route where appropriate.

Use groups such as `Content manager` with only view/add/change permissions on crops and diseases. Reserve user/group management, deletion, and prediction deletion for a small super-administrator group.

## Model and recommendation integrity

Inference is available only when the `.keras` model, exact ordered class list, and preprocessing metadata form a coherent bundle. Missing or inconsistent artifacts produce `MODEL_NOT_READY`; there is no sample/random prediction fallback. A successful label must match one active database record exactly.

Model metrics are generated only by evaluation tooling against a real held-out test set. Disease-management text must have a reviewed source. Bundled seed content, if any, is explicitly demo/unvalidated and uses the safe message: `Recommendation pending expert/source validation.`

## Privacy and logging

Version 1 has no farmer accounts and requests no name, address, phone, location, or device identifier. Raw images are not retained by default and are not stored in PostgreSQL. Prediction records contain only model/disease identifiers, confidence, model version, and time. Logs exclude image bytes, passwords, database URLs, service credentials, cookies, and tokens.

## PWA security

The service worker caches the versioned application shell and static assets only. It does not cache `/api`, multipart requests, prediction results, credentials, or administrator content. Offline UI explicitly says that Version 1 prediction requires a connection. Deploy the PWA over HTTPS so service-worker and transport protections apply.

## Production checklist

1. Replace every placeholder secret with independent, high-entropy values in a secret manager.
2. Terminate TLS with a maintained reverse proxy; enable secure cookies and HSTS.
3. Restrict PostgreSQL, Flask, and Django Admin through firewall/network policy.
4. Use least-privilege database roles and test encrypted backup restoration.
5. Build from lock files/pins and scan container images and dependencies.
6. Set container CPU/memory/process limits and edge request/rate limits.
7. Run Node tests/build/lint, Python tests/checks, Django deployment checks, and integration tests.
8. Review model evaluation, class mapping, provenance, and expert-reviewed content before enabling real inference.
9. Centralize redacted logs and alert on repeated 4xx/5xx, authentication lockouts, readiness changes, and inference latency.
10. Verify the service worker never caches API data and perform a clean-origin PWA update test.

## Dependency review

- Node: `npm audit` and `npm audit --omit=dev`; review findings rather than applying forced breaking upgrades blindly.
- Python: `python -m pip install pip-audit` then `python -m pip_audit -r ai-service/requirements.txt -r admin/requirements.txt` in a controlled environment.
- Django: `python admin/manage.py check --deploy` with production environment values.
- Containers: scan built images with the deployment platform's maintained scanner.

The detailed asset/threat/control matrix is in `docs/THREAT_MODEL.md`.
