# Threat model

## Scope and assumptions

This model covers the Version 1 public PWA, Nginx frontend/proxy, Express API, PostgreSQL data, private Flask service, model bundle, training tooling, and Django administration. Public users are anonymous. Uploaded images, administrator-entered content, model artifacts, and all inter-service data are untrusted until validated. TLS termination, host patching, secret storage, backups, external network policy, and platform CPU/memory quotas are deployment responsibilities.

The review baseline is the [OWASP Top 10:2025](https://owasp.org/Top10/), [OWASP API Security Top 10:2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/), [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), and [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html).

## Assets

- Accuracy and integrity of the model, class order, preprocessing metadata, release evidence, and bundle manifest.
- Integrity and availability of crop/disease knowledge and source references.
- PostgreSQL credentials and stored anonymous prediction metadata.
- Django administrator identities, sessions, permissions, and static/dynamic administration responses.
- Flask service credential and internal network boundary.
- Availability of the API and compute-heavy inference path.
- Temporary uploaded image bytes and user privacy.
- Logs, request IDs, build dependencies, and deployment configuration.

## Threats and mitigations

| Threat | Exposed asset | Principal implemented mitigations | Residual risk / required operation |
| --- | --- | --- | --- |
| Polyglot, spoofed, malformed, multi-frame, or decompression-bomb image | API/AI availability | 9 MiB Nginx request cap; exact 8 MiB Node/Flask image caps; extension/MIME/magic allowlist; Sharp and OpenCV validation; dimension/pixel bounds; single-frame and memory-only processing | Decoders may have vulnerabilities. Patch/scan libraries, benchmark real workloads, and add platform CPU/memory quotas; Compose does not define those quotas. |
| Path traversal or executable upload | Host filesystem | Safe basename and double-extension rules; no client path use; no public upload directory; no shell invocation; no retained file | Any future upload retention needs a separate storage, malware-scanning, authorization, and lifecycle design. |
| SQL injection | Disease knowledge and prediction data | Strict schemas; parameterized `pg` queries; no dynamic user SQL; sanitized errors; least-privilege runtime role | Review future search, sort, reporting, and raw-query features separately. |
| XSS through managed content or labels | Farmer browser/admin session | React text rendering; no `dangerouslySetInnerHTML`; strict response schemas; Nginx/Express CSP; Django escaping and admin CSP | Administrators can still enter misleading plain text; source and editorial review remain required. |
| CSRF against administration | Knowledge-base integrity | Django CSRF middleware; exact trusted-origin configuration; SameSite cookies; secure-cookie controls for HTTPS deployment | A compromised administrator device/session remains a risk. Restrict the admin network and use external MFA/identity controls where appropriate. |
| Brute force or excess admin privilege | Admin account | Password validators/hashing; Axes lockout by username and IP with cooldown/reset; scoped groups/model permissions; no default user; predictions read-only | Operators must provision named strong accounts, review permissions, and monitor lockouts. Django does not provide deployment-level MFA here. |
| Unsafe admin caching/static delivery | Admin session and availability | Dynamic admin responses are `no-store`; CSP/Permissions Policy headers; build-time `collectstatic`; WhiteNoise compressed manifest storage; non-root Gunicorn container | TLS and edge cache rules are external. Rebuild after static changes and test Admin behind the real proxy. |
| Public or forged Flask readiness/prediction requests | Model information and compute | No published Flask port in Compose; readiness and prediction require one shared-secret header; constant-time comparison; private internal network; liveness reveals only `alive` | Rotate the credential and prefer workload identity or mTLS for larger/multi-host deployments. Network isolation is still operator-controlled. |
| Malicious or malformed Flask response | API integrity | Strict Zod schemas; bounded response read; request-ID correlation; timeouts; exact label mapping; confidence/range/type checks; sanitized public errors | A compromised inference service can still deny service. Isolate, patch, and monitor it. |
| Missing or incompatible model yields fabricated result | Farmer safety | No fallback prediction; authenticated fail-closed readiness; `MODEL_NOT_READY`; strict bundle, class, metadata, completed-history, shape, dtype, smoke-output, and inference-output validation | A contract-valid but poorly trained model remains possible. Only measured evaluation and domain review can establish fitness. |
| Torn, replaced, or malicious model release | Model integrity and service safety | Training source `artifact_manifest.json`; source and staging hash rechecks during export; runtime `bundle_manifest.json`; both manifests published last; exact all-artifact file set; regular-file/symlink/size checks; 1 MiB JSON parity; runtime SHA-256 checks before and after safe-mode deserialization plus a bounded smoke load; read-only model mount | The co-located manifests are unsigned and prove consistency, not publisher authenticity. Protect artifact write access, scan/sign releases externally, retain provenance, and restart to activate a new bundle. An already-loaded worker keeps its prior in-memory model. |
| Training data changes during a run | Model integrity and reproducibility | Full split-manifest validation; duplicate/cross-split protection; only train/validation entries copied to a private snapshot; each copy hash-verified; all epochs bound to the snapshot; failure-safe cleanup | Hash stability does not establish dataset quality, consent, licence, or representativeness; those require separate governance and review. |
| Wrong split, mutable test data, or partial evaluation report | Academic/model evidence | Evaluation snapshots a committed artifact release; requires metadata's exact split digest and dataset version; copies test files with pre/post SHA-256 checks; uses one immutable snapshot for both passes; records provenance/test digests; stages and hashes reports; publishes `evaluation_manifest.json` last | Hashes prove identity and coherent publication, not representativeness or scientific quality. Protect/sign evidence externally and independently review dataset design and failure slices. |
| Missing, extra, inactive, or stale model-label mapping | Farmer safety | Globally unique normalized labels; exact active-record lookup; Flask and Express class-set SHA-256 digest comparison at readiness; `catalogAligned`; unknown prediction label fails | Digest equality proves label-set agreement, not that the semantic disease/crop association or advice is correct. Review content and run a controlled mapped prediction. |
| Unvalidated agricultural advice | Farmer safety | Seed is inactive/unvalidated; validated state requires all content/source fields and review time; placeholder management/prevention is rejected; pending content is masked; visible disclaimer | Qualified regional experts must review advice, legal constraints, and any treatment claim before use. |
| Misleading confidence or unknown-class input | Farmer safety | Metadata/optional Flask threshold plus independent Express floor; selected-crop mismatch warning; explicit uncertainty and disclaimer | Default `0.70` is not calibrated, and softmax confidence is not out-of-distribution detection. Calibrate on representative data and add measured OOD/quality controls. |
| Excess requests or inference denial of service | Availability/cost | Nginx body/time limits; Express general/prediction rate limits and concurrency gate; Flask semaphore/queue timeout; request and upstream timeouts | Limits are process-local and Compose has no CPU/memory reservations. Distributed attacks and multiple replicas require edge rate limiting/WAF, shared queues/limits, quotas, and capacity planning. |
| Secret disclosure | All protected services | Environment-only secrets; ignored `.env`; placeholder/length rejection in production; no frontend secret; bounded logs and generic errors | Use a deployment secret manager, least-privilege access, rotation, and leak response. `docker compose config` can print resolved secrets. |
| Dependency or build-chain compromise | All services | npm lock files, pinned Python ranges, audit/check guidance, multi-stage/non-root images, reviewed upgrade workflow | Production CI still needs automated source/image/model scanning, immutable image references, provenance, and preferably signatures. |
| Service worker leaks sensitive response | Prediction privacy | Only shell/static assets are cached; `/api/*` is Workbox `NetworkOnly`; cache version/update rules | Re-test generated service-worker output whenever routes or PWA configuration change. |
| Excess logging or image retention | User privacy | No image-body/original-filename logging; no permanent raw-image storage; anonymous prediction metadata only; request IDs are not device IDs | Reverse proxies/platforms may add IP metadata. Apply equivalent access, redaction, and retention rules there. |
| Database loss or tampering | Knowledge and prediction history | SQL checks/uniqueness/FKs; transactions; private network; separate owner/runtime roles; backup/restore guidance | Encryption, off-host schedules, monitoring, and actual restore drills are operator responsibilities. Django validation is not a replacement for database constraints. |
| Exceptional-condition leakage | Secrets/internals | Central error envelopes; production stack suppression; response/body bounds; timeouts; readiness distinct from liveness | Monitor internal errors without exposing traces, artifact paths, credentials, or unbounded logs. |

## Abuse and failure cases that tests must cover

- A text payload named `leaf.jpg`, traversal-shaped names, and a double extension such as `leaf.jpg.php`.
- Incorrect MIME declarations, malformed multipart requests, multiple files/fields, and multi-frame images.
- Over-limit bytes, dimensions, and pixels at the relevant boundary.
- Missing, invalid, placeholder, and rotated Flask credentials for both `/ready` and `/predict`.
- Missing/symlinked/oversized artifacts; malformed manifest/metadata/classes/history; history/version mismatch; hash mismatch; a bundle changing during load; invalid dtype/shape; failed/non-finite smoke output; and bounded probability roundoff.
- Evaluation with the wrong artifact manifest, split digest, dataset version, or changed test file, plus a report interrupted before its final evaluation manifest.
- A model-ready Flask response with a missing, extra, or inactive active PostgreSQL label, producing `catalogAligned: false` and public `MODEL_NOT_READY`.
- Unknown prediction labels, malformed Flask responses, unavailable Flask/PostgreSQL, inference busy/timeout, and no fabricated result.
- Repeated requests reaching the configured HTTP 429 boundary and concurrent predictions reaching the busy response.
- Anonymous Django Admin access, repeated login failures, CSRF rejection, form/default/uniqueness validation, read-only predictions, static delivery, and security/no-store headers.
- Production PWA output proving `/api` remains network-only and the shell does not imply offline inference.

## Review triggers

Repeat threat modeling before adding accounts, geolocation, image retention, offline inference, remote dataset ingestion, a public Django endpoint, a new file type/model format, pesticide dosage content, external AI providers, multi-instance inference, or automated model hot-swapping.
