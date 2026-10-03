const rateLimit = require("express-rate-limit");
const { sendError } = require("../utils/apiResponse");

function createLimiter(limit, message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(req, res) {
      return sendError(res, message, 429);
    },
  });
}

module.exports = {
  authLimiter: createLimiter(20, "Too many authentication requests. Try again later."),
  demoReceiverLimiter: createLimiter(1200, "Too many demo receiver requests. Try again later."),
  trackingLimiter: createLimiter(60, "Too many tracking requests. Try again later."),
};