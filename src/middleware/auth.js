const { unauthorized } = require("../utils/errors");
const { verifyAccessToken } = require("../utils/jwt");

async function requireAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw unauthorized("Authentication required");
    }

    const token = authHeader.split(" ")[1];

    const payload = verifyAccessToken(token);

    req.user = {
      id: payload.userId,
    };

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requireAuth,
};