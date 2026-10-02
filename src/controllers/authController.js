const bcrypt = require("bcryptjs");
const User = require("../models/User");
const RefreshSession = require("../models/RefreshSession");
const AppError = require("../utils/AppError");
const { sendSuccess } = require("../utils/apiResponse");
const {
  clearRefreshCookie,
  getRefreshCookieName,
  revokeSession,
  rotateSession,
  startSession,
} = require("../services/authService");

function toPublicUser(user) {
  return {
    id: user._id,
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

exports.register = async (req, res, next) => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new AppError("JWT_SECRET is not configured", 500);
    }
    const { name, email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new AppError("An account with this email already exists", 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, passwordHash, role: "customer" });
    const accessToken = await startSession(user, req, res);

    return sendSuccess(res, "Account registered successfully", {
      user: toPublicUser(user),
      token: accessToken,
    }, 201);
  } catch (error) {
    return next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new AppError("JWT_SECRET is not configured", 500);
    }
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select("+passwordHash");
    const passwordMatches = user
      ? await bcrypt.compare(password, user.passwordHash)
      : false;

    if (!passwordMatches) {
      throw new AppError("Email or password is incorrect", 401);
    }

    const accessToken = await startSession(user, req, res);
    return sendSuccess(res, "Login successful", {
      user: toPublicUser(user),
      accessToken,
      token: accessToken,
    });
  } catch (error) {
    return next(error);
  }
};

exports.refresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.[getRefreshCookieName()];
    if (!refreshToken) {
      throw new AppError("Refresh session is required", 401);
    }

    const session = await rotateSession(refreshToken, req, res);
    return sendSuccess(res, "Access token refreshed", {
      user: toPublicUser(session.user),
      accessToken: session.accessToken,
      token: session.accessToken,
    });
  } catch (error) {
    return next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.[getRefreshCookieName()];
    await revokeSession(refreshToken);
    clearRefreshCookie(res);
    return sendSuccess(res, "Logged out successfully");
  } catch (error) {
    return next(error);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("+passwordHash");
    const passwordMatches = user
      ? await bcrypt.compare(req.body.currentPassword, user.passwordHash)
      : false;
    if (!passwordMatches) {
      throw new AppError("Current password is incorrect", 401);
    }

    user.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    await user.save();
    await RefreshSession.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    clearRefreshCookie(res);
    return sendSuccess(res, "Password changed. Please sign in again.");
  } catch (error) {
    return next(error);
  }
};

exports.me = (req, res) => {
  const user = toPublicUser(req.user);
  return sendSuccess(res, "Current user retrieved successfully", { ...user, user });
};