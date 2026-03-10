
import { GoogleGenAI } from "@google/genai";

const apiKey = "AIzaSyDDz-PbHcYEd1ZyvEN8llZjvJPRMAKUIYk"; 
const ai = new GoogleGenAI({ apiKey });

async function list() {
  try {
    console.log("Listing models...");
    const response = await ai.models.list();
    console.log("Models found:");
    // The structure might be response.models or similar
    if (response.models) {
        response.models.forEach(m => console.log(m.name));
    } else {
        console.log(JSON.stringify(response, null, 2));
    }
  } catch (e) {
    console.error("Failed to list models:", e.message);
    if(e.response) console.error(JSON.stringify(e.response, null, 2));
  }
}

list();
