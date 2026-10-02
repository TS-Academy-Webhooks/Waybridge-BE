const crypto = require("crypto");
const Webhook = require("../models/webhook");
const { sendError, sendSuccess } = require("../utils/apiResponse");

const receivedRequests = [];

async function verifySignature(rawBody, signature, timestamp) {
  if (!signature) {
    return null;
  }

  const normalizedSignature = signature.replace(/^sha256=/, "");
  if (!/^[a-f\d]{64}$/i.test(normalizedSignature)) return false;
  const receivedBuffer = Buffer.from(normalizedSignature, "hex");
  const timestampSeconds = Number(timestamp);
  const timestampIsFresh = Number.isInteger(timestampSeconds) &&
    Math.abs(Date.now() / 1000 - timestampSeconds) <= 300;
  const webhooks = await Webhook.find({ isActive: true }).select("+secret");
  for (const webhook of webhooks) {
    const candidates = [
      timestampIsFresh
        ? crypto.createHmac("sha256", webhook.secret).update(`${timestamp}.${rawBody}`).digest()
        : null,
      crypto.createHmac("sha256", webhook.secret).update(rawBody).digest(),
    ];
    for (const expectedBuffer of candidates) {
      if (expectedBuffer && crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
        return true;
      }
    }
  }

  return false;
}

exports.receive = async (req, res) => {
  let signatureValid = null;
  try {
    signatureValid = await verifySignature(
      req.rawBody || "",
      req.get("X-Webhook-Signature"),
      req.get("X-Webhook-Timestamp")
    );
  } catch (error) {
    console.error("Demo receiver could not verify the signature:", error.message);
  }

  const received = {
    headers: req.headers,
    body: req.body,
    rawBody: req.rawBody || "",
    timestamp: new Date().toISOString(),
    signatureValid,
  };
  receivedRequests.unshift(received);
  receivedRequests.length = Math.min(receivedRequests.length, 100);

  return sendSuccess(res, "Webhook received", received, 201);
};

exports.listReceived = (req, res) => {
  return sendSuccess(res, "Received webhooks retrieved successfully", receivedRequests);
};

exports.fail = (req, res) => {
  return sendError(res, "Demo receiver forced a failure", 500);
};