import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { uploadBase64Image } from "@/lib/upload";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY,
});


type GenerateLocationImageRequest = {
    locationName: string;
    locationDescription: string;
    aestheticDescription?: string;
    additionalInstructions?: string;
    existingImageUrl?: string; // For editing existing images
};

/**
 * Helper to extract base64 data and mime type from a data URL
 */
function parseDataUrl(
    dataUrl: string
): { data: string; mimeType: string } | null {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
        return { mimeType: match[1], data: match[2] };
    }
    return null;
}

/**
 * Fetch an image from URL and convert to base64
 */
async function fetchImageAsBase64(
    url: string
): Promise<{ data: string; mimeType: string }> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const contentType = response.headers.get("content-type") || "image/png";
    return { data: base64, mimeType: contentType };
}

export async function POST(request: NextRequest) {
    try {
        const body: GenerateLocationImageRequest = await request.json();
        const {
            locationName,
            locationDescription,
            aestheticDescription,
            additionalInstructions,
            existingImageUrl,
        } = body;

        // Check if we're editing an existing image or generating new
        const isEditing = !!existingImageUrl;

        type ContentPart =
            | { text: string }
            | { inlineData: { mimeType: string; data: string } };
        let contentParts: ContentPart[];

        if (isEditing && existingImageUrl) {
            // EDITING MODE: Include the original image and edit instructions
            let imageData: { data: string; mimeType: string } | null = null;

            // Check if it's a data URL or an HTTP URL
            if (existingImageUrl.startsWith("data:")) {
                imageData = parseDataUrl(existingImageUrl);
            } else if (existingImageUrl.startsWith("http")) {
                // Fetch the image from URL and convert to base64
                console.log(
                    "Fetching existing image from URL:",
                    existingImageUrl
                );
                imageData = await fetchImageAsBase64(existingImageUrl);
            }

            if (!imageData) {
                throw new Error("Invalid existing image URL format");
            }

            const editPrompt = `Edit this location image for "${locationName}".

EDIT INSTRUCTIONS: ${additionalInstructions || "Improve the image quality"}

Keep the same overall composition and style, but apply the requested changes.
${aestheticDescription ? `Maintain the art style: ${aestheticDescription}` : ""}

IMPORTANT: Preserve the core elements of the original image while making the requested modifications.`;

            console.log("=== EDITING LOCATION IMAGE ===");
            console.log("Location:", locationName);
            console.log("Instructions:", additionalInstructions);

            contentParts = [
                {
                    inlineData: {
                        mimeType: imageData.mimeType,
                        data: imageData.data,
                    },
                },
                { text: editPrompt },
            ];
        } else {
            // GENERATION MODE: Create new image from scratch
            const generatePrompt = `Generate a high-quality reference image for a video production location.

LOCATION: ${locationName}
DESCRIPTION: ${locationDescription}

${aestheticDescription ? `ART STYLE: ${aestheticDescription}` : ""}
${
    additionalInstructions
        ? `ADDITIONAL INSTRUCTIONS: ${additionalInstructions}`
        : ""
}

Create a wide establishing shot that shows:
- The overall environment and atmosphere
- Key architectural or environmental features
- Appropriate lighting for the scene
- No people or characters in the image

Style: Cinematic, high production value, suitable for video background`;

            console.log("=== GENERATING LOCATION IMAGE ===");
            console.log("Location:", locationName);

            contentParts = [{ text: generatePrompt }];
        }

        const response = await ai.models.generateContent({
            model: "imagen-3.0-generate-001",
            contents: [{ parts: contentParts }],
            config: {
                responseModalities: ["IMAGE"],
                imageConfig: { aspectRatio: "16:9", imageSize: "1K" },
            },
        });

        // Extract image from response
        const parts = response.candidates?.[0]?.content?.parts || [];
        let imageUrl: string | null = null;

        for (const part of parts) {
            if (part.inlineData?.mimeType?.startsWith("image/")) {
                // Upload to UploadThing to avoid storing base64 in localStorage
                const base64DataUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                const filename = `location-${locationName.replace(
                    /\s+/g,
                    "-"
                )}-${Date.now()}.png`;

                try {
                    imageUrl = await uploadBase64Image(base64DataUrl, filename);
                    console.log(
                        "Location image uploaded to UploadThing:",
                        imageUrl
                    );
                } catch (uploadError) {
                    console.error(
                        "Failed to upload to UploadThing, using base64:",
                        uploadError
                    );
                    // Fallback to base64 if upload fails (not ideal but prevents total failure)
                    imageUrl = base64DataUrl;
                }
                break;
            }
        }

        if (!imageUrl) {
            throw new Error("No image generated");
        }

        return NextResponse.json({
            imageUrl,
        });
    } catch (error) {
        console.error("Error generating location image:", error);
        return NextResponse.json(
            { error: "Failed to generate location image" },
            { status: 500 }
        );
    }
}
