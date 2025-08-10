import { generateTranscriptPDF } from "./runfullPipeline.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { indexDocument } from "./rag.js";
import { resolveUserQuery } from "./query.js";
import fs from "fs";
import path from "path";
import yts from "yt-search"; // ✅ Replacing youtube-search-python
import mongoose from "mongoose"; // ✅ For MongoDB
import { fileURLToPath } from "url";

import cookieParser from "cookie-parser";
import authRouter from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
dotenv.config();

const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: ["http://localhost:5173", "https://neotutor.swagcoder.in"], // frontend URL
    credentials: true, // allow cookies to be sent
  })
);

app.use(express.json());
// ... after app.use(express.json());
app.use(cookieParser());
// mount auth routes
app.use("/api/auth", authRouter);

// ✅ MongoDB Schema & Model
export const ChannelSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  instanceId: { type: String, required: true },
  channelData: { type: Object, required: true },
});

export const ChannelModel = mongoose.model("Channel", ChannelSchema);

// POST endpoint
app.post("/generate-pdf", requireAuth, async (req, res) => {
  const { channelUrl, noOfVideos } = req.body;

  if (!channelUrl || !noOfVideos) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (isNaN(noOfVideos) || noOfVideos <= 0) {
    return res.status(400).json({ error: "Invalid number of videos" });
  }

  if (noOfVideos > 10) {
    return res.status(400).json({ error: "Maximum number of videos is 10" });
  }

  try {
    const pdfPath = await generateTranscriptPDF({
      channelUrl,
      maxVideos: Number(noOfVideos),
    });

    return res.status(200).json({
      message: "✅ PDF generated successfully",
      pdfPath,
    });
  } catch (err) {
    console.error("❌ Error generating PDF:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/create-vectors", requireAuth, async (req, res) => {
  try {
    //vectorize & store

    await indexDocument(req.user.id);

    // Step 2: Read JSON file
    const filePath = path.join(
      __dirname,
      "youtube_json",
      "youtube_videodata.json"
    );
    const fileData = fs.readFileSync(filePath, "utf-8");
    const jsonArray = JSON.parse(fileData);

    const firstVideo = jsonArray[0];

    // ✅ Use yt-search to get channel info
    const result = await yts({ query: firstVideo.channelUrl, type: "channel" });

    if (!result.channels.length) {
      return res.status(404).json({ error: "Channel not found" });
    }

    const { name: title, image: icon } = result.channels[0];

    return res.status(200).json({
      message: "✅ Vectors generated & stored successfully",
      title,
      icon,
    });
  } catch (error) {
    console.error("Error while vectorization : ", error);
    return res.status(500).json({ error: "Error while vectorization!" });
  }
});

app.post("/query", requireAuth, async (req, res) => {
  try {
    const { userQuery, instanceId } = req.body;
    const response = await resolveUserQuery(userQuery, instanceId);

    return res.status(200).json({
      message: response,
    });
  } catch (error) {
    console.error("Error while querying the db :", error);

    return res.status(500).json({
      error: "Error while querying the db!",
    });
  }
});

app.get("/channel-logo/:handle", requireAuth, async (req, res) => {
  const { handle } = req.params;

  try {
    // yt-search works with both @handles and channel names
    const result = await yts({ query: handle, type: "channel" });

    if (result.channels.length > 0) {
      const { image: logoUrl } = result.channels[0];
      return res.json({ logoUrl });
    } else {
      return res.json({ logoUrl: "/default-logo.png" });
    }
  } catch (err) {
    console.error("❌ Error fetching channel logo:", err);
    res.status(500).json({ logoUrl: "/default-logo.png" });
  }
});

// ✅ History Endpoint - Returns user-specific stored channels only
app.get("/history", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id; // Assuming requireAuth sets req.user

    // Find channels only for the logged-in user
    const history = await ChannelModel.find({ userId }).sort({ _id: -1 });

    return res.status(200).json(history);
  } catch (error) {
    console.error("❌ Error fetching history:", error);
    return res.status(500).json({ error: "Error fetching history" });
  }
});

// ✅ MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("✅ MongoDB Connected");
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) =>
    console.error("❌ MongoDB Connection Error: Backend Not Running!", err)
  );
