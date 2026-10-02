const mongoose = require("mongoose");

const eventTypes = [
  "webhook.test",
  "shipment.created",
  "shipment.picked_up",
  "shipment.in_transit",
  "shipment.arrived_at_hub",
  "shipment.out_for_delivery",
  "shipment.delivered",
  "shipment.delivery_failed",
  "shipment.cancelled",
];

const eventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      match: /^evt_[a-zA-Z0-9]{6}$/,
    },
    type: {
      type: String,
      required: true,
      enum: eventTypes,
    },
    shipmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shipment",
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { timestamps: true }
);

eventSchema.virtual("id").get(function getId() {
  return String(this._id);
});
eventSchema.virtual("shipment").get(function getShipment() {
  return this.shipmentId;
});
eventSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Event", eventSchema);