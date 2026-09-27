const {  query, transaction  } = require("../db");
const {  assertGroup, assertMember  } = require("./membership");
const {  conflict, forbidden, notFound  } = require("../utils/errors");
const {  Role  } = require("../types");

async function listConversations(userId) {
  const result = await query(
    `SELECT
       c.id,c.type,c.name,c.avatar_url,c.created_at,c.updated_at,
       cm.role,
       lm.id AS last_message_id,
       lm.content AS last_message_content,
       lm.created_at AS last_message_at,
       lm.sender_id AS last_message_sender_id,
       (
         SELECT COUNT(*)::int
         FROM messages m2
         WHERE m2.conversation_id=c.id
           AND m2.created_at > COALESCE(cr.read_at,'epoch')
           AND m2.sender_id <> $1
           AND m2.deleted_at IS NULL
       ) AS unread_count,
       CASE
         WHEN c.type='DIRECT' THEN (
           SELECT json_build_object('id',u.id,'name',u.name,'email',u.email,'avatarUrl',u.avatar_url)
           FROM conversation_members cm2
           JOIN users u ON u.id=cm2.user_id
           WHERE cm2.conversation_id=c.id AND cm2.user_id<>$1 AND cm2.left_at IS NULL
           LIMIT 1
         )
         ELSE NULL
       END AS other_user
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1 AND cm.left_at IS NULL
     LEFT JOIN conversation_reads cr ON cr.conversation_id=c.id AND cr.user_id=$1
     LEFT JOIN LATERAL (
       SELECT id,content,created_at,sender_id
       FROM messages
       WHERE conversation_id=c.id
       ORDER BY created_at DESC,id DESC
       LIMIT 1
     ) lm ON true
     ORDER BY COALESCE(lm.created_at,c.updated_at) DESC`,
    [userId]
  );
  return result.rows;
}

async function getConversation(userId, conversationId) {
  const membership = await assertMember(userId, conversationId);
  const conversation = await query(
    `SELECT id,type,name,avatar_url,created_by,created_at,updated_at
     FROM conversations WHERE id=$1`,
    [conversationId]
  );
  if (!conversation.rowCount) throw notFound("Conversation not found");

  const members = await query(
    `SELECT cm.user_id AS id,u.email,u.name,u.avatar_url AS "avatarUrl",cm.role,cm.joined_at,cm.left_at
     FROM conversation_members cm
     JOIN users u ON u.id=cm.user_id
     WHERE cm.conversation_id=$1 AND cm.left_at IS NULL
     ORDER BY CASE cm.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END,u.name`,
    [conversationId]
  );

  return { ...conversation.rows[0], currentRole: membership.role, members: members.rows };
}

async function createDirect(userId, otherUserId) {
  if (userId === otherUserId) throw conflict("You cannot chat with yourself");

  return transaction(async (client) => {
    const user = await client.query(`SELECT id FROM users WHERE id=$1`, [otherUserId]);
    if (!user.rowCount) throw notFound("User not found");

    const [a, b] = [userId, otherUserId].sort();
    const directKey = `${a}:${b}`;

    const c = await client.query(
      `INSERT INTO conversations(type,direct_key,created_by)
       VALUES('DIRECT',$1,$2)
       ON CONFLICT(direct_key) DO UPDATE SET updated_at=conversations.updated_at
       RETURNING id,type,name,avatar_url,created_at,updated_at`,
      [directKey, userId]
    );

    const conversationId = c.rows[0].id;

    await client.query(
      `INSERT INTO conversation_members(conversation_id,user_id,role)
       VALUES($1,$2,'MEMBER'),($1,$3,'MEMBER')
       ON CONFLICT(conversation_id,user_id) DO UPDATE SET left_at=NULL`,
      [conversationId, userId, otherUserId]
    );

    return c.rows[0];
  });
}

async function createGroup(userId, name, avatarUrl = null) {
  return transaction(async (client) => {
    const c = await client.query(
      `INSERT INTO conversations(type,name,avatar_url,created_by)
       VALUES('GROUP',$1,$2,$3) RETURNING id,type,name,avatar_url,created_at,updated_at`,
      [name, avatarUrl ?? null, userId]
    );

    await client.query(
      `INSERT INTO conversation_members(conversation_id,user_id,role)
       VALUES($1,$2,'OWNER')`,
      [c.rows[0].id, userId]
    );

    return c.rows[0];
  });
}

