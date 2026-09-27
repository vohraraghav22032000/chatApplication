const bcrypt = require("bcryptjs");
const { query, transaction } = require("../db");
const { config } = require("../config");
const { conflict, unauthorized } = require("../utils/errors");
const { randomToken, sha256 } = require("../utils/crypto");
const { signAccessToken } = require("../utils/jwt");

function refreshExpiry() {
  const ttl = config.refreshTokenTtl;

  const match = /^(\d+)([smhd])$/.exec(ttl);

  if (!match) {
    throw new Error(
      `Invalid refresh token TTL: ${ttl}. Use formats like 15m, 1h, 7d, 30d`
    );
  }

  const amount = Number(match[1]);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return new Date(Date.now() + amount * multipliers[unit]);
}

async function signup(email, password, name) {
  const normalized = email.trim().toLowerCase();

  const existing = await query(
    `SELECT id FROM users WHERE email=$1`,
    [normalized]
  );

  if (existing.rowCount) {
    throw conflict("Email is already registered");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await query(
    `INSERT INTO users(email, password_hash, name)
     VALUES($1, $2, $3)
     RETURNING id, email, name, avatar_url`,
    [normalized, passwordHash, name.trim()]
  );

  return issueTokens(user.rows[0].id);
}

async function login(email, password) {
  const normalized = email.trim().toLowerCase();

  const result = await query(
    `SELECT id, email, name, avatar_url, password_hash
     FROM users
     WHERE email=$1`,
    [normalized]
  );

  if (!result.rowCount) {
    throw unauthorized("Invalid email or password");
  }

  const user = result.rows[0];

  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    throw unauthorized("Invalid email or password");
  }

  return issueTokens(user.id);
}

async function issueTokens(userId) {
  const accessToken = signAccessToken(userId);
  const refreshToken = randomToken();

  await query(
    `INSERT INTO refresh_tokens(user_id, token_hash, expires_at)
     VALUES($1, $2, $3)`,
    [userId, sha256(refreshToken), refreshExpiry()]
  );

  const user = await query(
    `SELECT id, email, name, avatar_url
     FROM users
     WHERE id=$1`,
    [userId]
  );

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.rows[0].id,
      email: user.rows[0].email,
      name: user.rows[0].name,
      avatarUrl: user.rows[0].avatar_url,
    },
  };
}

async function refresh(rawToken) {
  const hash = sha256(rawToken);

  return transaction(async (client) => {
    const result = await client.query(
      `SELECT id, user_id, expires_at, revoked_at
       FROM refresh_tokens
       WHERE token_hash=$1
       FOR UPDATE`,
      [hash]
    );

    if (!result.rowCount) {
      throw unauthorized("Invalid refresh token");
    }

    const stored = result.rows[0];

    if (
      stored.revoked_at ||
      new Date(stored.expires_at).getTime() <= Date.now()
    ) {
      throw unauthorized("Refresh token expired or revoked");
    }

    await client.query(
      `UPDATE refresh_tokens
       SET revoked_at=NOW()
       WHERE id=$1`,
      [stored.id]
    );

    const accessToken = signAccessToken(stored.user_id);
    const refreshToken = randomToken();

    await client.query(
      `INSERT INTO refresh_tokens(user_id, token_hash, expires_at)
       VALUES($1, $2, $3)`,
      [stored.user_id, sha256(refreshToken), refreshExpiry()]
    );

    const user = await client.query(
      `SELECT id, email, name, avatar_url
       FROM users
       WHERE id=$1`,
      [stored.user_id]
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.rows[0].id,
        email: user.rows[0].email,
        name: user.rows[0].name,
        avatarUrl: user.rows[0].avatar_url,
      },
    };
  });
}

async function logout(rawToken) {
  if (!rawToken) return;

  await query(
    `UPDATE refresh_tokens
     SET revoked_at=NOW()
     WHERE token_hash=$1
       AND revoked_at IS NULL`,
    [sha256(rawToken)]
  );
}

module.exports = {
  signup,
  login,
  issueTokens,
  refresh,
  logout,
};