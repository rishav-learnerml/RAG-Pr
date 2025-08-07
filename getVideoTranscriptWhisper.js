const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load videos
const videos = require('./videodata.json');

// Temp folder
const audioDir = './audio';
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);

async function transcribeWithWhisper(videoId, title) {
  const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
  const outputAudioPath = path.join(audioDir, `${sanitizedTitle}.mp3`);

  console.log(`🎥 Downloading audio for: ${title}`);
  try {
    execSync(`yt-dlp -x --audio-format mp3 -o "${outputAudioPath}" https://www.youtube.com/watch?v=${videoId}`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`❌ Failed to download audio for: ${videoId}`);
    return null;
  }

  console.log(`🧠 Transcribing with Whisper: ${sanitizedTitle}`);
  try {
    execSync(`whisper "./transcripts/${outputAudioPath}" --model base --output_format txt`, { stdio: 'inherit' });
    const txtFile = `${outputAudioPath}.txt`;
    return fs.readFileSync(txtFile, 'utf8');
  } catch (err) {
    console.error(`❌ Whisper transcription failed for: ${videoId}`);
    return null;
  }
}

async function run() {
  for (const video of videos) {
    const transcript = await transcribeWithWhisper(video.id, video.title);
    if (transcript) {
      fs.writeFileSync(`./transcripts/${video.id}.txt`, transcript);
      console.log(`✅ Saved transcript for: ${video.title}`);
    }
  }
}

run();
