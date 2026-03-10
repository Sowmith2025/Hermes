
import { GoogleGenAI } from "@google/genai";

// Mock API key for testing - I will rely on the environment variable or a placeholder if I can't read it safely. 
// But wait, I can read the env file content earlier.
const apiKey = process.env.GEMINI_API_KEY || "AIzaSyDDz-PbHcYEd1ZyvEN8llZjvJPRMAKUIYk"; 

const ai = new GoogleGenAI({ apiKey });

async function testConnection() {
  console.log("Testing connection with thinkingConfig...");
  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      config: {
        thinkingConfig: {
          includeThoughts: true,
        },
      },
    });
    console.log("Success with thinkingConfig!");
    console.log(response);
  } catch (error) {
    console.error("Failed with thinkingConfig:", error.message);
  }

  console.log("\nTesting connection WITHOUT thinkingConfig...");
  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    });
    console.log("Success WITHOUT thinkingConfig!");
    // console.log(JSON.stringify(response, null, 2));
  } catch (error) {
    console.error("Failed WITHOUT thinkingConfig:", error.message);
  }
}

testConnection();
