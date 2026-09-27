const {  Router  } = require("express");
const {  z  } = require("zod");
const {  asyncHandler  } = require("../middleware/async");
const {  requireAuth  } = require("../middleware/auth");
const {  AuthRequest  } = require("../types");
const conversations = require("../services/conversations");
const messages = require("../services/messages");

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(async (req, res) => {
  res.json({ conversations: await conversations.listConversations(req.user.id) });
}));

router.post("/direct", asyncHandler(async (req, res) => {
  const body = z.object({ userId: z.string().uuid() }).parse(req.body);
  const conversation = await conversations.createDirect(req.user.id, body.userId);
  res.status(201).json({ conversation });
}));

router.post("/group", asyncHandler(async (req, res) => {
  const body = z.object({
    name: z.string().min(1).max(100),
    avatarUrl: z.string().url().nullable().optional()
  }).parse(req.body);
  const conversation = await conversations.createGroup(
    req.user.id,
    body.name,
    body.avatarUrl
  );
  res.status(201).json({ conversation });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  res.json({ conversation: await conversations.getConversation(req.user.id, req.params.id) });
}));

router.get("/:id/messages", asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 30;
  const result = await messages.listMessages(
    req.user.id,
    req.params.id,
    req.query.cursor,
    limit
  );
  res.json(result);
}));

router.post("/:id/read", asyncHandler(async (req, res) => {
  const body = z.object({ messageId: z.string().uuid() }).parse(req.body);
  await messages.markConversationRead(req.user.id, req.params.id, body.messageId);
  res.status(204).send();
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  const body = z.object({
    name: z.string().min(1).max(100).optional(),
    avatarUrl: z.string().url().nullable().optional()
  }).parse(req.body);
  res.json({
    conversation: await conversations.updateGroup(
      req.user.id,
      req.params.id,
      body.name,
      body.avatarUrl
    )
  });
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  await conversations.deleteGroup(req.user.id, req.params.id);
  res.status(204).send();
}));

router.get("/:id/members", asyncHandler(async (req, res) => {
  const conversation = await conversations.getConversation(req.user.id, req.params.id);
  res.json({ members: conversation.members });
}));

router.post("/:id/members", asyncHandler(async (req, res) => {
  const body = z.object({ userIds: z.array(z.string().uuid()).min(1).max(50) }).parse(req.body);
  const members = await conversations.addMembers(req.user.id, req.params.id, body.userIds);
  res.status(201).json({ members });
}));

router.delete("/:id/members/:memberId", asyncHandler(async (req, res) => {
  await conversations.removeMember(req.user.id, req.params.id, req.params.memberId);
  res.status(204).send();
}));

router.patch("/:id/members/:memberId/role", asyncHandler(async (req, res) => {
  const body = z.object({ role: z.enum(["ADMIN", "MEMBER"]) }).parse(req.body);
  const member = await conversations.setRole(
    req.user.id,
    req.params.id,
    req.params.memberId,
    body.role
  );
  res.json({ member });
}));

router.post("/:id/transfer-ownership", asyncHandler(async (req, res) => {
  const body = z.object({ userId: z.string().uuid() }).parse(req.body);
  await conversations.transferOwnership(req.user.id, req.params.id, body.userId);
  res.status(204).send();
}));

module.exports = router;
