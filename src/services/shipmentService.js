const { randomInt } = require("crypto");
const Shipment = require("../models/Shipment");
const User = require("../models/User");
const AppError = require("../utils/AppError");

const SHIPMENT_STATUSES = [
  "created",
  "picked_up",
  "in_transit",
  "arrived_at_hub",
  "out_for_delivery",
  "delivered",
  "delivery_failed",
  "cancelled",
];

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  created: ["picked_up", "cancelled"],
  picked_up: ["in_transit", "cancelled"],
  in_transit: ["arrived_at_hub", "cancelled"],
  arrived_at_hub: ["in_transit", "out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "delivery_failed"],
  delivery_failed: ["out_for_delivery", "cancelled"],
  delivered: [],
  cancelled: [],
});

function generateTrackingNumber() {
  return `TRK-${randomInt(10000, 100000)}`;
}

async function createShipment(shipmentData) {
  if (shipmentData.customerId) {
    const customer = await User.findById(shipmentData.customerId);
    if (!customer || customer.role !== "customer") {
      throw new AppError("Shipment customer must be an existing customer account", 400);
    }
  }

  return Shipment.create({
    ...shipmentData,
    trackingNumber: generateTrackingNumber(),
  });
}

async function changeShipmentStatus(id, nextStatus, note) {
  const shipment = await Shipment.findById(id);
  if (!shipment) {
    throw new AppError("Shipment not found", 404);
  }

  if (!ALLOWED_STATUS_TRANSITIONS[shipment.status].includes(nextStatus)) {
    throw new AppError(`Cannot change shipment from ${shipment.status} to ${nextStatus}`, 400);
  }

  const timestamp = new Date();
  shipment.status = nextStatus;
  shipment.statusHistory.push({ status: nextStatus, timestamp, note });
  await shipment.save();
  return shipment;
}

module.exports = {
  ALLOWED_STATUS_TRANSITIONS,
  SHIPMENT_STATUSES,
  changeShipmentStatus,
  createShipment,
};