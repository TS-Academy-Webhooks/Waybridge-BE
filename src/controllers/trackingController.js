const Shipment = require("../models/Shipment");
const AppError = require("../utils/AppError");
const { sendSuccess } = require("../utils/apiResponse");

exports.trackShipment = async (req, res) => {
  const shipment = await Shipment.findOne({ trackingNumber: req.params.trackingNumber });
  if (!shipment) {
    throw new AppError("Shipment not found", 404);
  }

  return sendSuccess(res, "Shipment tracking retrieved successfully", {
    trackingNumber: shipment.trackingNumber,
    status: shipment.status,
    origin: shipment.origin,
    destination: shipment.destination,
    timeline: shipment.statusHistory.map(({ status, timestamp, note }) => ({
      status,
      at: timestamp,
      timestamp,
      note,
    })),
    lastUpdated: shipment.updatedAt,
  });
};