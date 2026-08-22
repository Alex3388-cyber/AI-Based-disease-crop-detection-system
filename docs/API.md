# API reference

The system exposes one browser-facing REST API through Express and one private inference contract through Flask. The browser must never call Flask directly.

## Base URLs and versions

| Context | Base URL |
| --- | --- |
| Docker/PWA | `http://localhost:8080/api` through the frontend reverse proxy |
| Native development | `http://127.0.0.1:3000/api` |
| Canonical versioned API | `/api/v1` |
| Private Flask service | `http://ai-service:5000` in Compose; `http://127.0.0.1:5000` only for native development |

The Express router is currently mounted at `/api/v1`, `/api`, and `/` for compatibility. New external integrations should use `/api/v1`; the PWA uses `/api`.

## Express conventions

- JSON responses use UTF-8.
- Successful public responses include `success: true` and `requestId`.
- Errors use a stable envelope and do not expose stack traces, database details, private service addresses, or secrets.
- A caller may send `X-Request-ID` containing 1–64 letters, digits, underscores, or hyphens. Invalid values are replaced. The response includes `X-Request-ID`, and Node forwards the accepted/generated ID to Flask readiness and prediction requests for log correlation.
- CORS accepts only configured exact origins. Requests without an `Origin` header, such as server-to-server health checks, are allowed.
- No public endpoint uses cookies or browser credentials in Version 1.
- API responses receive restrictive security headers. The prediction route and centralized error handler set `Cache-Control: no-store`; the PWA service worker treats every `/api/*` request as network-only regardless of response headers.
- Unknown query keys and malformed identifiers are rejected instead of ignored.

