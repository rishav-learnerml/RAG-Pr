import { ApifyClient } from "apify-client";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";
import { glob } from "glob"; // if not using already

dotenv.config();

const __dirname = path.resolve();

const transcriptsDir = path.join(__dirname, "youtube_transcripts");
const audioDir = path.join(__dirname, "youtube_audio");
const pdfDir = path.join(__dirname, "youtube_pdf");
const jsonDir = path.join(__dirname, "youtube_json");

// Sanitize title and append unique ID (video ID or timestamp)
function sanitizeTitle(title, uniqueId) {
  const sanitized = title.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
  return `${sanitized}_${uniqueId}`;
}

function getDurationInMinutes(durationStr) {
  const parts = durationStr.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

// Fetch video metadata
async function fetchVideoMetadata(client, channelUrl, maxVideos) {
  const input = {
    maxResultStreams: 0,
    maxResults: maxVideos,
    maxResultsShorts: 0,
    startUrls: [{ url: channelUrl }],
  };

  const run = await client.actor("67Q6fmd8iedTVcCwY").call(input, {
    waitSecs: 60,
  });

  const allItems = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const { items } = await client.dataset(run.defaultDatasetId).listItems({
      offset,
      limit,
      clean: true,
    });
    if (items.length === 0) break;
    allItems.push(...items);
    offset += items.length;
    if (allItems.length >= maxVideos) break;
  }

  const finalItems = allItems.slice(0, maxVideos);

  fs.writeFileSync(
    path.join(jsonDir, "youtube_videodata.json"),
    JSON.stringify(finalItems, null, 2)
  );
  console.log(`✅ Saved metadata for ${finalItems.length} videos`);
  return finalItems;
}

// Download + transcribe using whisper

async function transcribeWithWhisper(video) {
  console.log(video, "vvvvvvvvvvvvvvvvvvvv");
  const videoId = video.id || video.url.split("v=")[1] || Date.now().toString();
  const sanitized = sanitizeTitle(video.title, videoId);
  const audioOutputTemplate = path.join(audioDir, `${sanitized}.%(ext)s`);

  // First download
  execSync(
    `yt-dlp -x --audio-format mp3 -o "${audioOutputTemplate}" https://www.youtube.com/watch?v=${video.id}`,

    { stdio: "inherit" }
  );

  // Find actual downloaded audio file
  const audioFiles = glob.sync(path.join(audioDir, `${sanitized}.*`));
  if (audioFiles.length === 0) {
    console.error(`❌ Audio file not found for: ${sanitized}`);
    return null;
  }

  const audioPath = audioFiles[0]; // take the first match
  console.log(`✅ Using audio file: ${audioPath}`);

  try {
    console.log(`🧠 Transcribing: ${sanitized}`);
    execSync(
      `whisper "${audioPath}" --model base --output_format txt --output_dir "${transcriptsDir}"`,
      { stdio: "inherit" }
    );

    const transcriptPath = path.join(transcriptsDir, `${sanitized}.txt`);
    if (!fs.existsSync(transcriptPath)) {
      throw new Error(`Transcript not found: ${transcriptPath}`);
    }

    console.log(`✅ Transcribed: ${sanitized}.txt`);
    return sanitized;
  } catch (err) {
    console.error(`❌ Failed for video: ${video.title}`, err.message || err);
    return null;
  }
}

// Generate PDF
function generatePDF(videos, outputPdfPath) {
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  doc.pipe(fs.createWriteStream(outputPdfPath));

  let addedCount = 0;

  videos.forEach((video, index) => {
    const transcriptPath = path.join(transcriptsDir, `${video.sanitized}.txt`);
    if (!fs.existsSync(transcriptPath)) {
      console.warn(`⚠️ Transcript missing for: ${video.title}`);
      return;
    }

    const transcript = fs.readFileSync(transcriptPath, "utf-8");

    doc.fontSize(16).fillColor("blue").text(video.title, {
      link: video.url,
      underline: true,
    });
    doc.moveDown(0.3);

    doc.fontSize(10).fillColor("black").text(video.url);
    doc.moveDown(0.5);

    doc.fontSize(12).fillColor("black").text(transcript, { align: "left" });

    if (index < videos.length - 1) {
      doc.addPage();
    }

    addedCount++;
  });

  doc.end();

  if (addedCount === 0) {
    console.warn("🚫 No valid transcripts found. Empty PDF generated.");
  } else {
    console.log(`📄 PDF saved at: ${outputPdfPath}`);
  }
}

// Main function
export async function generateTranscriptPDF({ channelUrl, maxVideos }) {
  // Ensure folders exist
  const dirs = [transcriptsDir, audioDir, pdfDir, jsonDir];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    else {
      // Clean contents
      fs.readdirSync(dir).forEach((file) => {
        const filePath = path.join(dir, file);
        if (fs.lstatSync(filePath).isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
      });
    }
  });

  const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
  const outputPdfPath = path.join(pdfDir, `transcript_${Date.now()}.pdf`);

  const videos = await fetchVideoMetadata(client, channelUrl, maxVideos);

  const filteredVideos = [];
  for (const video of videos) {
    const sanitized = await transcribeWithWhisper(video);
    if (sanitized) filteredVideos.push({ ...video, sanitized });
  }

  if (filteredVideos.length === 0) {
    console.warn("❗ No successful transcriptions. Skipping PDF generation.");
    return null;
  }

  generatePDF(filteredVideos, outputPdfPath);
  return outputPdfPath;
}
