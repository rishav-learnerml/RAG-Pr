# Use official Node LTS image with Debian base
FROM node:18-bullseye

# Install Python3, pip, and ffmpeg (required for yt-dlp and whisper)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp globally via pip
RUN pip3 install --upgrade yt-dlp

# (Optional) Install whisper if you use openai whisper python package
# RUN pip3 install --upgrade openai-whisper

# Set working directory inside container
WORKDIR /app

# Copy package.json and package-lock.json (if you have it)
COPY package*.json ./

# Install node dependencies
RUN npm install --legacy-peer-deps

# Copy rest of your project files
COPY . .

# Expose your app port (change if your app uses a different port)
EXPOSE 3000

# Define default command to run your app
CMD ["node", "index.js"]
