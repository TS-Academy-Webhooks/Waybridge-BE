const mongoose = require("mongoose");
const User = require("../models/User");
const Shipment = require("../models/Shipment");
const Event = require("../models/event");
const Webhook = require("../models/webhook");
const Delivery = require("../models/Delivery");
const DeliveryAttempt = require("../models/DeliveryAttempt");

async function migrateLegacyUsers() {
  const users = await User.collection.find({
    $or: [
      { role: { $nin: ["admin", "customer"] } },
      { passwordHash: { $exists: false }, password: { $exists: true } },
    ],
  }).toArray();

  for (const user of users) {
    const set = {
      role: user.role === "admin" ? "admin" : "customer",
    };
    const unset = {};
    if (!user.passwordHash && user.password) {
      set.passwordHash = user.password;
      unset.password = "";
    }
    await User.collection.updateOne(
      { _id: user._id },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }
    );
  }
  return users.length;
}

async function migrateLegacyShipments() {
  const shipments = await Shipment.collection.find({
    $or: [
      { statusHistory: { $exists: false } },
      { timeline: { $exists: true } },
      { customerId: { $exists: false }, createdBy: { $exists: true } },
    ],
  }).toArray();

  for (const shipment of shipments) {
    const set = {};
    const unset = {};
    if (!shipment.statusHistory) {
      set.statusHistory = (shipment.timeline || [{
        status: shipment.status || "created",
        at: shipment.updatedAt || shipment.createdAt || new Date(),
      }]).map(({ status, at, timestamp, note }) => ({
        status,
        timestamp: timestamp || at || shipment.createdAt || new Date(),
        ...(note ? { note } : {}),
      }));
    }
    if (!shipment.customerId && shipment.createdBy) {
      const creator = await User.findById(shipment.createdBy).select("role");
      if (creator?.role === "customer") set.customerId = creator._id;
    }
    if (shipment.timeline !== undefined) unset.timeline = "";
    if (Object.keys(set).length || Object.keys(unset).length) {
      await Shipment.collection.updateOne(
        { _id: shipment._id },
        { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }
      );
    }
  }
  return shipments.length;
}

async function migrateLegacyEvents() {
  const events = await Event.collection.find({
    shipment: { $exists: true },
  }).toArray();
  for (const event of events) {
    const set = {};
    const unset = {};
    if (!event.shipmentId && event.shipment) set.shipmentId = event.shipment;
    if (event.shipment !== undefined) unset.shipment = "";
    await Event.collection.updateOne(
      { _id: event._id },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }
    );
  }
  return events.length;
}

async function migrateLegacyWebhooks(adminId) {
  const webhooks = await Webhook.collection.find({
    $or: [{ ownerId: { $exists: false } }, { isActive: { $exists: false } }, { user: { $exists: true } }, { active: { $exists: true } }],
  }).toArray();

  for (const webhook of webhooks) {
    let ownerId = webhook.ownerId || webhook.user;
    if (ownerId && !(await User.exists({ _id: ownerId }))) ownerId = null;
    const set = {
      ownerId: ownerId || adminId,
      isActive: webhook.isActive ?? webhook.active ?? true,
    };
    const unset = {};
    if (webhook.user !== undefined) unset.user = "";
    if (webhook.active !== undefined) unset.active = "";
    await Webhook.collection.updateOne(
      { _id: webhook._id },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }
    );
  }
  return webhooks.length;
}

async function migrateLegacyDeliveries(adminId) {
  const rawDeliveries = await Delivery.collection.find({
    $or: [
      { eventId: { $exists: false } },
      { webhookId: { $exists: false } },
      { ownerId: { $exists: false } },
      { event: { $exists: true } },
      { webhook: { $exists: true } },
      { user: { $exists: true } },
    ],
  }).toArray();

  for (const delivery of rawDeliveries) {
    const eventId = delivery.eventId || delivery.event;
    const webhookId = delivery.webhookId || delivery.webhook;
    if (!eventId || !webhookId) {
      throw new Error(`Cannot migrate delivery ${delivery._id}: event or webhook reference is missing.`);
    }
    const webhook = await Webhook.collection.findOne({ _id: webhookId });
    const set = {
      eventId,
      webhookId,
      ownerId: delivery.ownerId || delivery.user || webhook?.ownerId || adminId,
      status: delivery.status || "pending",
      attemptCount: delivery.attemptCount || 0,
      maxAttempts: delivery.maxAttempts || 3,
    };
    const unset = {};
    for (const oldField of ["event", "webhook", "user"]) {
      if (delivery[oldField] !== undefined) unset[oldField] = "";
    }
    await Delivery.collection.updateOne(
      { _id: delivery._id },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }
    );
  }

  const oldAttempts = await DeliveryAttempt.collection.find({
    delivery: { $exists: true },
  }).toArray();
  for (const attempt of oldAttempts) {
    const deliveryId = attempt.deliveryId || attempt.delivery;
    const delivery = await Delivery.collection.findOne({ _id: deliveryId });
    if (!delivery) continue;
    const set = {
      deliveryId,
      webhookId: attempt.webhookId || delivery.webhookId,
      eventId: attempt.eventId || delivery.eventId,
      httpStatus: attempt.httpStatus ?? attempt.statusCode ?? null,
      response: attempt.response ?? attempt.responseBody ?? null,
      duration: attempt.duration ?? attempt.durationMs ?? null,
    };
    const unset = {};
    for (const oldField of ["delivery", "statusCode", "responseBody", "durationMs"]) {
      if (attempt[oldField] !== undefined) unset[oldField] = "";
    }
    await DeliveryAttempt.collection.updateOne(
      { _id: attempt._id },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }
    );
  }

  const standaloneAttempts = await DeliveryAttempt.collection.find({
    deliveryId: { $exists: false },
    delivery: { $exists: false },
    webhookId: { $exists: true },
    eventId: { $exists: true },
  }).sort({ attemptedAt: 1 }).toArray();
  for (const attempt of standaloneAttempts) {
    const webhook = await Webhook.findById(attempt.webhookId);
    const delivery = await Delivery.findOneAndUpdate(
      { webhookId: attempt.webhookId, eventId: attempt.eventId },
      {
        $setOnInsert: {
          webhookId: attempt.webhookId,
          eventId: attempt.eventId,
          ownerId: webhook?.ownerId || adminId,
          maxAttempts: 3,
        },
        $max: {
          attemptCount: attempt.attemptNumber || 1,
          lastAttemptAt: attempt.attemptedAt || attempt.createdAt || new Date(),
        },
        $set: { status: attempt.status },
      },
      { upsert: true, returnDocument: "after" }
    );
    await DeliveryAttempt.collection.updateOne(
      { _id: attempt._id },
      { $set: { deliveryId: delivery._id } }
    );
  }

  return rawDeliveries.length + oldAttempts.length + standaloneAttempts.length;
}

async function migrateLegacyData(adminId) {
  if (!mongoose.isValidObjectId(adminId)) {
    throw new Error("Cannot migrate legacy data without a valid bootstrap admin ID.");
  }
  const users = await migrateLegacyUsers();
  const shipments = await migrateLegacyShipments();
  const events = await migrateLegacyEvents();
  const webhooks = await migrateLegacyWebhooks(adminId);
  const deliveries = await migrateLegacyDeliveries(adminId);
  return { users, shipments, events, webhooks, deliveries };
}

module.exports = migrateLegacyData;