Generic error body:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "The request parameters are invalid."
  },
  "requestId": "7ee1b6e3-1f56-4f02-a286-65fd36f02c09"
}
```

## Express endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Process liveness only |
| `GET` | `/ready` | PostgreSQL, Flask/model readiness, and exact active catalog/class-set alignment |
| `GET` | `/crops` | Paginated active crops |
| `GET` | `/crops/:cropId` | One active crop |
| `GET` | `/crops/:cropId/diseases` | Paginated active diseases for one active crop |
| `GET` | `/diseases` | Paginated active diseases, optionally filtered by crop |
| `GET` | `/diseases/:diseaseId` | One active disease |
| `POST` | `/predict` | Validate an image, request inference, enrich and record the mapped result |

Prefix each path with `/api/v1` for the canonical form below.

### `GET /api/v1/health`

This is liveness, not dependency or model readiness.

Response: `200 OK`

```json
{
  "success": true,
  "status": "alive",
  "timestamp": "2026-08-21T10:00:00.000Z",
  "requestId": "7ee1b6e3-1f56-4f02-a286-65fd36f02c09"
}
```

```powershell
curl.exe -i http://127.0.0.1:3000/api/v1/health
```

### `GET /api/v1/ready`

Checks PostgreSQL connectivity, the active model-label query, and the authenticated private Flask readiness response. Flask must pass its manifest/all-artifact hash, class/metadata/completed-history, safe-load, `float32` input, shape, and bounded smoke-inference checks. Express then compares Flask's class-set digest with a digest of every active disease label under an active crop. All checks must pass.

Ready response: `200 OK`

```json
{
  "success": true,
  "status": "ready",
  "checks": {
    "database": { "ready": true },
    "aiService": {
      "reachable": true,
      "modelReady": true,
      "catalogAligned": true
    }
  },
  "modelVersion": "1.0.0",
  "requestId": "7ee1b6e3-1f56-4f02-a286-65fd36f02c09"
}
```

Current repository state: `503 Service Unavailable`

```json
{
  "success": false,
  "status": "degraded",
  "checks": {
    "database": { "ready": true },
    "aiService": {
      "reachable": true,
      "modelReady": false,
      "catalogAligned": false
    }
  },
  "error": {
    "code": "MODEL_NOT_READY",
    "message": "The disease detection model is currently unavailable."
  },
  "requestId": "7ee1b6e3-1f56-4f02-a286-65fd36f02c09"
}
```

The degraded code is `DATABASE_ERROR`, `AI_SERVICE_UNAVAILABLE`, or `MODEL_NOT_READY`, in that precedence order. A loaded model with a missing, inactive, or extra active database label also returns `503 MODEL_NOT_READY`, `modelReady: true`, and `catalogAligned: false`, with the sanitized message `The deployed model and disease catalog are not aligned.` A `503` is expected until real artifacts and exact mappings are installed; do not route user prediction traffic based only on `/health`.

The digest algorithm in both services is SHA-256 over the UTF-8 bytes of lexicographically sorted labels joined with `\n`, with no trailing newline. The public response exposes only `catalogAligned`, not either digest or the private class list.

### `GET /api/v1/crops`

Query parameters:

| Name | Type | Default | Rules |
| --- | --- | --- | --- |
| `limit` | decimal integer string | `50` | 1–100 |
| `offset` | decimal integer string | `0` | non-negative safe integer |
| `search` | string | omitted | trimmed, 1–100 characters |

Only active crops are returned, ordered by name and ID.

Response: `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "name": "Example crop",
      "scientificName": null,
      "description": "Reviewed catalogue description.",
      "active": true,
      "createdAt": "2026-08-21T10:00:00.000Z",
      "updatedAt": "2026-08-21T10:00:00.000Z"
    }
  ],
  "pagination": { "total": 1, "limit": 50, "offset": 0 },
  "requestId": "7ee1b6e3-1f56-4f02-a286-65fd36f02c09"
}
```

The example illustrates shape only; it does not claim that any crop is currently supported. The current database seed is inactive, so a fresh installation returns an empty list.

```powershell
curl.exe -sS "http://127.0.0.1:3000/api/v1/crops?limit=20&offset=0"
```

### `GET /api/v1/crops/:cropId`

`cropId` must be a positive PostgreSQL `BIGINT` identifier expressed as 1–19 decimal digits.

- `200`: active crop object in `data`.
- `400 INVALID_REQUEST`: malformed/out-of-range identifier or unexpected query.
- `404 NOT_FOUND`: no active crop with that identifier.

### `GET /api/v1/crops/:cropId/diseases`

Uses the crop identifier rules above. It accepts `limit`, `offset`, and optional `search`, then returns the same disease representation as `/diseases`. The crop must exist and be active.

### `GET /api/v1/diseases`

Query parameters:

| Name | Type | Default | Rules |
| --- | --- | --- | --- |
| `limit` | decimal integer string | `50` | 1–100 |
| `offset` | decimal integer string | `0` | non-negative safe integer |
| `search` | string | omitted | trimmed, 1–100 characters; matches disease name/model label |
| `cropId` | decimal integer string | omitted | positive PostgreSQL `BIGINT` |

Only active diseases belonging to active crops are returned. `contentStatus` is not exposed. The public representation contains:

```json
{
  "id": "10",
  "cropId": "1",
  "cropName": "Example crop",
  "cropScientificName": null,
  "modelLabel": "example_crop_condition",
  "diseaseName": "Example condition",
  "description": "Reviewed description or a pending-validation message.",
  "symptoms": "Reviewed symptoms or a pending-validation message.",
  "management": "Reviewed guidance or Recommendation pending expert/source validation.",
  "prevention": "Reviewed guidance or Recommendation pending expert/source validation.",
  "sourceReference": "https://example.invalid/reviewed-source",
  "reviewedAt": "2026-08-21T10:00:00.000Z",
  "active": true,
  "createdAt": "2026-08-21T10:00:00.000Z",
  "updatedAt": "2026-08-21T10:00:00.000Z",
  "contentValidated": true
}
```

The names and URL above are contract placeholders, not agricultural claims. When the database record is not `validated`, Express replaces description, symptoms, management, prevention, and source with explicit pending-review text and returns `contentValidated: false` even if draft database text exists.

### `GET /api/v1/diseases/:diseaseId`

Uses the same positive identifier rule and public disease representation.

- `200`: disease object in `data`.
- `400 INVALID_REQUEST`: malformed/out-of-range identifier or unexpected query.
- `404 NOT_FOUND`: no active disease under an active crop.

### `POST /api/v1/predict`

Content type: `multipart/form-data` generated by the client. Do not set a manual multipart boundary.

Fields:

| Name | Required | Rules |
| --- | --- | --- |
| `image` | yes | exactly one JPEG/JPG, PNG, or WEBP; maximum 8 MiB; safe basename; matching single extension/MIME/signature; decodable single image; dimensions and pixels within configured bounds |
| `cropId` | no | one positive PostgreSQL `BIGINT`; selected crop must exist and be active |

No other file, field, or query parameter is accepted. Node keeps the upload in memory, fully validates it with Sharp, then sends a server-controlled filename and MIME to Flask. Flask independently preflights encoded dimensions, decodes with OpenCV, applies the model metadata, and performs inference only when ready.

Windows example:

```powershell
curl.exe -i -X POST http://127.0.0.1:3000/api/v1/predict `
  -H "Accept: application/json" `
  -F "image=@C:\path\to\leaf.jpg;type=image/jpeg" `
  -F "cropId=1"
