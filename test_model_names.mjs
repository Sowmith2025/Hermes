
import { GoogleGenAI } from "@google/genai";

const apiKey = "AIzaSyDDz-PbHcYEd1ZyvEN8llZjvJPRMAKUIYk"; 
const ai = new GoogleGenAI({ apiKey });

async function runTests() {
  const models = [
    "gemini-1.5-flash",
    "models/gemini-1.5-flash",
    "gemini-1.5-flash-001",
    "models/gemini-1.5-flash-001",
    "gemini-2.0-flash",
    "gemini-2.0-flash-exp",
    "gemini-pro"
  ];

  for (const model of models) {
    process.stdout.write(`Testing ${model}: `);
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      });
      console.log("SUCCESS");
      process.exit(0);
    } catch (e) {
      console.log("FAILED (" + (e.error?.code || e.status || "Check logs") + ")");
      // console.log(e.message.substring(0, 100));
    }
  }
}

runTests();
