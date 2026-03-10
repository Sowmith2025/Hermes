import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { uploadBase64Image } from "@/lib/upload";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY,
});


type CharacterInScene = {
    name: string;
    attireName: string;
    attireAngles: string[]; // 4 angle reference images
};

type GenerateThumbnailRequest = {
    sceneId: string;
    sceneIndex: number;
    sceneType: "scene" | "broll" | "infographic";
    sceneDescription: string;
    dialogue: string | null;
    speakerName: string | null;
    aspectRatio: "16:9" | "9:16";
    aestheticDescription: string;
    locationImageUrl: string | null;
    charactersInScene: CharacterInScene[];
    includeBrandLogo: boolean;
    brandName: string | null;
    // For editing existing thumbnails
    existingThumbnailUrl?: string;
    editInstructions?: string;
};

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
        const body: GenerateThumbnailRequest = await request.json();
        const {
            sceneId,
            sceneIndex,
            sceneType,
            sceneDescription,
            dialogue,
            speakerName,
            aspectRatio,
            aestheticDescription,
            locationImageUrl,
            charactersInScene,
            includeBrandLogo,
            brandName,
            existingThumbnailUrl,
            editInstructions,
        } = body;

        const isEditing = !!existingThumbnailUrl && !!editInstructions;

        console.log(
            `=== ${isEditing ? "EDITING" : "GENERATING"} THUMBNAIL FOR SCENE ${
                sceneIndex + 1
            } ===`
        );
        console.log(`Aspect ratio: ${aspectRatio}`);
        console.log(`Scene type: ${sceneType}`);

        // Build content parts with reference images
        type ContentPart =
            | { text: string }
            | { inlineData: { mimeType: string; data: string } };
        const contentParts: ContentPart[] = [];

        // Add location image if available
        if (locationImageUrl) {
            try {
                const locationData = await fetchImageAsBase64(locationImageUrl);
                contentParts.push({
                    inlineData: {
                        mimeType: locationData.mimeType,
                        data: locationData.data,
                    },
                });
                console.log("Added location reference image");
            } catch (e) {
                console.warn("Failed to fetch location image:", e);
            }
        }

        // Add character attire reference images (up to 4 angles per character)
        for (const char of charactersInScene) {
            for (const angleUrl of char.attireAngles.slice(0, 4)) {
                if (angleUrl) {
                    try {
                        const charData = await fetchImageAsBase64(angleUrl);
                        contentParts.push({
                            inlineData: {
                                mimeType: charData.mimeType,
                                data: charData.data,
                            },
                        });
                    } catch (e) {
                        console.warn(
                            `Failed to fetch character image for ${char.name}:`,
                            e
                        );
                    }
                }
            }
            console.log(
                `Added ${char.attireAngles.length} reference images for ${char.name} (${char.attireName})`
            );
        }

        // If editing, add the existing thumbnail
        if (isEditing && existingThumbnailUrl) {
            try {
                const existingData = await fetchImageAsBase64(
                    existingThumbnailUrl
                );
                contentParts.push({
                    inlineData: {
                        mimeType: existingData.mimeType,
                        data: existingData.data,
                    },
                });
                console.log("Added existing thumbnail for editing");
            } catch (e) {
                console.warn("Failed to fetch existing thumbnail:", e);
            }
        }

        // Build the prompt
        let prompt: string;

        if (isEditing) {
            // Editing mode prompt
            prompt = `Edit the thumbnail image (the last image provided) for this video scene.

EDIT INSTRUCTIONS: ${editInstructions}

SCENE CONTEXT:
- Scene ${sceneIndex + 1}: ${sceneType.toUpperCase()}
- Visual Description: ${sceneDescription}
${dialogue ? `- Dialogue/Voiceover: "${dialogue}"` : ""}
${speakerName ? `- Speaker: ${speakerName}` : ""}

CRITICAL REQUIREMENTS:
- MUST maintain the EXACT ${aspectRatio} aspect ratio (${
                aspectRatio === "16:9"
                    ? "landscape/horizontal"
                    : "portrait/vertical"
            })
- Apply the requested changes while maintaining the same art style: ${aestheticDescription}
- Maintain character consistency with the reference images provided
- Keep the scene's overall composition and mood

Generate the edited thumbnail in ${aspectRatio} aspect ratio.`;
        } else {
            // Generation mode prompt
            const characterDescriptions = charactersInScene
                .map(
                    (c) =>
                        `${c.name} wearing ${c.attireName} (reference images provided)`
                )
                .join(", ");

            prompt = `Generate a high-quality thumbnail/frame for a video scene.

SCENE DETAILS:
- Scene ${sceneIndex + 1}: ${sceneType.toUpperCase()}
- Visual Description: ${sceneDescription}
${dialogue ? `- Dialogue/Voiceover: "${dialogue}"` : ""}
${speakerName ? `- Speaker: ${speakerName}` : ""}
${
    charactersInScene.length > 0
        ? `- Characters in scene: ${characterDescriptions}`
        : "- No characters in this scene"
}

ART STYLE: ${aestheticDescription}

${
    locationImageUrl
        ? "LOCATION: Use the first image as the background/setting reference."
        : ""
}

${
    includeBrandLogo && brandName
        ? `BRANDING: Subtly include "${brandName}" branding in the scene.`
        : ""
}

REQUIREMENTS:
- Generate a single compelling frame that captures the essence of this scene
- Maintain exact character likeness using the provided reference images
- Match the art style and aesthetic consistently
- Create a visually striking composition suitable for video production
- The image should feel cinematic and professional

Generate the thumbnail image.`;
        }

        contentParts.push({ text: prompt });

        console.log(`Prompt length: ${prompt.length} characters`);
        console.log(`Total reference images: ${contentParts.length - 1}`);

        // Call Nano Banana Pro
        const response = await ai.models.generateContent({
            model: "imagen-3.0-generate-001",
            contents: [{ parts: contentParts }],
            config: {
                responseModalities: ["IMAGE"],
                imageConfig: {
                    aspectRatio: aspectRatio,
                    imageSize: "1K",
                },
            },
        });

        // Extract the generated image
        const parts = response.candidates?.[0]?.content?.parts || [];
        let thumbnailUrl: string | null = null;

        for (const part of parts) {
            // Skip thought images
            if ("thought" in part && part.thought) continue;

            if (
                "inlineData" in part &&
                part.inlineData?.mimeType?.startsWith("image/")
            ) {
                const base64DataUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                const filename = `thumbnail-scene-${
                    sceneIndex + 1
                }-${Date.now()}.png`;

                try {
                    thumbnailUrl = await uploadBase64Image(
                        base64DataUrl,
                        filename
                    );
                    console.log(
                        "Thumbnail uploaded to UploadThing:",
                        thumbnailUrl
                    );
                } catch (uploadError) {
                    console.error("Failed to upload thumbnail:", uploadError);
                    // Fallback to base64 (not ideal)
                    thumbnailUrl = base64DataUrl;
                }
                break;
            }
        }

        if (!thumbnailUrl) {
            throw new Error("No thumbnail image generated");
        }

        return NextResponse.json({
            sceneId,
            sceneIndex,
            thumbnailUrl,
            message: isEditing
                ? `Edited thumbnail for Scene ${sceneIndex + 1}`
                : `Generated thumbnail for Scene ${sceneIndex + 1}`,
        });
    } catch (error) {
        console.error("Error generating thumbnail:", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to generate thumbnail",
            },
            { status: 500 }
        );
    }
}
