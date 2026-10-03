const {
  clearReceivedRequests,
  getResponseProfile,
  getResponseProfiles,
  listReceivedRequests,
  recordReceivedRequest,
  resetResponseProfiles,
  updateResponseProfiles,
  verifySignature,
} = require("../services/demoReceiver");
const { paginatedData, sendSuccess } = require("../utils/apiResponse");

async function sendReceiverResponse(req, res, profileName) {
  const rawBody = req.rawBody || "";
  const verification = await verifySignature(
    rawBody,
    req.get("X-Webhook-Signature"),
    req.get("X-Webhook-Timestamp")
  );
  const received = recordReceivedRequest({
    headers: req.headers,
    body: req.body,
    rawBody,
    verification,
  });
  const profile = getResponseProfile(profileName);
  const responseBody = Object.hasOwn(profile, "body")
    ? profile.body
    : { success: true, message: "Webhook received", data: received };

  return res.status(profile.statusCode).json(responseBody);
}

exports.receive = (req, res) => sendReceiverResponse(req, res, "success");

exports.listReceived = (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const { items, total } = listReceivedRequests({
    page,
    limit,
    signatureValid: req.query.signatureValid,
    event: req.query.event,
  });
  return sendSuccess(
    res,
    "Received webhooks retrieved successfully",
    paginatedData(items, page, limit, total, "requests")
  );
};

exports.clearReceived = (_req, res) => {
  return sendSuccess(res, "Received webhook history cleared", {
    clearedCount: clearReceivedRequests(),
  });
};

exports.getConfiguration = (_req, res) => {
  return sendSuccess(res, "Demo receiver configuration retrieved successfully", getResponseProfiles());
};

exports.updateConfiguration = (req, res) => {
  return sendSuccess(
    res,
    "Demo receiver configuration updated successfully",
    updateResponseProfiles(req.body)
  );
};

exports.resetConfiguration = (_req, res) => {
  return sendSuccess(
    res,
    "Demo receiver configuration reset successfully",
    resetResponseProfiles()
  );
};

exports.fail = (req, res) => sendReceiverResponse(req, res, "failure");