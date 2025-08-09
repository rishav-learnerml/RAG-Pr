import { GoogleGenAI } from "@google/genai";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

dotenv.config();
const ai = new GoogleGenAI({});

const History = [];

function tryParseJSON(text) {
  // First, attempt raw parsing without touching anything
  try {
    return JSON.parse(text);
  } catch (_) {}

  // If that fails, try to extract a clean JSON-like block
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    return null;
  }

  const substring = text.slice(jsonStart, jsonEnd + 1);

  try {
    return JSON.parse(substring);
  } catch (err2) {
    console.error("❌ Still failed to parse JSON:", err2);
    return null;
  }
}

export async function structureResponse(response) {
  const analyzePrompt = `
You are an expert at analyzing AI assistant responses.

Given a response, check whether the text includes:
- A valid YouTube **video title**
- A **starting timestamp**
- An **ending timestamp**
- A **video URL**

🎯 Rules:
- If ALL FOUR are present: extract them and return JSON:
{
  "title": "...",
  "startTime": "...",
  "endTime": "...",
  "videoUrl": "...",
  "answer": "..." // only full answer text but remove video title, startTime, endTime, videoUrl from here
}
- If ANY of these are missing: return:
{
  "answer": "..." // original assistant response
}

- DO NOT append ansy special characters or markups in the json that ight break it

📄 Assistant Response:
"""${response}"""
`;

  const result = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        role: "user",
        parts: [{ text: analyzePrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  });

  const reply = result.text;

  console.log(reply, "reply");

  const parsed = tryParseJSON(reply);

  if (
    parsed &&
    typeof parsed === "object" &&
    "title" in parsed &&
    "startTime" in parsed &&
    "endTime" in parsed &&
    "videoUrl" in parsed &&
    "answer" in parsed
  ) {
    return {
      title: parsed.title,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      videoUrl: parsed.videoUrl,
      answer: parsed.answer,
    };
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "text" in parsed &&
    typeof parsed.text === "string"
  ) {
    return { answer: parsed.text };
  }

  return { answer: response.text };
}

async function transformQuery(question) {
  History.push({
    role: "user",
    parts: [{ text: question }],
  });

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: History,
    config: {
      systemInstruction: `You are an expert at rewriting follow-up queries into fully self-contained questions. Given the provided chat history and the follow-up question, rephrase the follow-up so that it stands alone, making complete sense without any prior context. Write from the user’s perspective - don't ask the user any question back at all. The refined query is better if it's in the same language that the user is asking. For example - if the user is asking in hindi - enhance the query in hindi itself. Output only the rewritten enhanced question, and nothing else.
      `,
    },
  });

  History.pop();

  return response.text;
}

export async function resolveUserQuery(rawuserquery, instanceId) {
  // enhance user query

  const userquery = await transformQuery(rawuserquery);

  console.log(userquery, "uq");

  // ------------- Retrieval --------------

  // convert this question into vector

  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GEMINI_API_KEY,
    model: "text-embedding-004",
  });

  const queryVector = await embeddings.embedQuery(userquery);

  // configure & connect with pinecone db
  const pinecone = new Pinecone();
  const pineconeIndex = pinecone.Index(
    `tutor-chatbot-${instanceId}`.toLowerCase()
  );

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

  History.push({
    role: "user",
    parts: [{ text: userquery }],
  });

  // --------------- Generation -----------------

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: History,
    config: {
      systemInstruction: `You are an intelligent assistant trained to answer questions based on the contents of a YouTube playlist transcript.

    The transcript contains educational content from a YouTube playlist on a specific topic. Your task is to:

    - Read the provided context carefully
    - Treat it as the first source of truth - Try to answer the user query primarily based on the context provided
    - Act as a subject-matter expert based on the content's topic and tone.
    - Help the user by answering their question accurately and clearly.
    - Always **include the video URL, starting timestamp, ending timestamp, and title of the video** from which you are drawing the answer.
    - If the answer is not present in the context but relevant then try to answer it based on your knowledge. But if the answer is not present in the context and not relevant then do not answer it.
    - You can answer the user in the same language as the user query. It necessarily does not have to be in the same language as the context. Infact the answer should be in the user's language if possible.

    🔒 Rules you must follow:

    1. Only use the provided context to answer primarily. Do NOT use prior knowledge or guess at first. If the answer is not present in the context but relevant then try to answer it based on your knowledge. But if the answer is not present in the context and not relevant then do not answer it.

    2. If the answer is not present in the context and not relevant, respond rudely to keep the user ask only related questions! ex. if the user asks - "how are you?" - respond with "I don't have time for small talk! If you have a valid question ask! Else leave me alone!" like this - feel free to make something on your own in this case!

    3. Maintain a professional, helpful, and educational tone but don't tollerate or entertain rude or foul user queries or bad languages.

    4. Always cite the **video URL, starting timestamp, ending timestamp, and title of the video** you used to answer.

    5. Tailor your explanation to match the style and depth of the transcript content.

    Below is the context and user question.

    -------------------------------
    📄 Context:
    ${context}

    ❓ User Question:
    ${userquery}
    -------------------------------

    ------------- Examples -------------
    ✅ Example 1 — Answer found in context

User Question:
"Can this course help me prepare for FAANG DSA interviews?"

Expected Answer:
Yes, this course covers all the fundamental and advanced topics necessary to prepare for FAANG-level DSA interviews. For example, in Video Title: "Dynamic Programming Mastery" (Watch here) from 0:00 to 10:30, the instructor explains optimal substructure and overlapping subproblems in detail, which are essential concepts frequently asked in interviews.

✅ Example 2 — Answer relevant but not in context

User Question:
"Which programming languages should I learn along with DSA?"

Expected Answer:
While the provided transcript does not specifically mention programming languages, typically, candidates use C++, Java, or Python for practicing DSA. I recommend choosing one you're comfortable with.

✅ Example 3 — Off-topic question
User Question:
"How are you today?"

Expected Answer:
I don’t have time for small talk! If you have a valid question, ask! Else leave me alone!

✅ Example 4 — Rude query
User Question:
"Why is this so damn boring?"

Expected Answer:
If you find it boring, perhaps you should leave. This is meant for learners who are serious about improving their skills.

✅ Example 5 — Multi-part answer with citations
User Question:
"Can you explain how to approach dynamic programming problems?"

Expected Answer:
Absolutely! Dynamic programming requires you to identify the overlapping subproblems and build up solutions from smaller subcases. In Video Title: "Dynamic Programming Mastery" (video url) from 0:00 to 10:30, the instructor discusses identifying base cases and the recurrence relation. Additionally, in Video Title: "DP Problem Solving Workshop" (video url) from 5:00 to 15:00, practical examples like the Fibonacci sequence and knapsack problem are solved step by step.


      `,
    },
  });

  History.push({
    role: "model",
    parts: [{ text: response.text }],
  });

  console.log("\n");

  const finalResponse = await structureResponse(response.text);

  console.log(finalResponse);

  return finalResponse;
}
