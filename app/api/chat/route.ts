import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { agentTools, SYSTEM_INSTRUCTION } from "@/lib/agent-tools";
import { toBase64, getMimeType } from "@/lib/image-utils";
import type {
    GeminiContent,
    GeminiPart,
    UploadedFile,
    ToolCallResult,
} from "@/lib/types";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY,
});


// ============================================
// REQUEST/RESPONSE TYPES
// ============================================

type ChatRequestBody = {
    message: string;
    attachments?: UploadedFile[];
    conversationHistory: GeminiContent[];
    projectState?: Record<string, unknown>;
};

type ChatResponseBody = {
    message: string;
    toolCalls?: ToolCallResult[];
    thoughtSummary?: string;
    thoughtSignature?: string;
    updatedHistory: GeminiContent[];
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get MIME type from UploadedFile type
 */
function getMimeTypeFromUploadedFile(file: UploadedFile): string {
    // First, use the file type from UploadedFile
    switch (file.type) {
        case "image":
            // Try to get extension from filename or URL
            const imgExt = file.name.split(".").pop()?.toLowerCase();
            if (imgExt === "png") return "image/png";
            if (imgExt === "gif") return "image/gif";
            if (imgExt === "webp") return "image/webp";
            return "image/jpeg"; // Default to jpeg for images
        case "audio":
            const audioExt = file.name.split(".").pop()?.toLowerCase();
            if (audioExt === "wav") return "audio/wav";
            if (audioExt === "m4a") return "audio/mp4";
            if (audioExt === "ogg") return "audio/ogg";
            return "audio/mpeg"; // Default to mp3
        case "document":
            const docExt = file.name.split(".").pop()?.toLowerCase();
            if (docExt === "pdf") return "application/pdf";
            return "text/plain";
        default:
            return getMimeType(file.url);
    }
}

/**
 * Convert uploaded files to Gemini inline data parts
 * Note: Only images and documents are sent as inline data
 * Audio files are referenced by URL only (not processed inline by text models)
 */
async function convertAttachmentsToParts(
    attachments: UploadedFile[]
): Promise<GeminiPart[]> {
    const parts: GeminiPart[] = [];

    for (const attachment of attachments) {
        // Skip audio files - they can't be processed inline by text models
        // The URL is already included in the message text
        if (attachment.type === "audio") {
            console.log(
                `Skipping audio attachment: ${attachment.name} (URL included in message text)`
            );
            continue;
        }

        try {
            const base64Data = await toBase64(attachment.url);
            const mimeType = getMimeTypeFromUploadedFile(attachment);

            console.log(
                `Processing attachment: ${attachment.name}, type: ${attachment.type}, mimeType: ${mimeType}`
            );

            parts.push({
                inlineData: {
                    mimeType,
                    data: base64Data,
                },
            });
        } catch (error) {
            console.error(
                `Failed to process attachment ${attachment.name}:`,
                error
            );
        }
    }

    return parts;
}

/**
 * Build the user content parts from message and attachments
 */
async function buildUserParts(
    message: string,
    attachments?: UploadedFile[]
): Promise<GeminiPart[]> {
    const parts: GeminiPart[] = [];

    // Build message with attachment info so agent knows the URLs
    let fullMessage = message;
    if (attachments && attachments.length > 0) {
        const attachmentInfo = attachments
            .map((a) => {
                return `[Uploaded ${a.type}: "${a.name}" - URL: ${a.url}]`;
            })
            .join("\n");
        fullMessage = fullMessage
            ? `${fullMessage}\n\n${attachmentInfo}`
            : attachmentInfo;
    }

    // Add text message
    if (fullMessage) {
        parts.push({ text: fullMessage });
    }

    // Add attachment data (visual data for the model to see)
    if (attachments && attachments.length > 0) {
        const attachmentParts = await convertAttachmentsToParts(attachments);
        parts.push(...attachmentParts);
    }

    return parts;
}

/**
 * Extract tool calls from model response
 */
function extractToolCalls(parts: GeminiPart[]): {
    toolCalls: ToolCallResult[];
    thoughtSignature?: string;
} {
    const toolCalls: ToolCallResult[] = [];
    let thoughtSignature: string | undefined;

    for (const part of parts) {
        if ("functionCall" in part && part.functionCall) {
            toolCalls.push({
                toolName: part.functionCall.name,
                args: part.functionCall.args as Record<string, unknown>,
            });

            // Capture thought signature from first function call
            if (!thoughtSignature && part.thoughtSignature) {
                thoughtSignature = part.thoughtSignature;
            }
        }
    }

    return { toolCalls, thoughtSignature };
}

/**
 * Extract text content from model response (excluding thoughts)
 */
function extractTextContent(
    parts: Array<GeminiPart & { thought?: boolean }>
): string {
    const textParts: string[] = [];

    for (const part of parts) {
        // Skip thought parts - they go in thoughtSummary instead
        if (part.thought) {
            continue;
        }
        if ("text" in part && part.text) {
            textParts.push(part.text);
        }
    }

    return textParts.join("");
}

/**
 * Extract thought summary from model response
 */
function extractThoughtSummary(candidate: {
    content?: { parts?: Array<{ thought?: boolean; text?: string }> };
}): string | undefined {
    const parts = candidate.content?.parts || [];

    for (const part of parts) {
        if (part.thought && part.text) {
            return part.text;
        }
    }

    return undefined;
}

// ============================================
// MAIN CHAT ENDPOINT
// ============================================

export async function POST(request: NextRequest) {
    console.log("--- CHAT API REQUEST RECEIVED ---");
    try {
        const body: ChatRequestBody = await request.json();
        const { message, attachments, conversationHistory, projectState } =
            body;

        console.log("Message:", message);
        console.log("History length:", conversationHistory.length);

        // Build user content parts
        const userParts = await buildUserParts(message, attachments);

        // Add user message to history
        const updatedHistory: GeminiContent[] = [
            ...conversationHistory,
            {
                role: "user",
                parts: userParts,
            },
        ];

        // Build system instruction with current project state
        let systemInstruction = SYSTEM_INSTRUCTION;
        if (projectState) {
            systemInstruction += `\n\n## Current Project State\n\`\`\`json\n${JSON.stringify(
                projectState,
                null,
                2
            )}\n\`\`\``;
        }

        console.log("Calling Gemini API...");
        // Call Gemini with function calling
        const response = await ai.models.generateContent({
            model: "models/gemini-1.5-flash",
            contents: updatedHistory,
            config: {
                systemInstruction,
                tools: [{ functionDeclarations: agentTools }],
            },
        });

        console.log("Gemini Response received.");
        
        // Extract response data
        const candidate = response.candidates?.[0];
        if (!candidate?.content?.parts) {
            console.error("Invalid response structure:", JSON.stringify(response, null, 2));
            throw new Error("No response from model");
        }

        const responseParts = candidate.content.parts as GeminiPart[];

        // Check for function calls
        const { toolCalls, thoughtSignature } = extractToolCalls(responseParts);

        // Extract text content
        const textContent = extractTextContent(responseParts);

        // Extract thought summary
        const thoughtSummary = extractThoughtSummary(candidate);

        // Add model response to history (preserving thought signatures)
        updatedHistory.push({
            role: "model",
            parts: responseParts,
        });

        // Build response
        const responseBody: ChatResponseBody = {
            message: textContent,
            updatedHistory,
        };

        if (toolCalls.length > 0) {
            responseBody.toolCalls = toolCalls;
        }

        if (thoughtSummary) {
            responseBody.thoughtSummary = thoughtSummary;
        }

        if (thoughtSignature) {
            responseBody.thoughtSignature = thoughtSignature;
        }

        return NextResponse.json(responseBody);
    } catch (error: any) {
        console.error("Chat API error DETAILS:", error);
        if (error.response) {
             console.error("API Error Response:", JSON.stringify(error.response, null, 2));
        }
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to process chat",
                details: error.toString() 
            },
            { status: 500 }
        );
    }
}

// ============================================
// STREAMING ENDPOINT (alternative)
// ============================================

export async function GET() {
    return NextResponse.json({ status: "Chat API is running" });
}
