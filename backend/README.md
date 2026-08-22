# Main API

Requires Node.js 20.11 or newer. Copy `.env.example` to `.env` outside source
control, replace every secret, then run `npm install` and `npm run dev`.

The process refuses to start when required database or service credentials are
missing. The public API lives below `/api/v1`; `/health` is process liveness and
`/ready` verifies PostgreSQL, the inference service, and actual model readiness.
Prediction uploads stay in memory, are limited to 8 MB, are verified by signature
and full image decode, and are never persisted by this service.

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` before
deployment. Unit/security tests inject database and AI adapters and therefore do
not require a running PostgreSQL server, Flask process, or trained model.

Set `TRUST_PROXY` only to the exact proxy hop count used in deployment; an
incorrect value weakens IP-based rate limiting. Keep the AI URL on a private
network and never expose `AI_SERVICE_SECRET` to browser code.
