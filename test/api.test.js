const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const User = require("../src/models/User");
const Shipment = require("../src/models/Shipment");
const RefreshSession = require("../src/models/RefreshSession");
const Webhook = require("../src/models/webhook");
const Event = require("../src/models/event");
const DeliveryAttempt = require("../src/models/DeliveryAttempt");
const Delivery = require("../src/models/Delivery");
const app = require("../src/app");
const validateWebhookUrl = require("../src/utils/validateWebhookUrl");
const { ALLOWED_STATUS_TRANSITIONS } = require("../src/services/shipmentService");
const authorizeRoles = require("../src/middleware/authorizeRoles");
const authService = require("../src/services/authService");
const webhookDelivery = require("../src/services/webhookDelivery");
const { paginatedData } = require("../src/utils/apiResponse");

test("models validate required formats, defaults, and references", async () => {
  assert.deepEqual(User.schema.path("role").enumValues, ["admin", "customer"]);
  assert.equal(new User({ name: "Customer", email: "customer@example.com", passwordHash: "hash" }).role, "customer");
  assert.equal(User.schema.path("passwordHash").options.select, false);
  assert.ok(Webhook.schema.path("ownerId"));
  assert.equal(Webhook.schema.path("secret").options.select, false);
  assert.equal(Shipment.schema.path("customerId").options.ref, "User");
  assert.equal(RefreshSession.schema.path("tokenHash").options.select, false);

  const shipment = new Shipment({
    trackingNumber: "TRK-12345",
    customer: "Test",
    origin: "A",
    destination: "B",
    amount: 0,
  });
  await shipment.validate();
  assert.equal(shipment.statusHistory[0].status, "created");
  assert.ok(shipment.statusHistory[0].timestamp instanceof Date);
  await assert.rejects(new Shipment({
    trackingNumber: "TRK-12346",
    customer: "Test",
    origin: "A",
    destination: "B",
    amount: -1,
  }).validate(), mongoose.Error.ValidationError);
  const wildcardWebhook = new Webhook({
    ownerId: new mongoose.Types.ObjectId(),
    name: "All events",
    url: "https://hooks.example.test",
    events: ["*"],
  });
  await wildcardWebhook.validate();
  assert.equal(wildcardWebhook.isActive, true);
  assert.equal(wildcardWebhook.toJSON().active, true);

  const objectId = new mongoose.Types.ObjectId();
  await new Event({
    eventId: "evt_123456",
    type: "shipment.created",
    shipmentId: objectId,
    payload: { event: "shipment.created" },
  }).validate();
  assert.equal(DeliveryAttempt.schema.path("eventId").options.ref, "Event");
  assert.equal(Delivery.schema.path("status").defaultValue, "pending");
  assert.equal(DeliveryAttempt.schema.path("deliveryId").options.ref, "Delivery");
  assert.ok(DeliveryAttempt.schema.indexes().some(([keys]) => keys.webhookId === 1 && keys.eventId === 1));
});

test("paginated responses expose both legacy and modern field names", () => {
  const items = [{ id: "one" }];
  assert.deepEqual(paginatedData(items, 2, 10, 11, "shipments"), {
    items,
    shipments: items,
    pagination: { page: 2, limit: 10, total: 11, totalItems: 11, totalPages: 2 },
  });
});

test("webhook signatures keep the legacy timestamped format and event envelope", () => {
  const event = {
    eventId: "evt_123456",
    type: "shipment.created",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    payload: { trackingNumber: "TRK-12345" },
  };
  const deliveryBody = webhookDelivery.buildDeliveryBody(event);
  assert.deepEqual(deliveryBody, {
    id: event.eventId,
    type: event.type,
    createdAt: event.createdAt,
    data: event.payload,
  });

  const timestamp = "1735689600";
  const signature = webhookDelivery.signBody(JSON.stringify(deliveryBody), timestamp, "test-secret");
  assert.match(signature, /^sha256=[a-f\d]{64}$/);
  assert.equal(
    signature,
    `sha256=${require("node:crypto").createHmac("sha256", "test-secret")
      .update(`${timestamp}.${JSON.stringify(deliveryBody)}`)
      .digest("hex")}`
  );
});

test("access tokens are short-lived and bound to a revocable session", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-secret-with-at-least-32-characters";
  try {
    const userId = new mongoose.Types.ObjectId();
    const sessionId = new mongoose.Types.ObjectId();
    const token = authService.createAccessToken({ _id: userId }, sessionId);
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: authService.JWT_ISSUER,
      audience: authService.JWT_AUDIENCE,
    });
    assert.equal(payload.sub, userId.toString());
    assert.equal(payload.sid, sessionId.toString());
    assert.ok(payload.exp - payload.iat <= 15 * 60);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("role middleware allows admins and rejects customers from admin operations", () => {
  let adminError;
  authorizeRoles("admin")({ user: { role: "admin" } }, {}, (error) => { adminError = error; });
  assert.equal(adminError, undefined);

  let customerError;
  authorizeRoles("admin")({ user: { role: "customer" } }, {}, (error) => { customerError = error; });
  assert.equal(customerError.statusCode, 403);
});

