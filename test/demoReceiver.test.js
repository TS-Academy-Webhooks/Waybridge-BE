const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const mongoose = require("mongoose");
const User = require("../src/models/User");
const RefreshSession = require("../src/models/RefreshSession");
const Webhook = require("../src/models/webhook");
const app = require("../src/app");
const authService = require("../src/services/authService");
const {
  clearReceivedRequests,
  listReceivedRequests,
  MAX_CAPTURED_BODY_LENGTH,
  MAX_RECEIVED_REQUESTS,
  recordReceivedRequest,
  resetResponseProfiles,
  verifySignature,
} = require("../src/services/demoReceiver");

test("demo receiver verifies timestamped, legacy, missing, and invalid signatures", async () => {
  const originalFind = Webhook.find;
  const secret = "demo-receiver-test-secret";
  const rawBody = JSON.stringify({ type: "shipment.created" });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sign = (input) => crypto.createHmac("sha256", secret).update(input).digest("hex");
  Webhook.find = () => ({ select: async () => [{ secret }] });

  try {
    assert.deepEqual(
      await verifySignature(rawBody, `sha256=${sign(`${timestamp}.${rawBody}`)}`, timestamp),
      { valid: true, status: "valid", scheme: "timestamped", timestampFresh: true }
    );
    assert.deepEqual(
      await verifySignature(rawBody, sign(rawBody), undefined),
      { valid: true, status: "valid", scheme: "legacy", timestampFresh: null }
    );
    assert.deepEqual(
      await verifySignature(rawBody, sign(`${timestamp}.${rawBody}`), "1"),
      { valid: false, status: "invalid", scheme: "unknown", timestampFresh: false }
    );
    assert.deepEqual(
      await verifySignature(rawBody, "malformed", timestamp),
      { valid: false, status: "invalid", scheme: "unknown", timestampFresh: true }
    );
    assert.deepEqual(
      await verifySignature(rawBody, undefined, undefined),
      { valid: null, status: "missing", scheme: null, timestampFresh: null }
    );
    Webhook.find = () => ({
      select: async () => {
        throw new Error("database unavailable");
      },
    });
    await assert.rejects(
      verifySignature(rawBody, sign(rawBody), undefined),
      /database unavailable/
    );
  } finally {
    Webhook.find = originalFind;
  }
});

test("demo receiver bounds and redacts its in-memory request history", () => {
  clearReceivedRequests();
  const verification = {
    valid: null,
    status: "missing",
    scheme: null,
    timestampFresh: null,
  };
  const oversizedRawBody = "x".repeat(MAX_CAPTURED_BODY_LENGTH + 1);
  const oversized = recordReceivedRequest({
    headers: { authorization: "Bearer secret", "x-webhook-signature": "signature" },
    body: { type: "shipment.created" },
    rawBody: oversizedRawBody,
    verification,
  });
  assert.equal(oversized.bodyTruncated, true);
  assert.equal(oversized.rawBody.length, MAX_CAPTURED_BODY_LENGTH);
  assert.equal(oversized.headers.authorization, "[REDACTED]");
  assert.equal(oversized.headers["x-webhook-signature"], "[REDACTED]");

  for (let index = 0; index < MAX_RECEIVED_REQUESTS + 2; index += 1) {
    recordReceivedRequest({
      headers: {},
      body: { index },
      rawBody: JSON.stringify({ index }),
      verification,
    });
  }
  const history = listReceivedRequests({ page: 1, limit: MAX_RECEIVED_REQUESTS });
  assert.equal(history.total, MAX_RECEIVED_REQUESTS);
  assert.equal(history.items.length, MAX_RECEIVED_REQUESTS);
  assert.equal(history.items[0].body.index, MAX_RECEIVED_REQUESTS + 1);
  clearReceivedRequests();
});

