# API and migration guide

This guide describes the merged backend in `waybridge-be`, its compatibility aliases, and the changes a client migrating from either parent backend must account for. All API paths below are rooted at `/api`, except the root and health endpoints.

## Common response envelope

Success responses use `success`, `message`, and `data`. Errors return `success: false`, a human-readable `message`, and `data: null`. Validation errors also include a field-level `errors` array:

```json
{
  "success": false,
  "message": "Validation failed",
  "data": null,
  "errors": [
    { "field": "events", "message": "Select at least one event" }
  ]
}
```

For paginated lists, `data.items` and `data.pagination.total` preserve the earlier API's shape. To ease migration in the other direction, the resource-named array (`shipments`, `webhooks`, `events`, or `deliveries`) and `pagination.totalItems` are included as aliases. Pagination also contains `page`, `limit`, and `totalPages`.

Mongo documents retain `_id` and include the earlier `id` alias where relevant. These aliases are additive.

## Authentication and roles

| Method and path | Access | Purpose |
| --- | --- | --- |
| `POST /api/auth/register` | Public | Create a customer account; requires name (2-60 characters), valid email, and password (12+ characters). Submitted role values are ignored. |
| `POST /api/auth/login` | Public | Authenticate with email and password. |
| `POST /api/auth/refresh` | Refresh cookie | Rotate the refresh session and issue a new access token. |
| `POST /api/auth/logout` | Refresh cookie | Revoke the current refresh session. |
| `POST /api/auth/change-password` | Access token | Change password (12+ characters) and revoke every active session for that user. |
| `GET /api/auth/me` | Access token | Return the current public user. |

Registration returns its 15-minute access token as `data.token`. Login and refresh return the same token under both `data.accessToken` and the compatibility alias `data.token`. `GET /api/auth/me` returns the public user both as a flat `data` object and under `data.user`.

The refresh token is not returned in JSON. It is set as a 30-day HttpOnly cookie scoped to `/api/auth`; production cookies are Secure and named `__Secure-refreshToken`. `REFRESH_COOKIE_SAME_SITE` defaults to `strict`; `none` is accepted only in production HTTPS. Browser clients must send auth requests with credentials enabled and use the returned access token in `Authorization: Bearer <token>`. Keep access tokens in memory rather than browser storage.

Access tokens are bound to a live database session and invalidated immediately by logout or password change. Tokens from either parent are not valid for this backend; users must sign in again. Admin accounts are provisioned from `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` at startup. Public registration cannot create admins.

Customers can read only their shipments, webhooks, and deliveries. Admins can access all accounts' data and perform admin operations, including changing shipment status and reassigning shipments.

