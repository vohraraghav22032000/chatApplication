const {  Router  } = require("express");
const {  z  } = require("zod");
const {  asyncHandler  } = require("../middleware/async");
const {  requireAuth  } = require("../middleware/auth");
const {  AuthRequest  } = require("../types");
const users = require("../services/users");

const router = Router();
router.use(requireAuth);

router.get("/search", asyncHandler(async (req, res) => {
  const q = z.string().min(1).max(100).parse(req.query.q);
  res.json({ users: await users.searchUsers(req.user.id, q) });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  res.json({ user: await users.getUser(req.params.id) });
}));

module.exports = router;
