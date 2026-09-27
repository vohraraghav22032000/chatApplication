const jwt = require("jsonwebtoken");
const { config } = require("./config");

function signAccessToken(userId) {
  return jwt.sign(
    { userId },
    config.jwtSecret,
    {
      expiresIn: config.accessTokenTtl,
    }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
};