test("refresh cookies are HttpOnly, scoped, and secure in production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSameSite = process.env.REFRESH_COOKIE_SAME_SITE;
  try {
    process.env.NODE_ENV = "production";
    process.env.REFRESH_COOKIE_SAME_SITE = "strict";
    let cookie;
    authService.setRefreshCookie({
      cookie(name, value, options) {
        cookie = { name, value, options };
      },
    }, "test-refresh-token");
    const options = cookie.options;
    assert.equal(cookie.name, "__Secure-refreshToken");
    assert.equal(cookie.value, "test-refresh-token");
    assert.equal(options.httpOnly, true);
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, "strict");
    assert.equal(options.path, "/api/auth");
    assert.equal(authService.getRefreshCookieName(), "__Secure-refreshToken");

    process.env.NODE_ENV = "development";
    process.env.REFRESH_COOKIE_SAME_SITE = "none";
    assert.throws(() => authService.setRefreshCookie({ cookie() {} }, "test-token"), { statusCode: 500 });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousSameSite === undefined) delete process.env.REFRESH_COOKIE_SAME_SITE;
    else process.env.REFRESH_COOKIE_SAME_SITE = previousSameSite;
  }
});

test("shipment transition map matches the allowed workflow", () => {
  assert.deepEqual(ALLOWED_STATUS_TRANSITIONS, {
    created: ["picked_up", "cancelled"],
    picked_up: ["in_transit", "cancelled"],
    in_transit: ["arrived_at_hub", "cancelled"],
    arrived_at_hub: ["in_transit", "out_for_delivery", "cancelled"],
    out_for_delivery: ["delivered", "delivery_failed"],
    delivery_failed: ["out_for_delivery", "cancelled"],
    delivered: [],
    cancelled: [],
  });
});

test("webhook URL policy gates localhost and blocks production loopback", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLocalFlag = process.env.ALLOW_LOCALHOST_WEBHOOKS;

  try {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_LOCALHOST_WEBHOOKS = "false";
    await assert.rejects(validateWebhookUrl("http://localhost:3000"), { statusCode: 400 });
    process.env.ALLOW_LOCALHOST_WEBHOOKS = "true";
    assert.equal(await validateWebhookUrl("http://localhost:3000/receiver"), "http://localhost:3000/receiver");

    process.env.NODE_ENV = "production";
    await assert.rejects(validateWebhookUrl("http://127.0.0.1:3000"), { statusCode: 400 });
    await assert.rejects(validateWebhookUrl("http://8.8.8.8"), { statusCode: 400 });
    assert.equal(await validateWebhookUrl("https://8.8.8.8"), "https://8.8.8.8/");
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalLocalFlag === undefined) delete process.env.ALLOW_LOCALHOST_WEBHOOKS;
    else process.env.ALLOW_LOCALHOST_WEBHOOKS = originalLocalFlag;
  }
});

test("public and protected routes use the standard response envelope", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const healthResponse = await fetch(`${baseUrl}/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.success, true);
  assert.ok(healthResponse.headers.has("x-content-type-options"));
  const legacyHealthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(legacyHealthResponse.status, 200);

  const protectedResponse = await fetch(`${baseUrl}/api/shipments`);
  const protectedBody = await protectedResponse.json();
  assert.equal(protectedResponse.status, 401);
  assert.equal(protectedBody.success, false);
  assert.equal(protectedBody.data, null);

  const missingMeResponse = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(missingMeResponse.status, 401);

  const weakRegistrationResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test", email: "weak@example.com", password: "short-pass", role: "admin" }),
  });
  assert.equal(weakRegistrationResponse.status, 400);
  const weakRegistration = await weakRegistrationResponse.json();
  assert.ok(Array.isArray(weakRegistration.errors));
  assert.ok(weakRegistration.errors.some(({ field }) => field === "password"));

  const emptyRefreshResponse = await fetch(`${baseUrl}/api/auth/refresh`, { method: "POST" });
  assert.equal(emptyRefreshResponse.status, 401);

  const trackingResponse = await fetch(`${baseUrl}/api/tracking/invalid`);
  assert.equal(trackingResponse.status, 400);

  const failureResponse = await fetch(`${baseUrl}/api/demo-receiver/fail`, { method: "POST" });
  const failureBody = await failureResponse.json();
  assert.equal(failureResponse.status, 500);
  assert.equal(failureBody.success, false);
  assert.equal(failureBody.data, null);
});