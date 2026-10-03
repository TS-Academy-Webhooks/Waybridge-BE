function isLocalhostWebhookAllowed() {
  return process.env.NODE_ENV === "development" &&
    process.env.ALLOW_LOCALHOST_WEBHOOKS === "true" &&
    process.env.ENABLE_DEMO_RECEIVER === "true";
}

function isExactLocalhostHttpUrl(value) {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      url.hostname.toLowerCase() === "localhost" &&
      !url.username &&
      !url.password;
  } catch {
    return false;
  }
}

module.exports = { isLocalhostWebhookAllowed, isExactLocalhostHttpUrl };
