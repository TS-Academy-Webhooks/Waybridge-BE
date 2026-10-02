const express = require("express");
const { param, query } = require("express-validator");
const router = express.Router();
const validateRequest = require("../middleware/validateRequest");
const eventTypes = require("../utils/eventTypes");
const { getEvents, getEvent } = require("../controllers/eventController");

router.get(
	"/",
	query("type").optional().custom((value) => value === "webhook.test" || eventTypes.includes(value)).withMessage("Invalid event type"),
	query("search").optional().trim().isLength({ max: 100 }).withMessage("Search must be at most 100 characters"),
	query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer").toInt(),
	query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100").toInt(),
	validateRequest,
	getEvents
);
router.get(
	"/:id",
	param("id").custom((value) => /^[a-zA-Z0-9_-]+$/.test(value)).withMessage("Invalid event ID"),
	validateRequest,
	getEvent
);

module.exports = router;