test("demo receiver keeps ingress public and protects configurable management", async (t) => {
  clearReceivedRequests();
  resetResponseProfiles();

  const originalJwtSecret = process.env.JWT_SECRET;
  const originalFindById = User.findById;
  const originalSessionExists = RefreshSession.exists;
  process.env.JWT_SECRET = "demo-receiver-test-secret-with-32-characters";
  const adminId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const users = new Map([
    [adminId.toString(), { _id: adminId, role: "admin" }],
    [customerId.toString(), { _id: customerId, role: "customer" }],
  ]);
  User.findById = async (id) => users.get(String(id));
  RefreshSession.exists = async () => true;

  const adminToken = authService.createAccessToken({ _id: adminId }, new mongoose.Types.ObjectId());
  const customerToken = authService.createAccessToken({ _id: customerId }, new mongoose.Types.ObjectId());
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    clearReceivedRequests();
    resetResponseProfiles();
    User.findById = originalFindById;
    RefreshSession.exists = originalSessionExists;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    server.closeAllConnections();
    server.close();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/demo-receiver`;
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  const customerHeaders = { Authorization: `Bearer ${customerToken}` };

  const protectedConfig = await fetch(`${baseUrl}/config`);
  assert.equal(protectedConfig.status, 401);
  const customerConfig = await fetch(`${baseUrl}/config`, { headers: customerHeaders });
  assert.equal(customerConfig.status, 403);

  const updateConfig = await fetch(`${baseUrl}/config`, {
    method: "PATCH",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      success: { statusCode: 202, body: { accepted: true } },
      failure: { statusCode: 503, body: { retry: true } },
    }),
  });
  assert.equal(updateConfig.status, 200);

  const successResponse = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "shipment.created", data: { id: 1 } }),
  });
  assert.equal(successResponse.status, 202);
  assert.deepEqual(await successResponse.json(), { accepted: true });

  const invalidSignatureResponse = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Signature": "invalid",
    },
    body: JSON.stringify({ type: "shipment.created", data: { id: 2 } }),
  });
  assert.equal(invalidSignatureResponse.status, 202);

  const failureResponse = await fetch(`${baseUrl}/fail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "shipment.created", data: { id: 3 } }),
  });
  assert.equal(failureResponse.status, 503);
  assert.deepEqual(await failureResponse.json(), { retry: true });

  const unauthorizedHistory = await fetch(baseUrl);
  assert.equal(unauthorizedHistory.status, 401);
  const historyResponse = await fetch(
    `${baseUrl}?signatureValid=unknown&event=shipment.created&limit=1&page=2`,
    { headers: adminHeaders }
  );
  const history = await historyResponse.json();
  assert.equal(historyResponse.status, 200);
  assert.equal(history.data.pagination.total, 2);
  assert.equal(history.data.pagination.page, 2);
  assert.equal(history.data.requests.length, 1);
  const invalidHistoryResponse = await fetch(
    `${baseUrl}?signatureValid=false&event=shipment.created`,
    { headers: adminHeaders }
  );
  const invalidHistory = await invalidHistoryResponse.json();
  assert.equal(invalidHistory.data.requests[0].signature.status, "invalid");
  assert.equal(invalidHistory.data.requests[0].headers["x-webhook-signature"], "[REDACTED]");

  const invalidFilter = await fetch(`${baseUrl}?limit=51`, { headers: adminHeaders });
  assert.equal(invalidFilter.status, 400);
  const invalidConfig = await fetch(`${baseUrl}/config`, {
    method: "PATCH",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ success: { statusCode: 500 } }),
  });
  assert.equal(invalidConfig.status, 400);
  const nullProfile = await fetch(`${baseUrl}/config`, {
    method: "PATCH",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ success: null }),
  });
  assert.equal(nullProfile.status, 400);

  const clearResponse = await fetch(baseUrl, { method: "DELETE", headers: adminHeaders });
  const cleared = await clearResponse.json();
  assert.equal(cleared.data.clearedCount, 3);

  const resetConfig = await fetch(`${baseUrl}/config`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(resetConfig.status, 200);
  const defaultFailure = await fetch(`${baseUrl}/fail`, { method: "POST" });
  assert.equal(defaultFailure.status, 500);
});
