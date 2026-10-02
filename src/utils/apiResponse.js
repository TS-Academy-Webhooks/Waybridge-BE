function sendSuccess(res, message, data = null, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

function sendError(res, message, statusCode = 500, errors = null) {
  return res.status(statusCode).json({
    success: false,
    message,
    data: null,
    ...(errors ? { errors } : {}),
  });
}

function paginatedData(items, page, limit, total, collectionName) {
  return {
    items,
    [collectionName]: items,
    pagination: {
      page,
      limit,
      total,
      totalItems: total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

module.exports = { paginatedData, sendSuccess, sendError };