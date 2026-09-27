const express = require("express");
const { asyncHandler } = require("../middleware/async");
const auth = require("../services/auth");

const router = express.Router();

router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const result = await auth.signup(
      req.body.email,
      req.body.password,
      req.body.name
    );

    res.status(201).json(result);
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const result = await auth.login(
      req.body.email,
      req.body.password
    );

    if (result.refreshToken) {
      res.cookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
    }

    res.json({
      user: result.user,
      accessToken: result.accessToken,
    });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Refresh token is missing",
        },
      });
    }

    const result = await auth.refresh(refreshToken);

    res.cookie("refreshToken", result.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      user: result.user,
      accessToken: result.accessToken,
    });
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      await auth.logout(refreshToken);
    }

    res.clearCookie("refreshToken");

    res.json({
      ok: true,
    });
  })
);

module.exports = router;