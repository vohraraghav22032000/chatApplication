const { query } = require("../db");
const { verifyAccessToken } = require("../utils/jwt");
const { getMembership } = require("../services/membership");
const messages = require("../services/messages");
const conversations = require("../services/conversations");
const { AppError } = require("../utils/errors");

const userSockets = new Map();
const socketUsers = new Map();

function userRoom(userId) {
  return `user:${userId}`;
}

function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

function setupSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (typeof socket.handshake.headers.authorization === "string"
          ? socket.handshake.headers.authorization.replace(/^Bearer /, "")
          : "");

      if (!token) {
        return next(new Error("Unauthorized"));
      }

      const payload = verifyAccessToken(token);

      const result = await query(
        `SELECT id, email, name, avatar_url
         FROM users
         WHERE id = $1`,
        [payload.userId]
      );

      if (!result.rowCount) {
        return next(new Error("Unauthorized"));
      }

      const user = {
        id: result.rows[0].id,
        email: result.rows[0].email,
        name: result.rows[0].name,
        avatarUrl: result.rows[0].avatar_url,
      };

      socketUsers.set(socket.id, user);

      next();
    } catch (error) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const user = socketUsers.get(socket.id);

    if (!user) {
      socket.disconnect(true);
      return;
    }

    let set = userSockets.get(user.id);

    if (!set) {
      set = new Set();
      userSockets.set(user.id, set);
    }

    const wasOffline = set.size === 0;

    set.add(socket.id);

    socket.join(userRoom(user.id));

    if (wasOffline) {
      io.emit("presence:update", {
        userId: user.id,
        online: true,
        lastSeenAt: null,
      });
    }

    socket.emit("socket:ready", {
      user,
      connectedAt: new Date().toISOString(),
    });

    // Join conversation
    socket.on("conversation:join", async (conversationId, ack) => {
      try {
        await requireMember(user.id, conversationId);

        socket.join(conversationRoom(conversationId));

        ack?.({ ok: true });
      } catch (error) {
        ack?.(errorPayload(error));
      }
    });

    // Leave conversation
    socket.on("conversation:leave", async (conversationId, ack) => {
      socket.leave(conversationRoom(conversationId));

      ack?.({ ok: true });
    });

    // Send message
    socket.on("message:send", async (payload, ack) => {
      try {
        const body = sendMessageSchema(payload);

        await requireMember(user.id, body.conversationId);

        const message = await messages.createMessage(
          user.id,
          body.conversationId,
          body.clientMessageId,
          body.content
        );

        io.to(conversationRoom(body.conversationId)).emit(
          "message:new",
          message
        );

        ack?.({
          ok: true,
          message,
        });
      } catch (error) {
        ack?.(errorPayload(error));
      }
    });

    // Edit message
    socket.on("message:edit", async (payload, ack) => {
      try {
        const message = await messages.editMessage(
          user.id,
          payload.messageId,
          payload.content
        );

        if (!message) {
          throw new Error("Message not found");
        }

        io.to(conversationRoom(message.conversation_id)).emit(
          "message:updated",
          message
        );

        ack?.({
          ok: true,
          message,
        });
      } catch (error) {
        ack?.(errorPayload(error));
      }
    });

    // Delete message
    socket.on("message:delete", async (payload, ack) => {
      try {
        const message = await messages.deleteMessage(
          user.id,
          payload.messageId
        );

        if (!message) {
          throw new Error("Message not found");
        }

        io.to(conversationRoom(message.conversation_id)).emit(
          "message:updated",
          message
        );

        ack?.({
          ok: true,
          message,
        });
      } catch (error) {
        ack?.(errorPayload(error));
      }
    });

    // Add reaction
    socket.on("reaction:add", async (payload, ack) => {
      try {
        const message = await messages.addReaction(
          user.id,
          payload.messageId,
          payload.emoji
        );

        io.to(conversationRoom(message.conversation_id)).emit(
          "reaction:updated",
          message
        );

        ack?.({
          ok: true,
          message,
        });
      } catch (error) {
        ack?.(errorPayload(error));
      }
    });

    // Remove reaction
    socket.on("reaction:remove", async (payload, ack) => {
      try {
        const message = await messages.removeReaction(
          user.id,
          payload.messageId,
          payload.emoji
        );

        io.to(conversationRoom(message.conversation_id)).emit(
          "reaction:updated",
          message
        );

        ack?.({
          ok: true,
          message,
        });
      } catch (error) {
        ack?.(errorPayload(error));
      }
    });

    // Mark messages as read
    socket.on("message:read", async (payload, ack) => {
      try {
        await messages.markConversationRead(
          user.id,
          payload.conversationId,
          payload.messageId
        );

        io.to(conversationRoom(payload.conversationId)).emit(
          "message:read",
          {
            conversationId: payload.conversationId,
            userId: user.id,
            messageId: payload.messageId,
            readAt: new Date().toISOString(),
          }
        );

        ack?.({ ok: true });
      } catch (error) {
        ack?.(errorPayload(error));
      }
    });

    // Typing start
    socket.on("typing:start", async (conversationId, ack) => {
      try {
        await requireMember(user.id, conversationId);

        socket
          .to(conversationRoom(conversationId))
          .emit("typing:update", {
            conversationId,
            userId: user.id,
            name: user.name,
            typing: true,
          });

        ack?.({ ok: true });
      } catch (error) {
        ack?.(errorPayload(error));
      }
    });

    // Typing stop
    socket.on("typing:stop", async (conversationId, ack) => {
      try {
        await requireMember(user.id, conversationId);

        socket
          .to(conversationRoom(conversationId))
          .emit("typing:update", {
            conversationId,
            userId: user.id,
            name: user.name,
            typing: false,
          });

        ack?.({ ok: true });
      } catch (error) {
        ack?.(errorPayload(error));
      }
    });

    // Remove group member
    socket.on("group:remove-member", async (payload, ack) => {
      try {
        await conversations.removeMember(
          user.id,
          payload.conversationId,
          payload.userId
        );

        const targetSockets = userSockets.get(payload.userId);

        targetSockets?.forEach((socketId) => {
          io.sockets.sockets
            .get(socketId)
            ?.leave(conversationRoom(payload.conversationId));
        });

        io.to(conversationRoom(payload.conversationId)).emit(
          "member:removed",
          {
            conversationId: payload.conversationId,
            userId: payload.userId,
          }
        );

        io.to(userRoom(payload.userId)).emit(
          "conversation:removed",
          {
            conversationId: payload.conversationId,
          }
        );

        ack?.({ ok: true });
      } catch (error) {
        ack?.(errorPayload(error));
      }
    });

    // Disconnect
    socket.on("disconnect", async () => {
      const sockets = userSockets.get(user.id);

      sockets?.delete(socket.id);

      if (sockets && sockets.size === 0) {
        userSockets.delete(user.id);

        await query(
          `UPDATE users
           SET last_seen_at = NOW()
           WHERE id = $1`,
          [user.id]
        );

        io.emit("presence:update", {
          userId: user.id,
          online: false,
          lastSeenAt: new Date().toISOString(),
        });
      }

      socketUsers.delete(socket.id);
    });
  });
}

async function requireMember(userId, conversationId) {
  const membership = await getMembership(userId, conversationId);

  if (!membership) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You are not a member of this conversation"
    );
  }

  return membership;
}

function errorPayload(error) {
  if (error instanceof AppError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: "BAD_REQUEST",
      message:
        error instanceof Error ? error.message : "Request failed",
    },
  };
}

function sendMessageSchema(payload) {
  if (
    !payload ||
    typeof payload.conversationId !== "string" ||
    typeof payload.clientMessageId !== "string" ||
    typeof payload.content !== "string"
  ) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Invalid message payload"
    );
  }

  if (
    payload.content.trim().length === 0 ||
    payload.content.length > 5000
  ) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Message must contain 1-5000 characters"
    );
  }

  return {
    conversationId: payload.conversationId,
    clientMessageId: payload.clientMessageId,
    content: payload.content.trim(),
  };
}

module.exports = {
  setupSocket,
};