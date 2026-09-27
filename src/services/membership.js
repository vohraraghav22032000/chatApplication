const { query } = require("../db");
const { forbidden } = require("../utils/errors");

async function getMembership(userId, conversationId) {
  const result = await query(
    `SELECT
       cm.conversation_id,
       cm.user_id,
       cm.role,
       c.type,
       c.name
     FROM conversation_members cm
     JOIN conversations c ON c.id = cm.conversation_id
     WHERE cm.conversation_id = $1
       AND cm.user_id = $2
       AND cm.left_at IS NULL`,
    [conversationId, userId]
  );

  return result.rows[0] ?? null;
}

async function assertMember(userId, conversationId) {
  const membership = await getMembership(userId, conversationId);

  if (!membership) {
    throw forbidden("You are not a member of this conversation");
  }

  return membership;
}

async function assertGroup(userId, conversationId) {
  const membership = await assertMember(userId, conversationId);

  if (membership.type !== "GROUP") {
    throw forbidden("This operation is only valid for groups");
  }

  return membership;
}

function assertAdminOrOwner(role) {
  if (role !== "ADMIN" && role !== "OWNER") {
    throw forbidden("Admin or owner permission required");
  }
}

function assertOwner(role) {
  if (role !== "OWNER") {
    throw forbidden("Owner permission required");
  }
}

module.exports = {
  getMembership,
  assertMember,
  assertGroup,
  assertAdminOrOwner,
  assertOwner,
};