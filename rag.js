// RAG --> Retrieval Augmented Generation

/*

Problem Statement: Create a Chatbot as your girlfiend

- system configure / context --> behave as my girlfriend

- What my gf likes to wear?
- What my gf likes to eat?

==> It won't be able to answer these questions because it doesn't have any context about your girlfriend. It will halucinate and give random answers.

What is Hallucination?

- It is a phenomenon where the model generates information that is not based on the input or context. Like even if you don't know the answer of a question in your exam, you will write something random -- In a hope to get marks. This is called hallucination in AI.

What is fine-tuning?

- Fine-tuning is the process of taking a pre-trained model and training it further on a specific dataset to make it more suitable for a particular task. In this case, you would fine-tune the model on a dataset that contains information about your girlfriend's preferences, interests, and personality traits
so that it can generate more accurate and relevant responses.

-- But fine-tuning is not always the best solution because:

- It requires a lot of data about your girlfriend.
- It requires a lot of computational resources.
- It is time-consuming and expensive. (Uses a lot of Tokens which costs money)

How to solve this problem?

- Use RAG (Retrieval Augmented Generation) to provide context to the model.

- RAG is a technique that combines the power of retrieval and generation to provide context to the model. It retrieves relevant information from a knowledge base or database and uses it to generate responses.

- In this case, you would create a knowledge base or database that contains information about your girlfriend's preferences, interests, and personality traits. Then, you would use RAG to retrieve relevant information from the knowledge base and use it to generate responses.

- This way, you can provide context to the model without having to fine-tune it.

- Now very less tokens will be used because you are pulling just the relevant information from the knowledge base and not the entire dataset.

====

chunk the entire doc --> convert the chunks to vectors ( ) --> store them in a vector db

convert user query to vector --> search the vector db for similar vectors (top 3/4 etc) --> get the chunks of text that are similar to the user query (Semantic search) --> use these chunks as context for the model to generate a response.

==== summary ====

setp 1 : split the document into chunks (using a library like langchain)

step 2 : convert the chunks to vectors (using a library like langchain)

step 3 : store the vectors in a vector database (like Pinecone, Weaviate, etc.)

// step 1-3 is called indexing - need to be done only once

// query phase / Retrieval Phase :-

step 4 : convert the user query to a vector (using the same library)

step 5 : search the vector database for similar vectors (using the same library)

step 6 : get the top 3/4 chunks of text that are similar to the user query (using the same library)

step 7 : use these 3/4 chunks as context for the model (using the same library) --> Augment

step 8 : generate the response using the llm model --> Generation


/*
We will use pinecone as the vector database (free - need to sign up for an account) and langchain to handle the vectorization and retrieval process.

use 768 dimension for the vector embeddings. These are the diemnsions of the vector embeddings that will be used to represent the chunks of text.

we will use google gemini as the llm model to generate the response. (Free version)

// We will use the google gemini flash api to generate the response. (free upto 60k tokens per day)
*/

//get video transcript , convert it to pdf, and then index it in pinecone

import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { Pinecone } from "@pinecone-database/pinecone";
import { PineconeStore } from "@langchain/pinecone";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

// phase-1 -> Indexing

/* 

langchain has prebuilt functions to handle the vectorization and retrieval process

langchain was originally built for python, but now it has a javascript version as well. That is langchain.js

Embeddding models are used to convert text into vectors. These vectors are then stored in a vector database like Pinecone. we can use google gemini embedding model to convert the text into vectors. but we will use langchain.js to handle the vectorization and retrieval process.

*/

//load pdf to code

export async function indexDocument() {
  const PDF_DIR = "./youtube_pdf";

  // Step 1: Automatically find the only PDF file in the folder
  const files = fs.readdirSync(PDF_DIR);
  const pdfFile = files.find((file) => file.toLowerCase().endsWith(".pdf"));

  if (!pdfFile) {
    throw new Error("No PDF file found in youtube_pdf folder.");
  }

  const PDF_PATH = path.join(PDF_DIR, pdfFile);
  console.log("📄 Found PDF:", pdfFile);
  const pdfLoader = new PDFLoader(PDF_PATH);
  const rawDocs = await pdfLoader.load();

  console.log("PDF Loaded...");

  const CHUNK_SIZE = 1000; // Size of each chunk
  const CHUNK_OVERLAP = 200; // Overlap between chunks

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
  // chunk the pdf into smaller chunks
  const chunkedDocs = await textSplitter.splitDocuments(rawDocs);

  console.log("Chunking Done...");

  // -------------- CHUNKING DONE --------------

  // Now we can convert these chunks to vectors and store them in Pinecone

  // convert the chunks to vectors
  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GEMINI_API_KEY,
    model: "text-embedding-004",
  });

  console.log("Embeddding Model Configured...");
  // store the vectors in pinecone
  const pinecone = new Pinecone();
  const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);

  console.log("Pinecone Configured...");

  //langchain (chunking,embedding, and storing in db  )

  await PineconeStore.fromDocuments(chunkedDocs, embeddings, {
    pineconeIndex,
    maxConcurrency: 5, // vectorise and store by 5-5 each at a time (free tier has rate limiting)
  });

  console.log("Data loaded successfully...");
}
