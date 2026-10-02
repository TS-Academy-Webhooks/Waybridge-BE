const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const RefreshSession = require("../models/RefreshSession");
const AppError = require("../utils/AppError");

const ACCESS_TOKEN_LIFETIME = "15m";
const REFRESH_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const JWT_ISSUER = "logistics-webhook-api";
const JWT_AUDIENCE = "logistics-webhook-client";

function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getRefreshCookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Secure-refreshToken"
    : "refreshToken";
}

function getRefreshCookieOptions() {
  const sameSite = (process.env.REFRESH_COOKIE_SAME_SITE || "strict").toLowerCase();
  if (!["strict", "lax", "none"].includes(sameSite)) {
    throw new AppError("REFRESH_COOKIE_SAME_SITE must be strict, lax, or none", 500);
  }

  const secure = process.env.NODE_ENV === "production";
  if (sameSite === "none" && !secure) {
    throw new AppError("SameSite=None refresh cookies require production HTTPS", 500);
  }

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/api/auth",
    maxAge: REFRESH_SESSION_LIFETIME_MS,
  };
}

function setRefreshCookie(res, token) {
  res.cookie(getRefreshCookieName(), token, getRefreshCookieOptions());
}

function clearRefreshCookie(res) {
  const { maxAge, ...options } = getRefreshCookieOptions();
  res.clearCookie(getRefreshCookieName(), options);
}

function createAccessToken(user, sessionId) {
  if (!process.env.JWT_SECRET) {
    throw new AppError("JWT_SECRET is not configured", 500);
  }

  return jwt.sign(
    { sid: sessionId.toString() },
    process.env.JWT_SECRET,
    {
      subject: user._id.toString(),
      expiresIn: ACCESS_TOKEN_LIFETIME,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithm: "HS256",
    }
  );
}

async function startSession(user, req, res) {
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  const session = await RefreshSession.create({
    userId: user._id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_SESSION_LIFETIME_MS),
    userAgent: req.get("user-agent")?.slice(0, 300),
  });

  setRefreshCookie(res, refreshToken);
  return createAccessToken(user, session._id);
}

async function rotateSession(refreshToken, req, res) {
  const nextRefreshToken = crypto.randomBytes(48).toString("base64url");
  const now = new Date();
  const session = await RefreshSession.findOneAndUpdate(
    {
      tokenHash: hashRefreshToken(refreshToken),
      revokedAt: null,
      expiresAt: { $gt: now },
    },
    {
      $set: {
        tokenHash: hashRefreshToken(nextRefreshToken),
        expiresAt: new Date(now.getTime() + REFRESH_SESSION_LIFETIME_MS),
        lastUsedAt: now,
        userAgent: req.get("user-agent")?.slice(0, 300),
      },
    },
    { returnDocument: "after" }
  ).populate("userId");

  if (!session || !session.userId) {
    clearRefreshCookie(res);
    throw new AppError("Refresh session is invalid or expired", 401);
  }

  setRefreshCookie(res, nextRefreshToken);
  return {
    user: session.userId,
    accessToken: createAccessToken(session.userId, session._id),
  };
}

async function revokeSession(refreshToken) {
  if (!refreshToken) {
    return;
  }

  await RefreshSession.updateOne(
    { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

async function bootstrapAdminAccount() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  const name = (process.env.ADMIN_NAME || "Platform Admin").trim();

  if (!email || password.length < 12) {
    throw new Error("ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters are required.");
  }
  if (email === "admin@example.com" || password.toLowerCase().includes("replace")) {
    throw new Error("Replace the example admin credentials before starting the server.");
  }

  let admin = await User.findOne({ email });
  if (admin) {
    if (admin.role !== "admin") {
      throw new Error("ADMIN_EMAIL belongs to a customer account; choose a dedicated admin email.");
    }
    return false;
  }

  try {
    await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "admin",
    });
    return true;
  } catch (error) {
    if (error.code !== 11000) {
      throw error;
    }

    admin = await User.findOne({ email });
    if (!admin || admin.role !== "admin") {
      throw new Error("Could not safely create the bootstrap admin account.");
    }
    return false;
  }
}

async function assignLegacyUsersCustomerRole() {
  await User.collection.updateMany(
    { role: { $nin: ["admin", "customer"] } },
    { $set: { role: "customer" } }
  );
}

module.exports = {
  ACCESS_TOKEN_LIFETIME,
  JWT_AUDIENCE,
  JWT_ISSUER,
  assignLegacyUsersCustomerRole,
  bootstrapAdminAccount,
  clearRefreshCookie,
  createAccessToken,
  getRefreshCookieName,
  hashRefreshToken,
  revokeSession,
  rotateSession,
  setRefreshCookie,
  startSession,
};