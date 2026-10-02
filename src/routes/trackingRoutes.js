const express = require("express");
const { param } = require("express-validator");
const router = express.Router();
const validateRequest = require("../middleware/validateRequest");
const { trackShipment } = require("../controllers/trackingController");

router.get(
	"/:trackingNumber",
	param("trackingNumber").matches(/^TRK-\d{5}$/).withMessage("Invalid tracking number format"),
	validateRequest,
	trackShipment
);

module.exports = router;