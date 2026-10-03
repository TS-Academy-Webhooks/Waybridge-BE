const { body } = require("express-validator");
const {
  isExactLocalhostHttpUrl,
  isLocalhostWebhookAllowed,
} = require("../utils/localhostWebhookPolicy");

function webhookUrlValidators({ optional = false } = {}) {
  const standardUrl = body("url");
  const localhostUrl = body("url");

  if (optional) {
    standardUrl.optional();
    localhostUrl.optional();
  }

  return [
    standardUrl
      .if((value) => !isExactLocalhostHttpUrl(value))
      .isURL({ protocols: ["http", "https"], require_protocol: true })
      .withMessage("A valid http or https URL is required"),
    localhostUrl
      .if((value) => isExactLocalhostHttpUrl(value))
      .isURL({
        protocols: ["http", "https"],
        require_protocol: true,
        require_tld: false,
      })
      .bail()
      .custom(() => isLocalhostWebhookAllowed())
      .withMessage(
        "Localhost webhook URLs require NODE_ENV=development, ALLOW_LOCALHOST_WEBHOOKS=true, and ENABLE_DEMO_RECEIVER=true"
      ),
  ];
}

module.exports = webhookUrlValidators;
