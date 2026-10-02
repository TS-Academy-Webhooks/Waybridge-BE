const { randomInt } = require("crypto");
const Event = require("../models/event");
const deliverEvent = require("./webhookDelivery");

async function createShipmentEvent(shipment, note) {
  const type = `shipment.${shipment.status}`;
  const timestamp = new Date();
  const eventId = `evt_${randomInt(100000, 1000000)}`;
  const payload = {
    event: type,
    eventId,
    shipmentId: shipment.trackingNumber,
    status: shipment.status,
    ...(note ? { note } : {}),
    timestamp: timestamp.toISOString(),
  };

  const event = await Event.create({
    eventId,
    type,
    shipmentId: shipment._id,
    payload,
  });

  // Delivery runs separately so a slow receiver cannot delay the shipment response.
  void deliverEvent(event._id).catch((error) => {
    console.error("Background webhook delivery failed:", error.message);
  });

  return event;
}

module.exports = { createShipmentEvent };