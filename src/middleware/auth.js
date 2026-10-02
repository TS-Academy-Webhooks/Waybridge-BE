const jwt = require("jsonwebtoken");
const User = require("../models/User");
const RefreshSession = require("../models/RefreshSession");
const AppError = require("../utils/AppError");
const { JWT_AUDIENCE, JWT_ISSUER } = require("../services/authService");

async function authenticate(req, res, next) {
  const authorization = req.get("Authorization") || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new AppError("Authentication required", 401));
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const [user, session] = await Promise.all([
      User.findById(payload.sub),
      RefreshSession.exists({
        _id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }),
    ]);
    if (!user || !session) {
      return next(new AppError("Authentication required", 401));
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(new AppError("Invalid or expired token", 401));
  }
}

module.exports = authenticate;