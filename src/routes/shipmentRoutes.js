const express = require("express");
const { body, param, query } = require("express-validator");
const router = express.Router();
const validateRequest = require("../middleware/validateRequest");
const authorizeRoles = require("../middleware/authorizeRoles");
const { SHIPMENT_STATUSES } = require("../services/shipmentService");
const {
  createShipment,
  getShipments,
  getShipment,
  assignShipmentCustomer,
  updateShipmentStatus,
} = require("../controllers/shipmentController");

router.post(
  "/",
  body("customer").optional().isString().trim().withMessage("Customer must be text"),
  body("customer").custom((value, { req }) => req.user.role !== "admin" || (typeof value === "string" && value.trim().length > 0)).withMessage("Customer is required for admin-created shipments"),
  body("customerId").optional().isMongoId().withMessage("Invalid customer ID"),
  body("customerId").custom((value, { req }) => req.user.role === "admin" || value === undefined).withMessage("Customers cannot assign shipments to another account"),
  body("origin").trim().notEmpty().withMessage("Origin is required"),
  body("destination").trim().notEmpty().withMessage("Destination is required"),
  body("amount").isFloat({ min: 0 }).withMessage("Amount must be zero or greater").toFloat(),
  validateRequest,
  createShipment
);

router.get(
  "/",
  query("search").optional().trim().isLength({ max: 100 }).withMessage("Search must be at most 100 characters"),
  query("status").optional().isIn(SHIPMENT_STATUSES).withMessage("Invalid shipment status"),
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer").toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100").toInt(),
  validateRequest,
  getShipments
);

router.get("/:id", param("id").isMongoId().withMessage("Invalid shipment ID"), validateRequest, getShipment);
router.patch(
  "/:id/customer",
  authorizeRoles("admin"),
  param("id").isMongoId().withMessage("Invalid shipment ID"),
  body("customerId").isMongoId().withMessage("A valid customer ID is required"),
  validateRequest,
  assignShipmentCustomer
);
router.patch(
  "/:id/status",
  authorizeRoles("admin"),
  param("id").isMongoId().withMessage("Invalid shipment ID"),
  body("status").isIn(SHIPMENT_STATUSES).withMessage("Invalid shipment status"),
  body("note").optional().isString().trim().isLength({ max: 500 }).withMessage("Note must be 500 characters or fewer"),
  validateRequest,
  updateShipmentStatus
);

module.exports = router;