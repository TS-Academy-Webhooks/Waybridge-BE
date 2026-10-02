const crypto = require("crypto");
const Webhook = require("../models/webhook");
const Event = require("../models/event");
const Delivery = require("../models/Delivery");
const DeliveryAttempt = require("../models/DeliveryAttempt");
const AppError = require("../utils/AppError");
const { paginatedData, sendSuccess } = require("../utils/apiResponse");
const validateWebhookUrl = require("../utils/validateWebhookUrl");
const { processDelivery } = require("../services/webhookDelivery");

function ownerFilter(req) {
  return req.user.role === "admin" ? {} : { ownerId: req.user._id };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serializeWebhook(webhook, revealSecret = false) {
  const result = webhook.toObject({ virtuals: false });
  result.id = String(result._id);
  result.user = result.ownerId;
  result.active = result.isActive;
  if (!revealSecret) {
    result.secret = result.secret
      ? `${result.secret.slice(0, 6)}****${result.secret.slice(-4)}`
      : null;
  }
  return result;
}

exports.createWebhook = async (req, res) => {
  const url = await validateWebhookUrl(req.body.url);
  const webhook = await Webhook.create({
    ownerId: req.user._id,
    name: req.body.name.trim(),
    url,
    events: req.body.events,
    isActive: req.body.isActive === undefined
      ? req.body.active === undefined ? true : req.body.active
      : req.body.isActive,
    secret: `whsec_${crypto.randomBytes(24).toString("hex")}`,
  });
  const fullWebhook = await Webhook.findOne({ _id: webhook._id, ...ownerFilter(req) }).select("+secret");

  return sendSuccess(
    res,
    "Webhook created successfully",
    serializeWebhook(fullWebhook, true),
    201
  );
};

exports.getWebhooks = async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 10);
  const filter = ownerFilter(req);
  if (req.query.search) {
    const search = escapeRegExp(String(req.query.search));
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { url: { $regex: search, $options: "i" } },
    ];
  }
  const active = req.query.isActive ?? req.query.active;
  if (active !== undefined) filter.isActive = active === true || active === "true";
  if (req.query.event) filter.events = { $in: [req.query.event, "*"] };

  const [webhooks, total] = await Promise.all([
    Webhook.find(filter)
      .select("+secret")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Webhook.countDocuments(filter),
  ]);
  const items = webhooks.map((webhook) => serializeWebhook(webhook));
  const data = paginatedData(items, page, limit, total, "webhooks");
  return sendSuccess(res, "Webhooks retrieved successfully", data);
};

exports.getWebhook = async (req, res) => {
  const webhook = await Webhook.findOne({
    _id: req.params.id,
    ...ownerFilter(req),
  }).select("+secret");
  if (!webhook) throw new AppError("Webhook not found", 404);

  return sendSuccess(
    res,
    "Webhook retrieved successfully",
    serializeWebhook(webhook)
  );
};

exports.updateWebhook = async (req, res) => {
  const webhook = await Webhook.findOne({
    _id: req.params.id,
    ...ownerFilter(req),
  }).select("+secret");
  if (!webhook) throw new AppError("Webhook not found", 404);

  const { name, events, url, regenerateSecret } = req.body;
  const isActive = req.body.isActive ?? req.body.active;
  const hasUpdates = name !== undefined || events !== undefined || url !== undefined ||
    isActive !== undefined || regenerateSecret !== undefined;
  if (!hasUpdates) {
    throw new AppError("Provide at least one supported field to update", 400);
  }

  if (name !== undefined) webhook.name = name.trim();
  if (events !== undefined) webhook.events = events;
  if (url !== undefined) webhook.url = await validateWebhookUrl(url);
  if (isActive !== undefined) webhook.isActive = isActive;
  if (regenerateSecret) {
    webhook.secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
  }
  await webhook.save();

  return sendSuccess(
    res,
    "Webhook updated successfully",
    serializeWebhook(webhook, Boolean(regenerateSecret))
  );
};

exports.deleteWebhook = async (req, res) => {
  const webhook = await Webhook.findOneAndDelete({
    _id: req.params.id,
    ...ownerFilter(req),
  });
  if (!webhook) throw new AppError("Webhook not found", 404);

  return sendSuccess(res, "Webhook deleted successfully");
};

exports.getWebhookDeliveries = async (req, res) => {
  const webhook = await Webhook.findOne({
    _id: req.params.id,
    ...ownerFilter(req),
  });
  if (!webhook) throw new AppError("Webhook not found", 404);

  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 10);
  const filter = { webhookId: webhook._id };
  if (req.query.status) filter.status = req.query.status;

  const [deliveries, total] = await Promise.all([
    Delivery.find(filter)
      .populate("eventId", "eventId type")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Delivery.countDocuments(filter),
  ]);
  const items = await Promise.all(deliveries.map(async (delivery) => {
    const value = delivery.toObject();
    value.id = String(value._id);
    value.attempts = await DeliveryAttempt.find({ deliveryId: delivery._id })
      .sort({ attemptNumber: 1 });
    return value;
  }));

  return sendSuccess(
    res,
    "Deliveries retrieved successfully",
    paginatedData(items, page, limit, total, "deliveries")
  );
};

exports.testWebhook = async (req, res) => {
  const webhook = await Webhook.findOne({
    _id: req.params.id,
    ...ownerFilter(req),
  });
  if (!webhook) throw new AppError("Webhook not found", 404);
  if (!webhook.isActive) throw new AppError("Webhook is inactive", 400);

  const event = await Event.create({
    eventId: `evt_${crypto.randomInt(100000, 1000000)}`,
    type: "webhook.test",
    payload: { message: "This is a test event from your Logistics Webhook Platform" },
  });
  const delivery = await Delivery.create({
    webhookId: webhook._id,
    eventId: event._id,
    ownerId: webhook.ownerId,
  });

  void processDelivery(delivery._id).catch((error) => {
    console.error(`Test delivery ${delivery._id} crashed:`, error.message);
  });

  const result = delivery.toObject();
  result.id = String(result._id);
  return sendSuccess(res, "Test event queued for delivery", result, 202);
};