```

Successful response shape: `200 OK`

```json
{
  "success": true,
  "prediction": {
    "crop": "Mapped crop name",
    "cropScientificName": null,
    "disease": "Mapped disease name",
    "modelLabel": "exact_model_output_label",
    "confidence": 0.91,
    "uncertain": false,
    "warning": null,
    "description": "Reviewed disease description.",
    "symptoms": "Reviewed symptom text.",
    "management": "Reviewed management text.",
    "prevention": "Reviewed prevention text.",
    "sourceReference": "Reviewed source reference.",
    "contentValidated": true,
    "modelVersion": "1.0.0",
    "disclaimer": "This AI result is preliminary decision support, not a guaranteed diagnosis."
  },
  "requestId": "7ee1b6e3-1f56-4f02-a286-65fd36f02c09"
}
```

The labels and values above illustrate the contract only and are not a real prediction or metric.

Uncertainty is true if:

- Flask marks the result uncertain using the model/override threshold;
- confidence is below the Express `MODEL_CONFIDENCE_THRESHOLD`; or
- the optional selected crop does not match the crop mapped to the returned disease.

A crop mismatch returns a specific warning; other uncertain results return the low-confidence warning. The response still remains preliminary decision support. Unknown model labels cause `502 PREDICTION_FAILED`, not an unenriched result.

After a successful mapped response, PostgreSQL receives only disease ID, model label, confidence, uncertainty, model version, and timestamp. Image bytes, original filename, IP, account, location, and device data are not part of the prediction table.

## Express error codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Malformed body, strict-query/field violation, or invalid crop/ID |
| 400 | `INVALID_IMAGE` | Missing/empty image or invalid multipart shape/metadata |
| 403 | `CORS_NOT_ALLOWED` | Browser origin is outside the exact allowlist |
| 404 | `NOT_FOUND` | Endpoint or active resource does not exist |
| 413 | `FILE_TOO_LARGE` | Multipart image exceeds the configured maximum (at most 8 MiB) |
| 415 | `UNSUPPORTED_FILE_TYPE` | Extension/MIME/format combination is unsupported or inconsistent |
| 422 | `INVALID_IMAGE_CONTENT` | Signature-bearing file is malformed, undecodable, multi-page, or outside safe dimensions |
| 429 | `RATE_LIMITED` | Request rate exceeded |
| 502 | `PREDICTION_FAILED` | Invalid AI response/output, unprocessable service response, or no active disease mapping |
| 503 | `MODEL_NOT_READY` | Real inference bundle is missing/incompatible |
| 503 | `AI_SERVICE_UNAVAILABLE` | Flask cannot be reached or returns an operational server failure |
| 503 | `DATABASE_ERROR` | Database operation/readiness failed |
| 503 | `SERVICE_BUSY` | In-process prediction concurrency is full |
| 503 | `REQUEST_TIMEOUT` | Express request deadline elapsed |
| 500 | `INTERNAL_ERROR` | Unexpected sanitized server failure |

Multer-related multipart violations that are not a file-size overflow map to `INVALID_IMAGE`. Public messages are intentionally stable; use `requestId` to correlate with bounded internal logs.

Default rate limits are 120 general requests and 10 prediction requests per 60-second window per interpreted client address. They are configurable with `GENERAL_RATE_LIMIT_MAX`, `PREDICTION_RATE_LIMIT_MAX`, and `RATE_LIMIT_WINDOW_MS`. Set `TRUST_PROXY` only to the exact trusted proxy hop count.

## Private Flask contract

Flask is not a browser API. Keep it on a private network and never expose `AI_SERVICE_SECRET` to frontend code.

### `GET /health`

No service-secret header is required by the current implementation.

```json
{"status": "alive"}
```

Returns `200` even if no model is loaded.

### `GET /ready`

Requires `X-Service-Secret`. Node uses this authenticated check, so a missing, empty, or mismatched service credential cannot produce green application readiness. The endpoint must still remain network-private.

Ready, `200`:

```json
{
  "ready": true,
  "modelVersion": "1.0.0",
  "classSetDigest": "281ad8a40c3a6c0cfd9852821ef1ee5782170ebb62be65bf32e54e38da926d5d"
}
```

The example digest is for the single illustrative label `exact_model_output_label`; it is not a repository model claim. Express validates the digest as exactly 64 lowercase hexadecimal characters before comparing it with the active PostgreSQL label set. Ready and prediction `modelVersion` values must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`.

Not ready, `503`:

```json
{"ready": false, "reason": "MODEL_NOT_READY"}
```

### `POST /predict`

Required header:

```text
X-Service-Secret: <shared secret>
```

Required body: exactly one multipart file named `image`, with no form fields. Node supplies a controlled filename such as `upload.jpg`.

Successful internal response:

```json
{
  "modelLabel": "exact_model_output_label",
  "confidence": 0.91,
  "modelVersion": "1.0.0",
  "uncertain": false
}
```

Node accepts only these four keys and validates their types/ranges/label format before use. Flask accepts only finite output values, an exact output shape, and either validated probabilities or metadata-declared logits converted with softmax.

Private error body:

```json
{
  "error": {
    "code": "MODEL_NOT_READY",
    "message": "The disease detection model is currently unavailable."
  },
  "requestId": "98f7b82b5ab94de992ad9d11f753dcea"
}
```

Relevant private codes include `UNAUTHORIZED`, `SERVICE_NOT_CONFIGURED`, `INVALID_REQUEST`, `INVALID_IMAGE`, `UNSUPPORTED_FILE_TYPE`, `INVALID_IMAGE_CONTENT`, `FILE_TOO_LARGE`, `SERVICE_BUSY`, `MODEL_NOT_READY`, `PREDICTION_FAILED`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, and `INTERNAL_ERROR`. Express deliberately maps these into its smaller sanitized public error set.

## Change policy

Update this document, the strict schemas, frontend consumer, and tests in the same change whenever a field, status, validation rule, or endpoint changes. Do not silently break `/api/v1`; introduce a new version for incompatible public behaviour. See [DEVELOPMENT.md](../DEVELOPMENT.md#api-change-workflow).
