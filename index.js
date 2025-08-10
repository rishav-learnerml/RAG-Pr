import { generateTranscriptPDF } from "./runfullPipeline.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { indexDocument } from "./rag.js";
import { resolveUserQuery } from "./query.js";
import fs from "fs";
import path from "path";
import yts from "yt-search";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import authRouter from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";
import ffmpeg from "fluent-ffmpeg";
import axios from "axios";
import { VoiceModel } from "./models/Voice.js";

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

app.use("/audio", express.static(path.join(__dirname, "youtube_audio")));

function convertMp3ToWav(mp3Filename) {
  return new Promise((resolve, reject) => {
    const mp3Path = path.join(__dirname, "youtube_audio", mp3Filename);
    if (!fs.existsSync(mp3Path)) {
      return reject(new Error("MP3 file not found"));
    }
    const wavFilename = mp3Filename.replace(/\.mp3$/i, ".wav");
    const wavPath = path.join(__dirname, "youtube_audio", wavFilename);

    ffmpeg(mp3Path)
      .outputOptions(["-ar 44100", "-ac 1", "-f wav"])
      .save(wavPath)
      .on("end", () => resolve(wavFilename))
      .on("error", (err) => reject(err));
  });
}

// Resemble.ai helper functions
const RESEMBLE_API_KEY = process.env.RESEMBLE_API_KEY;
const RESEMBLE_API_URL = "https://app.resemble.ai/api/v2";

async function createOrGetVoice(voiceName, datasetUrl) {
  // Optional: Search existing voices by name first (not shown here for brevity)
  // For demo, just create new voice every time (consider caching in prod)
  const res = await axios.post(
    `${RESEMBLE_API_URL}/voices`,
    {
      name: voiceName,
      voice_type: "rapid",
      dataset_url: datasetUrl,
    },
    {
      headers: { Authorization: `Bearer ${RESEMBLE_API_KEY}` },
    }
  );
  return res.data.item; // { uuid, status, ... }
}

async function synthesizeSpeech(voiceUuid, text) {
  const res = await axios.post(
    "https://f.cluster.resemble.ai/synthesize",
    {
      voice_uuid: voiceUuid,
      data: text,
      sample_rate: 48000,
      output_format: "wav",
    },
    {
      headers: {
        Authorization: `Bearer ${RESEMBLE_API_KEY}`,
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip, deflate, br",
      },
    }
  );
  return res.data; // contains audio_content (base64)
}

// ✅ MongoDB Schema & Model
export const ChannelSchema = new mongoose.Schema({
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

    await indexDocument();

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

    if (!instanceId) {
      return res.status(400).json({ error: "instanceId is required" });
    }

    // 1. Resolve text query
    const textResponse = await resolveUserQuery(userQuery, instanceId);

    // 2. Look up voice in DB by instanceId
    let voiceRecord = await VoiceModel.findOne({ instanceId });

    if (!voiceRecord) {
      // First time: create voice

      // Read first mp3 file
      const audioDir = path.join(__dirname, "youtube_audio");
      const files = fs
        .readdirSync(audioDir)
        .filter((file) => file.toLowerCase().endsWith(".mp3"));

      if (files.length === 0) {
        return res
          .status(500)
          .json({ error: "No audio file found in youtube_audio folder" });
      }

      const sampleAudioFile = files[0];

      // Convert to WAV
      let wavFilename;
      try {
        wavFilename = await convertMp3ToWav(sampleAudioFile);
      } catch (convErr) {
        console.error("MP3->WAV conversion failed:", convErr);
        return res.status(500).json({ error: "Audio conversion failed" });
      }

      const datasetUrl = `https://api.neotutor.swagcoder.in/youtube_audio/${wavFilename}`;

      let voice;
      try {
        voice = await createOrGetVoice("Neotutor Custom Voice", datasetUrl);
      } catch (voiceErr) {
        console.error("Voice creation failed:", voiceErr);
        return res.status(500).json({ error: "Voice creation failed" });
      }

      // Save voice info to DB
      voiceRecord = new VoiceModel({
        instanceId,
        voiceUuid: voice.uuid,
        status: voice.status,
      });
      await voiceRecord.save();

      if (voice.status !== "ready") {
        return res.status(202).json({
          message: textResponse,
          info: "Voice training in progress, please try again shortly.",
        });
      }
    } else if (voiceRecord.status !== "ready") {
      // Voice exists but training still in progress
      return res.status(202).json({
        message: textResponse,
        info: "Voice training in progress, please try again shortly.",
      });
    }

    // 3. Voice is ready — synthesize speech
    let speechData;
    try {
      speechData = await synthesizeSpeech(voiceRecord.voiceUuid, textResponse);
    } catch (synthErr) {
      console.error("Speech synthesis failed:", synthErr);
      return res.status(500).json({ error: "Speech synthesis failed" });
    }

    // 4. Return text and audio
    return res.status(200).json({
      text: textResponse,
      audioBase64: speechData.audio_content,
    });
  } catch (error) {
    console.error("Error in /query:", error);
    return res.status(500).json({ error: "Internal server error" });
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

// ✅ History Endpoint - Returns all stored channels
app.get("/history", requireAuth, async (req, res) => {
  try {
    const history = await ChannelModel.find().sort({ _id: -1 });
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
