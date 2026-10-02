# Logistics Webhook Backend

Node.js, Express, and MongoDB backend combining the earlier user-owned webhook API with the shared backend's session security, SSRF defenses, rate limiting, shipment ownership, and operational checks.

## Setup

Requires Node.js 18 or newer and MongoDB.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`.
3. Set `MONGO_URI`, a random `JWT_SECRET` of at least 32 characters, a unique `ADMIN_EMAIL`, and an `ADMIN_PASSWORD` of at least 12 characters.
4. Set `CORS_ORIGIN` to the exact frontend origin(s), comma-separated.
5. Start with `npm run dev`; run tests with `npm test`.

Startup assigns legacy non-admin accounts the customer role, creates the configured admin when needed, and migrates prior user, shipment, event, webhook, and delivery fields into the merged schema. Back up MongoDB before the first startup with this version. Set `ALLOW_LOCALHOST_WEBHOOKS=true` only for local development; production requires HTTPS webhook targets and blocks private/loopback IPs. Refresh cookies are HttpOnly; browser clients must include credentials for auth requests and refreshes.

## Documentation

- [API and migration guide](API_MIGRATION.md)
- [Backend merger change summary](BACKEND_MERGER_SUMMARY.md)
