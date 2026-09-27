const {  Router  } = require("express");
const {  z  } = require("zod");
const {  asyncHandler  } = require("../middleware/async");
const {  requireAuth  } = require("../middleware/auth");
const {  AuthRequest  } = require("../types");
const messages = require("../services/messages");

const router = Router();
router.use(requireAuth);

router.patch("/:id", asyncHandler(async (req, res) => {
  const body = z.object({ content: z.string().trim().min(1).max(5000) }).parse(req.body);
  res.json({ message: await messages.editMessage(req.user.id, req.params.id, body.content) });
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  res.json({ message: await messages.deleteMessage(req.user.id, req.params.id) });
}));

router.post("/:id/reactions", asyncHandler(async (req, res) => {
  const body = z.object({
    emoji: z.string().min(1).max(16)
  }).parse(req.body);
  res.json({ message: await messages.addReaction(req.user.id, req.params.id, body.emoji) });
}));

router.delete("/:id/reactions", asyncHandler(async (req, res) => {
  const emoji = z.string().min(1).max(16).parse(req.query.emoji);
  res.json({ message: await messages.removeReaction(req.user.id, req.params.id, emoji) });
}));

module.exports = router;
