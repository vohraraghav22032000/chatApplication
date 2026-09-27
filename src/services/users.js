const { query } = require("../db");
const { notFound } = require("../utils/errors");

async function searchUsers(currentUserId, q) {
  const result = await query(
    `SELECT id,
            email,
            name,
            avatar_url AS "avatarUrl",
            last_seen_at AS "lastSeenAt"
     FROM users
     WHERE id <> $1
       AND (name ILIKE $2 OR email ILIKE $2)
     ORDER BY name
     LIMIT 20`,
    [currentUserId, `%${q}%`]
  );

  return result.rows;
}

async function getUser(userId) {
  const result = await query(
    `SELECT id,
            email,
            name,
            avatar_url AS "avatarUrl",
            last_seen_at AS "lastSeenAt"
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (!result.rowCount) {
    throw notFound("User not found");
  }

  return result.rows[0];
}

module.exports = {
  searchUsers,
  getUser,
};