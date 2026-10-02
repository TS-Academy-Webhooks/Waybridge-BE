const Shipment = require("../models/Shipment");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const { paginatedData, sendSuccess } = require("../utils/apiResponse");
const {
  changeShipmentStatus,
  createShipment,
} = require("../services/shipmentService");
const { createShipmentEvent } = require("../services/eventService");

exports.createShipment = async (req, res) => {
  const shipmentData = {
    origin: req.body.origin,
    destination: req.body.destination,
    amount: req.body.amount,
  };
  if (req.user.role === "customer") {
    shipmentData.customer = req.user.name;
    shipmentData.customerId = req.user._id;
  } else {
    shipmentData.customer = req.body.customer;
    shipmentData.customerId = req.body.customerId;
  }

  const shipment = await createShipment(shipmentData);
  await createShipmentEvent(shipment, req.body.note);
  return sendSuccess(res, "Shipment created successfully", shipment, 201);
};

exports.getShipments = async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const filter = req.user.role === "admin" ? {} : { customerId: req.user._id };

  if (req.query.status) {
    filter.status = req.query.status;
  }
  if (req.query.search) {
    const search = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { trackingNumber: { $regex: search, $options: "i" } },
      { customer: { $regex: search, $options: "i" } },
      { origin: { $regex: search, $options: "i" } },
      { destination: { $regex: search, $options: "i" } },
    ];
  }

  const [shipments, totalItems] = await Promise.all([
    Shipment.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Shipment.countDocuments(filter),
  ]);

  return sendSuccess(
    res,
    "Shipments retrieved successfully",
    paginatedData(shipments, page, limit, totalItems, "shipments")
  );
};

exports.getShipment = async (req, res) => {
  const shipmentFilter = req.user.role === "admin"
    ? { _id: req.params.id }
    : { _id: req.params.id, customerId: req.user._id };
  const shipment = await Shipment.findOne(shipmentFilter);
  if (!shipment) {
    throw new AppError("Shipment not found", 404);
  }

  return sendSuccess(res, "Shipment retrieved successfully", shipment);
};

exports.assignShipmentCustomer = async (req, res) => {
  const customer = await User.findOne({ _id: req.body.customerId, role: "customer" });
  if (!customer) {
    throw new AppError("Customer account not found", 404);
  }

  const shipment = await Shipment.findByIdAndUpdate(
    req.params.id,
    { customerId: customer._id, customer: customer.name },
    { returnDocument: "after", runValidators: true }
  );
  if (!shipment) {
    throw new AppError("Shipment not found", 404);
  }

  return sendSuccess(res, "Shipment assigned to customer successfully", shipment);
};

exports.updateShipmentStatus = async (req, res) => {
  const shipment = await changeShipmentStatus(req.params.id, req.body.status, req.body.note);
  await createShipmentEvent(shipment);
  return sendSuccess(res, "Shipment status updated successfully", shipment);
};