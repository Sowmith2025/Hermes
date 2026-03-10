
import { GoogleGenAI } from "@google/genai";

const apiKey = "AIzaSyDDz-PbHcYEd1ZyvEN8llZjvJPRMAKUIYk"; 

const ai = new GoogleGenAI({ apiKey });

async function testConnection() {
  console.log("Testing connection WITHOUT thinkingConfig...");
  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    });
    console.log("Success!");
    console.log(JSON.stringify(response, null, 2));
  } catch (error) {
    console.error("Failed:", error.message);
    if (error.response) {
      console.error("Response:", JSON.stringify(error.response, null, 2));
    }
  }
}

testConnection();
