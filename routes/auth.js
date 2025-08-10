// src/routes/auth.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { UserModel } from "../models/User.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "replace_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d"; // token lifetime
const COOKIE_NAME = process.env.COOKIE_NAME || "nt_auth";

// helper: create token
function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Signup
router.post("/signup", async (req, res) => {
  try {
    const { name, githubUsername, password } = req.body;
    if (!name || !githubUsername || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const existing = await UserModel.findOne({ githubUsername });
    if (existing) {
      return res.status(409).json({ error: "GitHub username already taken" });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const user = await UserModel.create({ name, githubUsername, passwordHash });

    const token = createToken({ id: user._id, name: user.name });
    // set cookie
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "none", // or "strict" if desired
      secure: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // match JWT_EXPIRES_IN (7 days)
    });

    return res.status(201).json({ message: "User created", user: { id: user._id, name: user.name, githubUsername: user.githubUsername } });
  } catch (err) {
    console.error("Signup error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Signin
router.post("/signin", async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: "Missing fields" });

    // allow signin by name or githubUsername if you prefer; here we match githubUsername OR name
    const user = await UserModel.findOne({ $or: [{ githubUsername: name }, { name }] });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = createToken({ id: user._id, name: user.name });
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "none", // or "strict" if desired
      secure: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // match JWT_EXPIRES_IN (7 days)
    });

    return res.json({ message: "Signed in", user: { id: user._id, name: user.name, githubUsername: user.githubUsername } });
  } catch (err) {
    console.error("Signin error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Signout
router.post("/signout", (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
  });
  return res.json({ message: "Signed out" });
});

// Get current user
router.get("/me", async (req, res) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const payload = jwt.verify(token, JWT_SECRET);
    // payload contains { id, name, iat, exp }
    const user = await UserModel.findById(payload.id).select("-passwordHash");
    if (!user) return res.status(401).json({ error: "User not found" });

    return res.json({ user });
  } catch (err) {
    console.error("Me error:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
});

export default router;
