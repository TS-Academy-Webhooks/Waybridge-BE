const Delivery = require("../models/Delivery");
const DeliveryAttempt = require("../models/DeliveryAttempt");
const Event = require("../models/event");
const Webhook = require("../models/webhook");
const AppError = require("../utils/AppError");
const { paginatedData, sendSuccess } = require("../utils/apiResponse");
const { processDelivery } = require("../services/webhookDelivery");

function ownerFilter(req) {
  return req.user.role === "admin" ? {} : { ownerId: req.user._id };
}

async function getAttempts(deliveryId) {
  return DeliveryAttempt.find({ deliveryId })
    .sort({ attemptNumber: 1 })
    .populate("webhookId", "name url")
    .populate("eventId", "eventId type");
}

exports.getDelivery = async (req, res) => {
  let delivery = await Delivery.findOne({
    _id: req.params.id,
    ...ownerFilter(req),
  })
    .populate("webhookId", "name url")
    .populate("eventId", "eventId type payload createdAt");

  if (!delivery) {
    const attempt = await DeliveryAttempt.findById(req.params.id)
      .populate("webhookId", "name url")
      .populate("eventId", "eventId type payload createdAt");
    if (!attempt) throw new AppError("Delivery not found", 404);
    delivery = attempt.deliveryId
      ? await Delivery.findOne({
        _id: attempt.deliveryId,
        ...ownerFilter(req),
      })
        .populate("webhookId", "name url")
        .populate("eventId", "eventId type payload createdAt")
      : null;
    if (!delivery) {
      const webhookOwner = await Webhook.findOne({
        _id: attempt.webhookId?._id || attempt.webhookId,
        ...ownerFilter(req),
      });
      if (!webhookOwner) throw new AppError("Delivery not found", 404);
      return sendSuccess(res, "Delivery attempt retrieved successfully", {
        ...attempt.toObject(),
        delivery: null,
        attempts: [attempt],
      });
    }
  }

  const data = delivery.toObject();
  data.attempts = await getAttempts(delivery._id);
  return sendSuccess(res, "Delivery retrieved successfully", data);
};

exports.resendDelivery = async (req, res) => {
  let delivery = await Delivery.findOne({
    _id: req.params.id,
    ...ownerFilter(req),
  });
  let sourceAttempt;
  if (!delivery) {
    sourceAttempt = await DeliveryAttempt.findById(req.params.id);
    if (!sourceAttempt) throw new AppError("Delivery not found", 404);

    delivery = sourceAttempt.deliveryId
      ? await Delivery.findOne({
        _id: sourceAttempt.deliveryId,
        ...ownerFilter(req),
      })
      : null;

    if (!delivery) {
      const [webhook, event] = await Promise.all([
        Webhook.findOne({
          _id: sourceAttempt.webhookId,
          ...ownerFilter(req),
        }),
        Event.findById(sourceAttempt.eventId),
      ]);
      if (!webhook) throw new AppError("Webhook no longer exists", 404);
      if (!event) throw new AppError("Event not found", 404);
      const priorAttempts = await DeliveryAttempt.countDocuments({
        webhookId: webhook._id,
        eventId: event._id,
      });
      delivery = await Delivery.create({
        webhookId: webhook._id,
        eventId: event._id,
        ownerId: webhook.ownerId,
        attemptCount: priorAttempts,
        maxAttempts: priorAttempts + 1,
        status: "failed",
      });
    }
  }

  if (!delivery) throw new AppError("Delivery not found", 404);
  if (delivery.status === "pending") {
    throw new AppError("Delivery is already in progress", 409);
  }
  if (delivery.status === "success") {
    delivery = await Delivery.create({
      webhookId: delivery.webhookId,
      eventId: delivery.eventId,
      ownerId: delivery.ownerId,
    });
  } else {
    delivery.maxAttempts = delivery.attemptCount + 1;
    delivery.status = "pending";
    await delivery.save();
  }

  void processDelivery(delivery._id).catch((error) => {
    console.error(`Resend of delivery ${delivery._id} crashed:`, error.message);
  });

  return sendSuccess(res, "Delivery queued for resend", delivery, 202);
};

exports.getDeliveries = async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 10);
  const filter = ownerFilter(req);
  if (req.query.status) filter.status = req.query.status;
  if (req.query.webhookId) filter.webhookId = req.query.webhookId;
  if (req.query.eventId) filter.eventId = req.query.eventId;

  const [deliveries, total] = await Promise.all([
    Delivery.find(filter)
      .populate("webhookId", "name url")
      .populate("eventId", "eventId type")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Delivery.countDocuments(filter),
  ]);
  const items = deliveries.map((delivery) => delivery.toObject());
  return sendSuccess(
    res,
    "Deliveries retrieved successfully",
    paginatedData(items, page, limit, total, "deliveries")
  );
};
