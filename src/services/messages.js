const {  query, transaction  } = require("../db");
const {  assertMember  } = require("./membership");
const {  badRequest, forbidden, notFound  } = require("../utils/errors");

const messageSelect = `
  SELECT
    m.id,m.client_message_id,m.conversation_id,m.sender_id,
    m.content,m.edited_at,m.deleted_at,m.created_at,
    u.name AS sender_name,u.avatar_url AS sender_avatar,
    COALESCE(
      json_agg(
        json_build_object(
          'userId',r.user_id,
          'emoji',r.emoji
        )
      ) FILTER (WHERE r.message_id IS NOT NULL),
      '[]'::json
    ) AS reactions
  FROM messages m
  JOIN users u ON u.id=m.sender_id
  LEFT JOIN message_reactions r ON r.message_id=m.id
`;

async function listMessages(
  userId,
  conversationId,
  cursor,
  limit = 30
) {
  await assertMember(userId, conversationId);
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  let result;
  if (cursor) {
    result = await query(
      `${messageSelect}
       WHERE m.conversation_id=$1
         AND (m.created_at,m.id) < (
           SELECT created_at,id FROM messages WHERE id=$2 AND conversation_id=$1
         )
       GROUP BY m.id,u.id
       ORDER BY m.created_at DESC,m.id DESC
       LIMIT $3`,
      [conversationId, cursor, safeLimit + 1]
    );
  } else {
    result = await query(
      `${messageSelect}
       WHERE m.conversation_id=$1
       GROUP BY m.id,u.id
       ORDER BY m.created_at DESC,m.id DESC
       LIMIT $2`,
      [conversationId, safeLimit + 1]
    );
  }

  const hasMore = result.rows.length > safeLimit;
  const rows = hasMore ? result.rows.slice(0, safeLimit) : result.rows;

  return {
    messages: rows.reverse(),
    nextCursor: hasMore ? rows[0].id : null
  };
}

async function createMessage(
  userId,
  conversationId,
  clientMessageId,
  content
) {
  await assertMember(userId, conversationId);

  const inserted = await query(
    `INSERT INTO messages(client_message_id,conversation_id,sender_id,content)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(sender_id,client_message_id)
     DO UPDATE SET content=messages.content
     RETURNING id`,
    [clientMessageId, conversationId, userId, content]
  );
  const message = await getMessage(inserted.rows[0].id);
  await query(`UPDATE conversations SET updated_at=NOW() WHERE id=$1`, [conversationId]);
  return message;
}

async function getMessage(messageId) {
  const result = await query(
    `${messageSelect}
     WHERE m.id=$1
     GROUP BY m.id,u.id`,
    [messageId]
  );
  return result.rows[0] ?? null;
}

async function editMessage(userId, messageId, content) {
  const existing = await query(
    `SELECT id,conversation_id,sender_id,created_at,deleted_at
     FROM messages WHERE id=$1`,
    [messageId]
  );
  if (!existing.rowCount) throw notFound("Message not found");
  const m = existing.rows[0];

  await assertMember(userId, m.conversation_id);
  if (m.sender_id !== userId) throw forbidden("You can only edit your own messages");
  if (m.deleted_at) throw badRequest("Deleted messages cannot be edited");

  const result = await query(
    `UPDATE messages SET content=$2,edited_at=NOW()
     WHERE id=$1 RETURNING id`,
    [messageId, content]
  );
  return getMessage(result.rows[0].id);
}

async function deleteMessage(userId, messageId) {
  const existing = await query(
    `SELECT id,conversation_id,sender_id,created_at,deleted_at
     FROM messages WHERE id=$1`,
    [messageId]
  );
  if (!existing.rowCount) throw notFound("Message not found");
  const m = existing.rows[0];

  await assertMember(userId, m.conversation_id);
  if (m.sender_id !== userId) throw forbidden("You can only delete your own messages");
  if (m.deleted_at) return getMessage(messageId);

  const ageMs = Date.now() - new Date(m.created_at).getTime();
  if (ageMs > 10 * 60 * 1000) {
    throw forbidden("Messages can only be deleted for everyone within 10 minutes");
  }

  await query(`UPDATE messages SET deleted_at=NOW(),content='' WHERE id=$1`, [messageId]);
  return getMessage(messageId);
}

async function addReaction(userId, messageId, emoji) {
  const message = await getMessage(messageId);
  if (!message) throw notFound("Message not found");
  await assertMember(userId, message.conversation_id);

  await query(
    `INSERT INTO message_reactions(message_id,user_id,emoji)
     VALUES($1,$2,$3)
     ON CONFLICT DO NOTHING`,
    [messageId, userId, emoji]
  );
  return getMessage(messageId);
}

async function removeReaction(userId, messageId, emoji) {
  const message = await getMessage(messageId);
  if (!message) throw notFound("Message not found");
  await assertMember(userId, message.conversation_id);

  await query(
    `DELETE FROM message_reactions
     WHERE message_id=$1 AND user_id=$2 AND emoji=$3`,
    [messageId, userId, emoji]
  );
  return getMessage(messageId);
}

async function markConversationRead(
  userId,
  conversationId,
  messageId
) {
  await assertMember(userId, conversationId);

  const message = await query(
    `SELECT id FROM messages WHERE id=$1 AND conversation_id=$2`,
    [messageId, conversationId]
  );
  if (!message.rowCount) throw badRequest("Message does not belong to this conversation");

  await query(
    `INSERT INTO conversation_reads(conversation_id,user_id,last_read_message_id,read_at)
     VALUES($1,$2,$3,NOW())
     ON CONFLICT(conversation_id,user_id)
     DO UPDATE SET last_read_message_id=EXCLUDED.last_read_message_id,read_at=NOW()`,
    [conversationId, userId, messageId]
  );

  await query(
    `INSERT INTO message_reads(message_id,user_id,read_at)
     SELECT m.id,$2,NOW()
     FROM messages m
     WHERE m.conversation_id=$1
       AND m.id <= $3
       AND m.sender_id <> $2
       AND m.deleted_at IS NULL
     ON CONFLICT(message_id,user_id)
     DO UPDATE SET read_at=NOW()`,
    [conversationId, userId, messageId]
  );
}

async function unreadCounts(userId) {
  const result = await query(
    `SELECT c.id AS conversation_id,
       COUNT(m.id)::int AS unread_count
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id=c.id
       AND cm.user_id=$1 AND cm.left_at IS NULL
     LEFT JOIN conversation_reads cr ON cr.conversation_id=c.id AND cr.user_id=$1
     LEFT JOIN messages m ON m.conversation_id=c.id
       AND m.created_at > COALESCE(cr.read_at,'epoch')
       AND m.sender_id <> $1
       AND m.deleted_at IS NULL
     GROUP BY c.id`,
    [userId]
  );
  return result.rows;
}

module.exports = {
  unreadCounts,
  listMessages,
  createMessage,
  getMessage,
  editMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  markConversationRead
};
