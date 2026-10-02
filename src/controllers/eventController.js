const mongoose = require("mongoose");
const Event = require("../models/event");
const AppError = require("../utils/AppError");
const { paginatedData, sendSuccess } = require("../utils/apiResponse");

exports.getEvents = async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const filter = {};
  if (req.query.type) {
    filter.type = req.query.type;
  }
  if (req.query.search) {
    const search = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.eventId = { $regex: search, $options: "i" };
  }
  const [events, totalItems] = await Promise.all([
    Event.find(filter)
      .populate("shipmentId", "trackingNumber status")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Event.countDocuments(filter),
  ]);

  return sendSuccess(
    res,
    "Events retrieved successfully",
    paginatedData(events, page, limit, totalItems, "events")
  );
};

exports.getEvent = async (req, res) => {
  const identifier = req.params.id;
  const event = mongoose.isValidObjectId(identifier)
    ? await Event.findById(identifier).populate("shipmentId", "trackingNumber status")
    : await Event.findOne({ eventId: identifier }).populate("shipmentId", "trackingNumber status");
  if (!event) {
    throw new AppError("Event not found", 404);
  }

  return sendSuccess(res, "Event retrieved successfully", event);
};