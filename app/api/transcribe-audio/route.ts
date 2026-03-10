import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY,
});


export async function POST(request: NextRequest) {
    try {
        const { audioBase64, mimeType } = await request.json();

        if (!audioBase64) {
            return NextResponse.json(
                { error: "No audio data provided" },
                { status: 400 }
            );
        }

        const response = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            inlineData: {
                                mimeType: mimeType || "audio/webm",
                                data: audioBase64,
                            },
                        },
                        {
                            text: "Transcribe this audio recording exactly as spoken. Return only the transcribed text, nothing else. If the audio is silent or unclear, return an empty string.",
                        },
                    ],
                },
            ],
        });

        const transcript = response.text?.trim() || "";

        return NextResponse.json({ transcript });
    } catch (error) {
        console.error("Transcription error:", error);
        return NextResponse.json(
            { error: "Failed to transcribe audio" },
            { status: 500 }
        );
    }
}
