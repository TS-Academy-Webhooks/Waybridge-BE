const mongoose = require("mongoose");

const shipmentStatuses = [
  "created",
  "picked_up",
  "in_transit",
  "arrived_at_hub",
  "out_for_delivery",
  "delivered",
  "delivery_failed",
  "cancelled",
];

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: shipmentStatuses,
      required: true,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    note: {
      type: String,
      maxlength: 500,
    },
  },
  { _id: false }
);

const shipmentSchema = new mongoose.Schema(
  {
    trackingNumber: {
      type: String,
      required: true,
      unique: true,
      match: /^TRK-\d{5}$/,
    },
    customer: {
      type: String,
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    origin: {
      type: String,
      required: true,
    },
    destination: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: shipmentStatuses,
      default: "created",
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: () => [{ status: "created" }],
    },
  },
  { timestamps: true }
);

shipmentSchema.virtual("id").get(function getId() {
  return String(this._id);
});
shipmentSchema.virtual("timeline").get(function getTimeline() {
  const statusHistory = Array.isArray(this.statusHistory) ? this.statusHistory : [];
  return statusHistory.map(({ status, timestamp, note }) => ({
    status,
    at: timestamp,
    timestamp,
    note,
  }));
});
shipmentSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Shipment", shipmentSchema);