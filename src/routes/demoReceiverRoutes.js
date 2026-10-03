const express = require("express");
const { body, query } = require("express-validator");
const demoReceiverController = require("../controllers/demoReceiverController");
const authenticate = require("../middleware/auth");
const authorizeRoles = require("../middleware/authorizeRoles");
const validateRequest = require("../middleware/validateRequest");

const router = express.Router();

const requireAdmin = [authenticate, authorizeRoles("admin")];
const responseProfileFields = ["statusCode", "body"];
const isJsonValue = (value) => value === null ||
  ["string", "number", "boolean"].includes(typeof value) ||
  (typeof value === "object" && value !== undefined);
const isValidResponseProfile = (profile) => profile &&
  typeof profile === "object" &&
  !Array.isArray(profile) &&
  Object.keys(profile).length > 0 &&
  Object.keys(profile).every((key) => responseProfileFields.includes(key));

router.post("/", demoReceiverController.receive);
router.post("/fail", demoReceiverController.fail);
router.get(
  "/",
  ...requireAdmin,
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer").toInt(),
  query("limit").optional().isInt({ min: 1, max: 50 }).withMessage("Limit must be between 1 and 50").toInt(),
  query("signatureValid").optional().isIn(["true", "false", "unknown"])
    .withMessage("Signature validity must be true, false, or unknown"),
  query("event").optional().trim().isLength({ min: 1, max: 100 })
    .withMessage("Event must be between 1 and 100 characters"),
  validateRequest,
  demoReceiverController.listReceived
);
router.delete("/", ...requireAdmin, demoReceiverController.clearReceived);
router.get("/config", ...requireAdmin, demoReceiverController.getConfiguration);
router.patch(
  "/config",
  ...requireAdmin,
  body().custom((value) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => ["success", "failure"].includes(key)))
    .withMessage("Provide a success or failure response profile"),
  body("success").optional({ values: "undefined" }).isObject({ strict: true })
    .withMessage("Success profile must be an object").bail(),
  body("success").optional({ values: "undefined" }).custom(isValidResponseProfile)
    .withMessage("Success profile may contain only statusCode and body"),
  body("success.statusCode").optional({ values: "undefined" }).isInt({ min: 200, max: 299 })
    .withMessage("Success statusCode must be between 200 and 299").toInt(),
  body("success.body").optional({ values: "undefined" }).custom(isJsonValue)
    .withMessage("Success body must be a JSON value"),
  body("failure").optional({ values: "undefined" }).isObject({ strict: true })
    .withMessage("Failure profile must be an object").bail(),
  body("failure").optional({ values: "undefined" }).custom(isValidResponseProfile)
    .withMessage("Failure profile may contain only statusCode and body"),
  body("failure.statusCode").optional({ values: "undefined" }).isInt({ min: 400, max: 599 })
    .withMessage("Failure statusCode must be between 400 and 599").toInt(),
  body("failure.body").optional({ values: "undefined" }).custom(isJsonValue)
    .withMessage("Failure body must be a JSON value"),
  validateRequest,
  demoReceiverController.updateConfiguration
);
router.delete("/config", ...requireAdmin, demoReceiverController.resetConfiguration);

module.exports = router;