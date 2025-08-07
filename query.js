import { GoogleGenAI } from "@google/genai";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

dotenv.config();

export async function resolveUserQuery(userquery) {
  // ------------- Retrieval --------------

  // convert this question into vector

  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GEMINI_API_KEY,
    model: "text-embedding-004",
  });

  const queryVector = await embeddings.embedQuery(userquery);

  // configure & connect with pinecone db
  const pinecone = new Pinecone();
  const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);

  // query from pinecone
  const searchResults = await pineconeIndex.query({
    topK: 10,
    vector: queryVector,
    includeMetadata: true,
  });

  // -------- Augment ------------

  // get the text of the top 10 matches from the metadata to augment to the llm as context

  const context = searchResults.matches
    .map((match) => match.metadata.text)
    .join("\n\n---\n\n");

  const ai = new GoogleGenAI({});
  const History = [];

  History.push({
    role: "user",
    parts: [{ text: userquery }],
  });

  // --------------- Generation -----------------

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: History,
    config: {
      systemInstruction: `You are an intelligent assistant trained to answer questions based strictly on the contents of a YouTube playlist transcript.

    The transcript contains educational content from a YouTube playlist on a specific topic. Your task is to:

    - Read the provided context carefully
    - Treat it as the only source of truth
    - Act as a subject-matter expert based on the content's topic and tone
    - Help the user by answering their question accurately and clearly

    🔒 Rules you must follow:

    1. Only use the provided context to answer. Do NOT use prior knowledge or guess.
    2. If the answer is not present in the context, respond with:
    ➤ "I could not find the answer in the provided document."
    3. Maintain a professional, helpful, and educational tone.
    4. Tailor your explanation to match the style and depth of the transcript content.

    Below is the context and user question.

    -------------------------------
    📄 Context:
    ${context}

    ❓ User Question:
    ${userquery}
    -------------------------------

      `,
    },
  });

  History.push({
    role: "model",
    parts: [{ text: response.text }],
  });

  console.log("\n");
  console.log(response.text);

  return response.text;
}
