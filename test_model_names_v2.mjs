
import { GoogleGenAI } from "@google/genai";

const apiKey = "AIzaSyDDz-PbHcYEd1ZyvEN8llZjvJPRMAKUIYk"; 
const ai = new GoogleGenAI({ apiKey });

async function runTests() {
  const models = [
    "gemini-1.5-flash",
    "gemini-1.5-flash-001",
    "gemini-1.5-flash-002",
    "gemini-2.0-flash-exp",
    "gemini-pro"
  ];

  for (const model of models) {
    try {
      console.log(`Trying ${model}...`);
      await ai.models.generateContent({
        model: model,
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      });
      console.log(`SUCCESS: ${model}`);
      process.exit(0);
    } catch (e) {
      console.log(`FAILED: ${model} -> Status: ${e.status || e.code || 'Unknown'}`);
    }
  }
}

runTests();