## Shipments and tracking

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /api/shipments?page=&limit=&search=&status=` | Access token | Paginated shipment list. Customers see only shipments assigned to them. |
| `POST /api/shipments` | Access token | Create a shipment and its `shipment.created` event. Customers provide `origin`, `destination`, and `amount`; admins also provide `customer` and may provide `customerId`. |
| `GET /api/shipments/:id` | Access token | Read one shipment subject to customer ownership. |
| `PATCH /api/shipments/:id/customer` | Admin | Assign a shipment using `{ "customerId": "<customer ID>" }`. |
| `PATCH /api/shipments/:id/status` | Admin | Apply a valid status using `{ "status": "...", "note": "..." }`. `note` is optional. |
| `GET /api/tracking/:trackingNumber` | Public | Read the public tracking status and timeline. |

Shipment list data contains `items` and the additive `shipments` alias. Records include `statusHistory`; the earlier `timeline` alias is also included with both `at` and `timestamp` fields and any status note.

Allowed transitions retain the shared backend's workflow: `created -> picked_up -> in_transit -> arrived_at_hub -> out_for_delivery -> delivered`; `arrived_at_hub` may return to `in_transit`; `out_for_delivery` may become `delivery_failed`, which may return to `out_for_delivery` or be cancelled. Early in-progress states may be cancelled. `delivered` and `cancelled` are terminal.

## Webhooks

All webhook endpoints require an access token. A customer owns the hooks they create; an admin can manage every hook.

| Method and path | Purpose |
| --- | --- |
| `GET /api/webhooks?page=&limit=&search=&active=&event=` | Paginated hooks. Secret values are masked. `isActive` is accepted as a query alias for `active`. |
| `POST /api/webhooks` | Create a hook with `{ "name", "url", "events" }`; may also receive `active` or `isActive`. |
| `GET /api/webhooks/:id` | Read a hook. Secret stays masked. |
| `PATCH /api/webhooks/:id` or `PUT /api/webhooks/:id` | Update any of `name`, `url`, `events`, `active`/`isActive`; `{ "regenerateSecret": true }` generates a replacement. |
| `DELETE /api/webhooks/:id` | Delete an owned hook (or any hook as admin). |
| `GET /api/webhooks/:id/deliveries?page=&limit=&status=` | List this hook's delivery summaries and attempts. |
| `POST /api/webhooks/:id/test` | Queue a one-off `webhook.test` delivery, if the hook is active. Returns `202`. |

Events may be any supported `shipment.*` type or `"*"`. New secrets are shown in full only on create or the request that regenerates them; normal list/detail responses mask them. Store a secret securely when it is shown.

URLs must be valid HTTP(S), contain no credentials, and pass the environment's URL policy. Production requires HTTPS and blocks private, loopback, and link-local IP addresses after DNS resolution. The exact `localhost` hostname is allowed only when `NODE_ENV=development`, `ALLOW_LOCALHOST_WEBHOOKS=true`, and `ENABLE_DEMO_RECEIVER=true`; loopback aliases remain blocked, and any other environment or flag combination rejects localhost. Restrict outbound network access in production as additional protection against DNS rebinding.

## Events, deliveries, and signature verification

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /api/events?page=&limit=&type=&search=` | Admin | Paginated shipment events and test events. |
| `GET /api/events/:id` | Admin | Read by Mongo ID or public `evt_` event ID. |
| `GET /api/deliveries?page=&limit=&status=&webhookId=&eventId=` | Access token | Paginated delivery summaries; customers see their own, admins see all. |
| `GET /api/deliveries/:id` | Access token | Read a delivery summary and its attempt history. A historical attempt ID is also accepted. |
| `POST /api/deliveries/:id/resend` or `POST /api/deliveries/:id/retry` | Access token | Queue a new attempt for a failed delivery; accepts a summary ID or historical attempt ID. Returns `202`. |

Each webhook/event pair has a summary with `pending`, `success`, or `failed` status and an `attemptCount`; each individual request is a separate attempt with its number, status, HTTP status, response, error, and duration. The earlier attempt field names (`statusCode`, `responseBody`, and `durationMs`) are aliases. Automatic delivery makes at most three attempts, with 2- and 5-second retry delays; manual resend adds one more attempt. A request has a five-second timeout, and receiver response text is limited to 1000 characters.

The request body preserves the earlier receiver envelope:

```json
{
  "id": "evt_123456",
  "type": "shipment.created",
  "createdAt": "2026-10-02T22:00:00.000Z",
  "data": {}
}
```

The backend signs the exact serialized body with HMAC-SHA256 over `<unix-timestamp-seconds>.<raw-body>`. Headers are:

| Header | Value |
| --- | --- |
| `X-Webhook-Signature` | `sha256=<hex HMAC>` |
| `X-Webhook-Timestamp` | Unix timestamp in seconds |
| `X-Webhook-Event` | Event type |
| `X-Webhook-Delivery` | Delivery summary ID |

Receivers must verify the raw request bytes, timestamp freshness, and signature using a constant-time comparison; parsing and reserializing JSON can change the signature. The included demo receiver accepts the selected timestamped scheme and the shared backend's older raw-body signature during migration.

## Health and demo routes

`GET /health`, `GET /api/health`, and `GET /` are public. `/health` and `/api/health` use the standard response envelope.

`/api/demo-receiver` is available outside production by default and can be enabled in production only with `ENABLE_DEMO_RECEIVER=true`. Incoming POSTs are public so webhook providers can reach the receiver; history and response-profile management require an admin access token.

| Method and path | Access | Purpose |
| --- | --- | --- |
| `POST /api/demo-receiver` | Public | Record a request and return the configured success response. |
| `POST /api/demo-receiver/fail` | Public | Record a request and return the configured failure response. |
| `GET /api/demo-receiver?page=&limit=&signatureValid=&event=` | Admin | Read filtered, paginated request history. `signatureValid` accepts `true`, `false`, or `unknown`. |
| `DELETE /api/demo-receiver` | Admin | Clear request history. |
| `GET /api/demo-receiver/config` | Admin | Read the current success and failure response profiles. |
| `PATCH /api/demo-receiver/config` | Admin | Update either profile's `statusCode` and/or JSON `body`. Success statuses must be 2xx; failure statuses must be 4xx or 5xx. |
| `DELETE /api/demo-receiver/config` | Admin | Restore the default response profiles. |

