const express = require("express");
const demoReceiverController = require("../controllers/demoReceiverController");

const router = express.Router();

router.post("/", demoReceiverController.receive);
router.get("/", demoReceiverController.listReceived);
router.post("/fail", demoReceiverController.fail);

module.exports = router;