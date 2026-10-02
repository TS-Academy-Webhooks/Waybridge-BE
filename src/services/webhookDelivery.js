const crypto = require("crypto");
const Event = require("../models/event");
const Webhook = require("../models/webhook");
const Delivery = require("../models/Delivery");
const DeliveryAttempt = require("../models/DeliveryAttempt");
const validateWebhookUrl = require("../utils/validateWebhookUrl");

const REQUEST_TIMEOUT_MS = 5000;
const RETRY_DELAYS_MS = [2000, 5000];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function buildDeliveryBody(event) {
  return {
    id: event.eventId,
    type: event.type,
    createdAt: event.createdAt,
    data: event.payload,
  };
}

function signBody(rawBody, timestamp, secret) {
  return `sha256=${crypto.createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
}

async function deliverWebhookOnce(delivery, webhook, event, attemptNumber) {
  const startedAt = Date.now();
  const attemptedAt = new Date(startedAt);
  const body = JSON.stringify(buildDeliveryBody(event));
  const timestamp = Math.floor(startedAt / 1000).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let httpStatus;
  let responseText = "";
  let errorMessage = "";

  try {
    const url = await validateWebhookUrl(webhook.url);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "LogisticsWebhookPlatform/1.0",
        "X-Webhook-Event": event.type,
        "X-Webhook-Delivery": String(delivery._id),
        "X-Webhook-Timestamp": timestamp,
        "X-Webhook-Signature": signBody(body, timestamp, webhook.secret),
      },
      body,
      signal: controller.signal,
    });

    httpStatus = response.status;
    responseText = (await response.text()).slice(0, 1000);
    if (!response.ok) errorMessage = `Receiver responded with status ${response.status}`;
  } catch (error) {
    errorMessage = (error.name === "AbortError" ? "Request timed out" : error.message).slice(0, 1000);
  } finally {
    clearTimeout(timeout);
  }

  const attempt = await DeliveryAttempt.create({
    deliveryId: delivery._id,
    webhookId: webhook._id,
    eventId: event._id,
    attemptNumber,
    status: httpStatus >= 200 && httpStatus < 300 ? "success" : "failed",
    httpStatus,
    response: responseText,
    errorMessage,
    duration: Date.now() - startedAt,
    attemptedAt,
  });
  return attempt;
}

async function processDelivery(deliveryId) {
  const delivery = await Delivery.findById(deliveryId);
  if (!delivery || delivery.status === "success") return delivery;

  const [webhook, event] = await Promise.all([
    Webhook.findById(delivery.webhookId).select("+secret"),
    Event.findById(delivery.eventId),
  ]);
  if (!webhook || !event) {
    delivery.status = "failed";
    await delivery.save();
    return delivery;
  }

  while (delivery.attemptCount < delivery.maxAttempts) {
    const attemptNumber = delivery.attemptCount + 1;
    const attempt = await deliverWebhookOnce(delivery, webhook, event, attemptNumber);
    delivery.attemptCount = attemptNumber;
    delivery.lastAttemptAt = attempt.attemptedAt;
    if (attempt.status === "success") {
      delivery.status = "success";
      await delivery.save();
      return delivery;
    }

    if (delivery.attemptCount < delivery.maxAttempts) {
      delivery.status = "pending";
      await delivery.save();
      await delay(RETRY_DELAYS_MS[delivery.attemptCount - 1] || RETRY_DELAYS_MS.at(-1));
    }
  }

  delivery.status = "failed";
  await delivery.save();
  return delivery;
}

async function deliverEvent(eventDocumentId) {
  const event = await Event.findById(eventDocumentId);
  if (!event) throw new Error(`Event ${eventDocumentId} was not found`);

  const webhooks = await Webhook.find({
    isActive: true,
    events: { $in: [event.type, "*"] },
  });
  for (const webhook of webhooks) {
    const delivery = await Delivery.create({
      webhookId: webhook._id,
      eventId: event._id,
      ownerId: webhook.ownerId,
    });
    void processDelivery(delivery._id).catch((error) => {
      console.error(`Webhook delivery ${delivery._id} crashed:`, error.message);
    });
  }
}

module.exports = deliverEvent;
module.exports.buildDeliveryBody = buildDeliveryBody;
module.exports.deliverWebhookOnce = deliverWebhookOnce;
module.exports.processDelivery = processDelivery;
module.exports.signBody = signBody;
module.exports.REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
module.exports.RETRY_DELAYS_MS = RETRY_DELAYS_MS;