The receiver retains at most 100 requests in memory and resets history and response profiles on restart. History defaults to page 1 with 20 requests per page (maximum 50); `event` matches the event type exactly. Captured body previews are limited to 64 KiB; oversized bodies include `bodyTruncated: true`. Authorization, cookie, API-key, and webhook-signature headers are redacted. Each record reports `signatureValid` (`true`, `false`, or `null`) and `signature` metadata describing whether verification was valid, invalid, or missing, the timestamped or legacy signing scheme, and timestamp freshness where available. The timestamped HMAC-SHA256 format and the legacy raw-body format are both accepted. Signature verification infrastructure errors are returned as errors rather than recorded as successful verification.

The default success response remains `201` with the standard success envelope and received-request data. The default `/fail` response is the standard `500` error envelope. A profile's body is optional in `PATCH`; omitting it keeps the default response body, while providing it replaces that body with the supplied JSON value. Public POST routes are rate limited to 1,200 requests per IP per 15 minutes.

## Automatic database migration

Back up the database before the first start. Startup applies idempotent field migrations before listening:

- Legacy bcrypt hashes in `User.password` are moved to `passwordHash`; old non-admin roles (`user`, `merchant`, `operations`, missing, or other values) become `customer`.
- Shipment `timeline` entries become `statusHistory`; customer-created shipments are assigned to their creator when that creator is now a customer. Older admin-created shipments without a customer assignment remain admin-visible until reassigned.
- Event `shipment` references become `shipmentId`.
- Earlier user-owned hooks retain their owners. Shared-backend hooks with no owner are assigned to the configured bootstrap admin. Legacy `active` and `user` fields map to `isActive` and `ownerId`.
- Legacy delivery summaries and attempt fields map to the merged `Delivery`/`DeliveryAttempt` collections. Shared-backend standalone attempts are grouped into summaries by webhook and event.

Refresh sessions cannot be migrated from either parent's access tokens. All users must authenticate again to obtain a session-bound token.

## Differences and breaking changes from the parents

| Area | Merged behavior and migration impact |
| --- | --- |
| Access tokens | Legacy and shared-backend JWTs are rejected; login again. New access tokens expire after 15 minutes and require a live session record. |
| Refresh token | New HttpOnly refresh cookie replaces long-lived bearer-token-only sessions. Clients need credentialed refresh/logout requests; production uses HTTPS/Secure cookies. |
| Password rules | Registration and password change require 12 characters (the earlier backend accepted 8). |
| `/auth/me` | Flat public-user fields remain and `data.user` is added. |
| List responses | `items`/`pagination.total` remain; resource-named lists and `totalItems` are additive aliases. |
| Validation errors | Field details return in `errors[]`; the shared backend previously returned only a single message. |
| Webhook access | User ownership returns; admins retain all-hook access. Shared-backend hooks are assigned to the bootstrap admin during migration. |
| Webhook active field and update method | Both `isActive` and `active` are accepted/returned; both `PUT` and `PATCH` update routes work. |
| Webhook secrets | Masked on reads; create and explicit regeneration are the only full-secret responses. |
| Webhook signature/body | The timestamped, prefixed signature and `{ id, type, createdAt, data }` envelope restore the earlier contract. Shared-backend receivers expecting its raw-payload body/signature must update; the demo receiver temporarily verifies both signature formats. |
| Delivery API | Responses are per-delivery summaries with nested attempt history instead of only individual attempts. Attempt IDs remain accepted for detail/resend compatibility, but list entries are summaries. |
| Wildcard/test features | `"*"` subscriptions and `POST /api/webhooks/:id/test` are supported again. |
| Shipment model | Customer assignment/ownership and the shared backend's backward re-routing transition are retained; status history also exposes the earlier `timeline` alias. |
| Legacy roles | Non-admin roles are normalized to `customer`; prior `operations`/`merchant` distinctions are not preserved. |
| Webhook URL security | Production now requires HTTPS and rejects private/loopback/link-local targets, so unsafe destinations accepted by the earlier backend will be rejected. |
| Health path | `/api/health` is retained alongside `/health`. |

## Configuration

See `.env.example`. The backend listens on `PORT` (default `5000`); the local Chadman frontend runs on `http://localhost:3000` and uses `http://localhost:5000/api` as its default API base. `JWT_SECRET` must contain at least 32 non-example characters. Production startup rejects localhost or wildcard CORS origins. Set `CORS_ORIGIN` to exact allowed origins and use HTTPS. Admin credentials must be unique and non-example; keep them out of source control.
