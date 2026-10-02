const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const shipmentRoutes = require("./routes/shipmentRoutes");
const trackingRoutes = require("./routes/trackingRoutes");
const eventRoutes = require("./routes/eventRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const authRoutes = require("./routes/authRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes");
const demoReceiverRoutes = require("./routes/demoReceiverRoutes");
const authenticate = require("./middleware/auth");
const authorizeRoles = require("./middleware/authorizeRoles");
const { authLimiter, trackingLimiter } = require("./middleware/rateLimits");
const AppError = require("./utils/AppError");
const { sendSuccess } = require("./utils/apiResponse");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new AppError("Origin is not allowed", 403));
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({
  limit: "1mb",
  verify(req, res, buffer) {
    req.rawBody = buffer.toString("utf8");
  },
}));

const healthCheck = (req, res) => {
  return sendSuccess(res, "API is healthy", { status: "ok" });
};

app.get("/", (req, res) => sendSuccess(res, "Logistics API is running", { status: "ok" }));
app.get(["/health", "/api/health"], healthCheck);

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/shipments", authenticate, shipmentRoutes);
app.use("/api/tracking", trackingLimiter, trackingRoutes);
app.use("/api/events", authenticate, authorizeRoles("admin"), eventRoutes);
app.use("/api/webhooks", authenticate, webhookRoutes);
app.use("/api/deliveries", authenticate, deliveryRoutes);
if (process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_RECEIVER === "true") {
  app.use("/api/demo-receiver", demoReceiverRoutes);
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;