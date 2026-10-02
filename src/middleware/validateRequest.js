const { validationResult } = require("express-validator");
const AppError = require("../utils/AppError");

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const fieldErrors = errors.array().map(({ path, param, msg }) => ({
      field: path || param,
      message: msg,
    }));
    return next(new AppError("Validation failed", 400, fieldErrors));
  }

  return next();
}

module.exports = validateRequest;