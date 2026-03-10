
import { GoogleGenAI } from "@google/genai";

const apiKey = "AIzaSyDDz-PbHcYEd1ZyvEN8llZjvJPRMAKUIYk"; // from .env.local
const client = new GoogleGenAI({ apiKey });

async function runTests() {
  const models = [
    "gemini-1.5-flash",
    "models/gemini-1.5-flash",
    "gemini-2.0-flash-exp",
    "models/gemini-2.0-flash-exp",
    "gemini-pro", 
    "models/gemini-pro"
  ];

  for (const model of models) {
    console.log(`Testing model: ${model}`);
    try {
      const response = await client.models.generateContent({
        model: model,
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      });
      console.log(`SUCCESS: ${model}`);
      return; // Exit on first success
    } catch (e) {
      console.log(`FAILED: ${model} -> ${e.message}`);
    }
    console.log("-------------------");
  }
}

runTests();
