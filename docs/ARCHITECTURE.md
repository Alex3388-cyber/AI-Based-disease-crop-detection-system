# System architecture

## Context

The project is an installable, mobile-first decision-support PWA. It classifies a submitted crop image only when a real, loaded model is available and joins that model label to administrator-maintained disease information. It does not claim to replace an agronomist or laboratory diagnosis.

```text
Farmer browser / installed PWA
          |
          | HTTPS in production
          v
TLS edge -> Nginx frontend (static PWA + /api proxy)
          |
          | multipart image
          v
Express API (only public application API)
     |                         |
     | parameterized SQL       | authenticated private HTTP
     v                         v
PostgreSQL                 Flask inference service
                                |
                                v
                     OpenCV -> TensorFlow/Keras model

Django Admin -- authenticated, restricted access --> PostgreSQL
```

## Responsibilities

### React PWA

- Presents public crop information and the one-screen detection workflow.
- Performs early file-size/type checks for user feedback, while treating the server as authoritative.
- Caches only the application shell and safe static assets.
- Never calls Flask, holds a service credential, or claims inference works offline.

### Nginx frontend container

- Serves the production React build with SPA fallback and explicit cache rules for hashed assets, the service worker, manifest, and HTML.
- Proxies only `/api/` to Express, applies a 9 MiB request-body ceiling and bounded proxy timeouts, and forwards request/proxy context headers.
- Adds browser security headers and exposes only its loopback port in the supplied Compose topology. A separate maintained TLS edge is still required for internet deployment.

### Express API

- Is the sole browser-facing application API.
- Applies transport, request, validation, upload, resource, and rate controls.
- Verifies decoded image metadata before sending memory-held bytes to Flask.
- Authenticates to Flask and validates its response as untrusted input.
- Resolves exact `model_label` values against PostgreSQL with parameterized queries.
- Refuses public readiness unless the complete active PostgreSQL label set matches Flask's loaded class set by deterministic digest.
- Stores anonymous prediction metadata, not uploaded image bytes.

### Flask inference service

- Is reachable only on the private application network in production.
- Requires the same constant-time-compared service credential on readiness and prediction requests; only liveness is unauthenticated.
- Repeats byte, signature, decode, dimension, and pixel-count validation.
- Uses preprocessing metadata exported with the model.
- Publishes model version and class-set digest only after manifest/hash, class/metadata/training-history, safe-load, input dtype/shape, output-shape, and bounded smoke-inference checks pass.
- Returns `MODEL_NOT_READY` if any required model artifact or runtime contract is absent or inconsistent.

### PostgreSQL

- Is the source of truth for crops, diseases, reviewed information, references, and anonymous prediction metadata.
- Is not exposed to the public network.
- Is accessed by least-privilege application accounts in production.
- Supplies the exact active label list used by Express readiness; both a disease and its crop must be active.

### Django Admin

- Maps to the shared application tables for curated content management.
- Uses Django authentication, CSRF protection, permissions, and hardened production cookies.
- Serves collectstatic-generated, manifest-named compressed assets through WhiteNoise and marks dynamic admin responses `no-store` with CSP and Permissions Policy headers.
- Keeps catalog models unmanaged because SQL owns DDL, while mirroring timestamp defaults and applicable uniqueness constraints for safer admin validation.
- Does not provide a second public application API.

## Prediction sequence

```text
1. Browser validates UX constraints and sends multipart/form-data to Express.
2. Express enforces the request cap, allowlist, magic bytes, and safe decode checks.
3. Express forwards bytes, the accepted or generated request ID, and its service credential to Flask.
4. Flask repeats validation and applies the exact exported preprocessing contract.
5. If no coherent model bundle is loaded, Flask returns MODEL_NOT_READY.
6. Otherwise Flask returns a validated label, confidence, and model version.
7. Express validates the response and looks up the exact active model label.
8. Express records anonymous prediction metadata and returns curated content.
9. React renders confidence honestly and flags results below the configured threshold.
```

## Health semantics

- **Alive:** the process can answer a lightweight liveness request.
- **Flask ready:** authenticated `/ready` has loaded one coherent bundle and returns its model version plus a 64-character class-set digest. Flask liveness at `/health` remains unauthenticated and model-independent.
- **Express ready:** PostgreSQL ping and active-label query succeed, Flask is reachable and model-ready, and the two class-set digests match. Public `checks.aiService.catalogAligned` records the last condition; the digests themselves remain private.
- **Degraded:** the API is alive but PostgreSQL, Flask, the model, or catalog alignment is unavailable. A degraded state must never be presented as full health.

Both services compute the class-set digest as SHA-256 over the UTF-8 bytes of lexicographically sorted labels joined with `\n`, without a trailing newline. This proves set equality under the enforced unique normalized-label constraints; it does not prove model quality or agricultural correctness.

## Model bundle contract

The required inference bundle consists of `best_model.keras`, `class_names.json`, `model_metadata.json`, `training_history.json`, and `bundle_manifest.json`. Class order comes only from `class_names.json`. Metadata defines the model version, input dimensions, RGB/resize/`float32` normalization pipeline, output semantics, dataset version, and calibrated confidence threshold. The history is required release evidence with a completed status, the same model version, bounded epochs, and finite metric series. Model versions use the shared ASCII release-ID pattern `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`.

Training validates the complete split manifest, copies only train/validation entries into a private hash-verified temporary dataset snapshot, and binds every epoch to those immutable copies. It stages its four output artifacts, hashes them into `artifact_manifest.json`, and publishes that source commit marker last; dataset snapshot and artifact staging share failure-safe cleanup. Export verifies the committed hashes, stages a copy, rechecks the source manifest and staged hashes, applies Flask's 1 MiB ceiling to every runtime JSON file, and validates only the coherent staged snapshot. It then replaces the runtime release files sequentially and publishes `bundle_manifest.json` last. Neither publication phase is a single atomic directory swap. On a new load, Flask verifies all four artifact hashes and their JSON contracts before deserialization, loads `.keras` with `safe_mode=True`, validates a single `float32` input and the input/output shapes, runs one bounded zero-filled smoke batch, checks finite/probability output semantics, then verifies the runtime manifest and hashes again. Small tolerated probability roundoff is clipped and renormalized before a confidence value is returned. A torn release cannot be newly loaded; an already-loaded process retains its old coherent in-memory model until an intentional restart.

The metadata threshold (or Flask process-local `MODEL_CONFIDENCE_THRESHOLD` override) determines Flask uncertainty. In Compose, the root `AI_MODEL_CONFIDENCE_THRESHOLD` input is mapped to that Flask variable so the separate root `MODEL_CONFIDENCE_THRESHOLD` can configure Express's conservative floor. Express also marks selected-crop mismatches uncertain. The effective decision is therefore the stricter service result, not an accuracy guarantee.

Measured evaluation is a separate offline evidence boundary. It snapshots the manifest-committed training artifacts, requires the exact split digest and dataset version recorded by training, hash-verifies a copied test-set snapshot, and uses those immutable copies for both evaluation and prediction. Report files are staged and hashed, with `evaluation_manifest.json` published last as the completion marker. These controls establish provenance and coherent publication; they do not make unrepresentative data or a weak model scientifically adequate.

## Trust boundaries

1. Internet to reverse proxy/PWA/API.
2. Express to private Flask service.
3. Express and Django to PostgreSQL.
4. Administrator browser to restricted Django Admin.
5. Offline training environment to reviewed deployment artifacts.

See [THREAT_MODEL.md](THREAT_MODEL.md) and the root `SECURITY.md` for controls at each boundary.
