const jwt = require("jsonwebtoken");
const { config } = require("../config");

function signAccessToken(userId) {
  return jwt.sign(
    { userId },
    config.jwtAccessSecret,
    {
      expiresIn: config.accessTokenTtl,
    }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(
    token,
    config.jwtAccessSecret
  );
}

function signRefreshToken(userId) {
  return jwt.sign(
    { userId },
    config.jwtRefreshSecret,
    {
      expiresIn: config.refreshTokenTtl,
    }
  );
}

function verifyRefreshToken(token) {
  return jwt.verify(
    token,
    config.jwtRefreshSecret
  );
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
};