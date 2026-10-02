const mongoose = require("mongoose");

const deliveryAttemptSchema = new mongoose.Schema(
  {
    deliveryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Delivery",
    },
    webhookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Webhook",
      required: true,
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    attemptNumber: {
      type: Number,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: ["success", "failed"],
      required: true,
    },
    httpStatus: {
      type: Number,
    },
    response: {
      type: String,
      maxlength: 1000,
    },
    errorMessage: {
      type: String,
      maxlength: 1000,
    },
    duration: {
      type: Number,
      min: 0,
    },
    attemptedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

deliveryAttemptSchema.index({ deliveryId: 1, attemptNumber: 1 });
deliveryAttemptSchema.index({ webhookId: 1, eventId: 1 });
deliveryAttemptSchema.virtual("statusCode").get(function getStatusCode() {
  return this.httpStatus ?? null;
});
deliveryAttemptSchema.virtual("responseBody").get(function getResponseBody() {
  return this.response ?? null;
});
deliveryAttemptSchema.virtual("durationMs").get(function getDurationMs() {
  return this.duration ?? null;
});
deliveryAttemptSchema.set("toJSON", {
  virtuals: true,
  transform(_document, result) {
    result.id = String(result._id);
    delete result.__v;
    return result;
  },
});

module.exports = mongoose.model("DeliveryAttempt", deliveryAttemptSchema);