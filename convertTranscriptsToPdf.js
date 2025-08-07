const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

// Load your video metadata
const videos = require("./videodata.json");

// Folder with all transcripts
const transcriptsDir = "./transcripts";

// Output PDF
const outputPdf = "youtube_transcripts.pdf";

// Helper: sanitize filename
function sanitizeTitle(title) {
  return title.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
}

// Load transcript text by sanitized title
function getTranscriptBySanitizedTitle(title) {
  const sanitized = sanitizeTitle(title);
  const transcriptFile = path.join(transcriptsDir, `${sanitized}.txt`);
  if (fs.existsSync(transcriptFile)) {
    return fs.readFileSync(transcriptFile, "utf-8");
  }
  return null;
}

function generatePDF() {
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  doc.pipe(fs.createWriteStream(outputPdf));

  videos.forEach((video, index) => {
    const transcriptText = getTranscriptBySanitizedTitle(video.title);

    if (!transcriptText) {
      console.warn(`⚠️ Skipping: No transcript for "${video.title}"`);
      return;
    }

    // Title as link
    doc.fontSize(16).fillColor("blue").text(video.title, {
      link: video.url,
      underline: true,
    });
    doc.moveDown(0.3);

    // URL in plain text
    doc.fontSize(10).fillColor("black").text(video.url);
    doc.moveDown(0.5);

    // Transcript body
    doc.fontSize(12).fillColor("black").text(transcriptText, {
      align: "left",
    });

    // Add a new page if not the last
    if (index < videos.length - 1) {
      doc.addPage();
    }
  });

  doc.end();
  console.log(`✅ PDF created: ${outputPdf}`);
}

generatePDF();
