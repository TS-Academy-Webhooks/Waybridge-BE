const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { authLimiter } = require("../src/middleware/rateLimits");

test("auth limiter allows 80 requests per IP in its 15-minute window", async (t) => {
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api/auth", authLimiter, (req, res) => res.sendStatus(204));

  const testIp = "203.0.113.80";
  authLimiter.resetKey(testIp);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    authLimiter.resetKey(testIp);
    server.closeAllConnections();
    server.close();
  });

  const url = `http://127.0.0.1:${server.address().port}/api/auth/test`;
  const headers = { "X-Forwarded-For": testIp };
  for (let request = 1; request <= 80; request += 1) {
    const response = await fetch(url, { headers });
    assert.equal(response.status, 204, `request ${request} should be allowed`);
  }

  const limitedResponse = await fetch(url, { headers });
  assert.equal(limitedResponse.status, 429);
});
