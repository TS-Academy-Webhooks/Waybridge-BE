const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("node:path");
const swaggerUi = require("swagger-ui-express");
const shipmentRoutes = require("./routes/shipmentRoutes");
const trackingRoutes = require("./routes/trackingRoutes");
const eventRoutes = require("./routes/eventRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const authRoutes = require("./routes/authRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes");
const demoReceiverRoutes = require("./routes/demoReceiverRoutes");
const authenticate = require("./middleware/auth");
const authorizeRoles = require("./middleware/authorizeRoles");
const {
  authLimiter,
  demoReceiverLimiter,
  trackingLimiter,
} = require("./middleware/rateLimits");
const AppError = require("./utils/AppError");
const { sendSuccess } = require("./utils/apiResponse");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim());
const demoReceiverEnabled = process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_DEMO_RECEIVER === "true";

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
if (demoReceiverEnabled) {
  app.use("/api/demo-receiver", (req, res, next) => {
    if (req.method !== "POST") return next();
    return demoReceiverLimiter(req, res, next);
  });
}
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

app.use("/docs", helmet.contentSecurityPolicy({
  directives: {
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
  },
}));
app.get("/docs/openapi.yaml", (req, res, next) => {
  res.type("application/yaml").sendFile(path.join(__dirname, "..", "openapi.yaml"), (error) => {
    if (error) next(error);
  });
});
app.use("/docs", swaggerUi.serve, swaggerUi.setup(null, {
  customSiteTitle: "Waybridge API Reference",
  swaggerOptions: {
    url: "/docs/openapi.yaml",
    withCredentials: true,
  },
}));

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/shipments", authenticate, shipmentRoutes);
app.use("/api/tracking", trackingLimiter, trackingRoutes);
app.use("/api/events", authenticate, authorizeRoles("admin"), eventRoutes);
app.use("/api/webhooks", authenticate, webhookRoutes);
app.use("/api/deliveries", authenticate, deliveryRoutes);
if (demoReceiverEnabled) {
  app.use("/api/demo-receiver", demoReceiverRoutes);
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;