async function updateGroup(
  userId,
  conversationId,
  name,
  avatarUrl = null
) {
  const membership = await assertGroup(userId, conversationId);
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    throw forbidden("Admin or owner permission required");
  }

  const result = await query(
    `UPDATE conversations
     SET name=COALESCE($2,name), avatar_url=CASE WHEN $3::text IS NULL THEN avatar_url ELSE $3 END, updated_at=NOW()
     WHERE id=$1 AND type='GROUP'
     RETURNING id,type,name,avatar_url,updated_at`,
    [conversationId, name ?? null, avatarUrl === undefined ? null : avatarUrl]
  );
  return result.rows[0];
}

async function deleteGroup(userId, conversationId) {
  const membership = await assertGroup(userId, conversationId);
  if (membership.role !== "OWNER") throw forbidden("Only the owner can delete the group");
  await query(`DELETE FROM conversations WHERE id=$1 AND type='GROUP'`, [conversationId]);
}

async function addMembers(
  userId,
  conversationId,
  memberIds
) {
  const membership = await assertGroup(userId, conversationId);
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    throw forbidden("Admin or owner permission required");
  }

  const results = [];
  for (const memberId of memberIds) {
    if (memberId === userId) continue;
    const user = await query(`SELECT id FROM users WHERE id=$1`, [memberId]);
    if (!user.rowCount) continue;

    const result = await query(
      `INSERT INTO conversation_members(conversation_id,user_id,role)
       VALUES($1,$2,'MEMBER')
       ON CONFLICT(conversation_id,user_id)
       DO UPDATE SET left_at=NULL
       RETURNING conversation_id,user_id,role`,
      [conversationId, memberId]
    );
    results.push(result.rows[0]);
  }
  return results;
}

async function removeMember(userId, conversationId, memberId) {
  const actor = await assertGroup(userId, conversationId);
  if (actor.role !== "OWNER" && actor.role !== "ADMIN") {
    throw forbidden("Admin or owner permission required");
  }
  if (userId === memberId) throw forbidden("Use leave-group for yourself");

  const target = await query(
    `SELECT role FROM conversation_members
     WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL`,
    [conversationId, memberId]
  );
  if (!target.rowCount) throw notFound("Member not found");

  if (actor.role === "ADMIN" && (target.rows[0].role === "OWNER" || target.rows[0].role === "ADMIN")) {
    throw forbidden("An admin cannot remove an owner or another admin");
  }

  await query(
    `UPDATE conversation_members SET left_at=NOW()
     WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL`,
    [conversationId, memberId]
  );
}

async function setRole(
  userId,
  conversationId,
  memberId,
  role
) {
  const actor = await assertGroup(userId, conversationId);
  if (actor.role !== "OWNER") throw forbidden("Only the owner can change admin roles");

  if (memberId === userId) throw forbidden("Use ownership transfer for the owner");

  const result = await query(
    `UPDATE conversation_members
     SET role=$3
     WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL AND role <> 'OWNER'
     RETURNING user_id,role`,
    [conversationId, memberId, role]
  );
  if (!result.rowCount) throw notFound("Member not found or cannot change this member");
  return result.rows[0];
}

async function transferOwnership(
  userId,
  conversationId,
  newOwnerId
) {
  const actor = await assertGroup(userId, conversationId);
  if (actor.role !== "OWNER") throw forbidden("Only the owner can transfer ownership");

  return transaction(async (client) => {
    const target = await client.query(
      `SELECT role FROM conversation_members
       WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL`,
      [conversationId, newOwnerId]
    );
    if (!target.rowCount) throw notFound("New owner must be an active group member");

    await client.query(
      `UPDATE conversation_members SET role='ADMIN'
       WHERE conversation_id=$1 AND user_id=$2`,
      [conversationId, userId]
    );
    await client.query(
      `UPDATE conversation_members SET role='OWNER'
       WHERE conversation_id=$1 AND user_id=$2`,
      [conversationId, newOwnerId]
    );
  });
}

module.exports = {
  listConversations,
  getConversation,
  transferOwnership,
  setRole,
  removeMember,
  addMembers,
  updateGroup,
  deleteGroup,
  createDirect,
  createGroup
};