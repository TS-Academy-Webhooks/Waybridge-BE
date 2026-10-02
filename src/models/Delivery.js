const mongoose = require("mongoose");

const deliverySchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    webhookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Webhook",
      required: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
      required: true,
    },
    attemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
      min: 1,
    },
    lastAttemptAt: Date,
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

deliverySchema.index({ ownerId: 1, status: 1, createdAt: -1 });
deliverySchema.index({ webhookId: 1, eventId: 1 });
deliverySchema.virtual("event").get(function getEvent() {
  return this.eventId;
});
deliverySchema.virtual("webhook").get(function getWebhook() {
  return this.webhookId;
});
deliverySchema.virtual("user").get(function getUser() {
  return this.ownerId;
});
deliverySchema.set("toJSON", {
  virtuals: true,
  transform(_document, result) {
    result.id = String(result._id);
    delete result.__v;
    return result;
  },
});

module.exports = mongoose.model("Delivery", deliverySchema);
