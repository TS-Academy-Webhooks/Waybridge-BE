# Backend merger change summary

The merged implementation lives in this directory. It uses the shared `backend` as the security and operational base and restores the compatibility-oriented capabilities from `backend-my-part`. Source backend directories were left untouched; `webhooks\frontend` was not used.

## Imported foundation

- `server.js`, `.env.example`, `src/app.js`, and `src/config/db.js`: connected startup, explicit environment safety checks, CORS/Helmet/JSON raw-body handling, auth and tracking rate limits, protected routes, and controlled demo receiver.
- `src/middleware/*`, `src/services/authService.js`, `src/models/User.js`, `src/models/RefreshSession.js`, and `src/controllers/authController.js`: session-bound JWTs, hashed/rotating refresh tokens in HttpOnly cookies, password revocation, role enforcement, admin bootstrap, and structured API errors.
- Shipment, tracking, event, webhook, and delivery-attempt routes/controllers/models/services: modern customer assignment, legal status transitions, event creation, bounded webhook delivery, input validation, URL/SSRF policy, and isolated delivery history.
- `test/api.test.js`: retained node:test coverage for security, schemas, transitions, routing, and validation.

## Merger-specific behavior and source differences

| Area | Change made | Main implementation |
| --- | --- | --- |
| Error contract | Added field-level `errors[]` while preserving the common success/message/data envelope. | `src/utils/AppError.js`, `src/utils/apiResponse.js`, `src/middleware/validateRequest.js`, `src/middleware/errorHandler.js` |
| List contract | Added legacy `items` and `pagination.total`, retaining resource-named aliases and `totalItems`. | `src/utils/apiResponse.js`, shipment/event/webhook/delivery controllers |
| Auth payload | Added `token` as an alias for `accessToken`; `/me` returns both flat user fields and nested `user`. Password/session security remains from the shared backend. | `src/controllers/authController.js` |
| Webhook ownership | Added required `ownerId`; customers see/manage only their own hooks and admins can manage all. | `src/models/webhook.js`, `src/controllers/webhookController.js`, `src/app.js` |
| Webhook features | Restored field-level validation, masked secrets, explicit regeneration, wildcard subscriptions, one-off test events, owner scoping, and `PUT` plus `PATCH`. `active` and `isActive` work as aliases. | `src/models/webhook.js`, `src/routes/webhookRoutes.js`, `src/controllers/webhookController.js` |
| Webhook delivery protocol | Restored the earlier `{ id, type, createdAt, data }` body and timestamped `sha256=` HMAC headers. The demo receiver also accepts the shared backend's raw-body signature during migration. | `src/services/webhookDelivery.js`, `src/controllers/demoReceiverController.js` |
| Delivery lifecycle | Added a delivery summary (`pending`/`success`/`failed`, attempt count, timestamps) with linked individual attempts, nested attempt history, manual resend/retry aliases, and owner-scoped queries. | `src/models/Delivery.js`, `src/models/DeliveryAttempt.js`, `src/services/webhookDelivery.js`, `src/controllers/deliveryController.js`, `src/routes/deliveryRoutes.js` |
| Shipment and event compatibility | Added `id`, earlier `timeline`/`at`, and event shipment aliases. Status notes are retained in history and events. Added `/api/health` beside `/health`. | `src/models/Shipment.js`, `src/models/event.js`, `src/services/shipmentService.js`, `src/services/eventService.js`, controllers, routes, `src/app.js` |
| URL protection | Kept hostname/IP SSRF checks and added production HTTPS-only validation; local development requires the explicit localhost flag. | `src/utils/validateWebhookUrl.js` |
| Existing database data | Added idempotent startup migration for old password field/roles, shipment timeline/customer ownership, event references, webhook ownership/active fields, and delivery summaries/attempts. Shared-backend ownerless hooks are assigned to the bootstrap admin. | `src/services/legacyDataMigration.js`, `src/services/authService.js`, `server.js` |
| Documentation | Replaced the inherited README's superseded API/security descriptions and added a complete API, compatibility, breaking-change, configuration, and migration guide. | `README.md`, `API_MIGRATION.md` |
| Regression coverage | Updated shared-backend expectations and added signature, compatibility-pagination, webhook-schema, legacy-health, validation-error, and production-HTTPS assertions. | `test/api.test.js` |

## Incompatibilities to coordinate

- Existing parent access tokens cannot be migrated into database sessions. Users must log in again; browser clients must handle the HttpOnly refresh cookie and credentialed requests.
- Passwords must now be at least 12 characters. Existing hashes are preserved, but future registration/password changes enforce the new minimum.
- The shared backend's raw-payload webhook body/signature is replaced with the earlier timestamped envelope/signature; external shared-backend receivers need a coordinated update.
- Delivery list entries are delivery summaries rather than standalone attempts; attempt details are nested and previous attempt IDs remain accepted for detail/resend.
- Existing non-admin roles are normalized to `customer`; admin remains admin. Production hooks using non-HTTPS or private destinations will be rejected.

See [API_MIGRATION.md](API_MIGRATION.md) for endpoint contracts, examples, migration details, and operational requirements.
