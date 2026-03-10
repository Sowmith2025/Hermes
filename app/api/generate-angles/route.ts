import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { uploadBase64Image } from "@/lib/upload";
import { toBase64 } from "@/lib/image-utils";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY,
});


// ============================================
// ANGLE CONFIGURATIONS
// ============================================

const ANGLE_CONFIGS = [
    {
        id: "front-portrait",
        description:
            "front-facing head and shoulders portrait, looking directly at the camera",
    },
    {
        id: "front-body",
        description:
            "front-facing full body shot standing naturally, arms relaxed at sides",
    },
    {
        id: "three-quarter",
        description:
            "three-quarter angle head and shoulders portrait, body turned slightly to the side",
    },
    {
        id: "side-profile",
        description:
            "full side profile view, face in complete profile showing ear and jawline",
    },
];

const STYLE_GUIDANCE = `
Expression: natural and relaxed with a subtle, genuine smile - not exaggerated or overly expressive.
Background: pure white studio background with no shadows or gradients.
Lighting: soft, even studio lighting.
Quality: high-quality professional photography style.
`.trim();

// ============================================
// REQUEST TYPE
// ============================================

type GenerateAnglesRequest = {
    characterId?: string;
    characterName: string;
    referencePhotos: string[];
    aestheticDescription?: string;
    attireDescription?: string; // For attire-specific generation
};

// ============================================
// MAIN ENDPOINT
// ============================================

export async function POST(request: NextRequest) {
    try {
        const body: GenerateAnglesRequest = await request.json();
        const {
            characterName,
            referencePhotos,
            aestheticDescription,
            attireDescription,
        } = body;

        if (!referencePhotos || referencePhotos.length === 0) {
            return NextResponse.json(
                { error: "At least one reference photo is required" },
                { status: 400 }
            );
        }

        console.log("=== CHARACTER ANGLES GENERATION ===");
        console.log("Character:", characterName);
        console.log("Reference photos:", referencePhotos.length);

        // Convert reference photos to base64 for Gemini
        const referenceParts = await Promise.all(
            referencePhotos.map(async (photo) => ({
                inlineData: {
                    mimeType: "image/jpeg",
                    data: await toBase64(photo),
                },
            }))
        );

        const generatedAngles: string[] = [];

        // Build attire/style instruction
        const attireInstruction = attireDescription
            ? `\nATTIRE: The character should be wearing: ${attireDescription}`
            : "";
        const styleInstruction = aestheticDescription
            ? `\nART STYLE: ${aestheticDescription}`
            : "";

        // PHASE 1: Generate the first image (front portrait) as anchor
        const firstAngle = ANGLE_CONFIGS[0];
        const firstPrompt = `Generate a ${firstAngle.description} of the EXACT SAME PERSON shown in the reference photos.

The generated image must look like the SAME INDIVIDUAL as in the reference photos. This is NOT about generating a similar-looking person - it must be recognizable as the exact same person.

Copy precisely from the reference photos:
- Exact face shape and bone structure
- Exact eye shape, size, spacing, and color
- Exact nose shape and size
- Exact lip shape and mouth
- Exact skin tone and complexion
- Exact hair color, texture, and style
- Any distinctive features (moles, dimples, freckles, facial hair, etc.)
${attireInstruction}
${styleInstruction}
${STYLE_GUIDANCE}`;

        console.log("Generating first angle (anchor)...");

        const firstResponse = await ai.models.generateContent({
            model: "gemini-3-pro-image-preview",
            contents: [{ parts: [{ text: firstPrompt }, ...referenceParts] }],
            config: {
                responseModalities: ["IMAGE"],
                imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
            },
        });

        // Extract and upload the first image
        let firstImageData: string | null = null;
        const firstCandidate = firstResponse.candidates?.[0];
        if (firstCandidate?.content?.parts) {
            for (const part of firstCandidate.content.parts) {
                if ("inlineData" in part && part.inlineData) {
                    firstImageData = part.inlineData.data as string;
                    const mimeType = part.inlineData.mimeType || "image/png";

                    try {
                        const filename = `character-${characterName.replace(
                            /\s+/g,
                            "-"
                        )}-${firstAngle.id}-${Date.now()}.png`;
                        const uploadedUrl = await uploadBase64Image(
                            `data:${mimeType};base64,${firstImageData}`,
                            filename
                        );
                        generatedAngles.push(uploadedUrl);
                    } catch {
                        generatedAngles.push(
                            `data:${mimeType};base64,${firstImageData}`
                        );
                    }
                    break;
                }
            }
        }

        if (!firstImageData) {
            return NextResponse.json(
                { error: "Failed to generate first reference image" },
                { status: 500 }
            );
        }

        console.log("First angle generated successfully");

        // PHASE 2: Generate remaining 3 images using the first as primary reference
        const firstImagePart = {
            inlineData: { mimeType: "image/png", data: firstImageData },
        };

        const remainingAngles = ANGLE_CONFIGS.slice(1);

        for (const angle of remainingAngles) {
            console.log(`Generating ${angle.id}...`);

            const prompt = `Generate a ${angle.description} of the EXACT SAME PERSON shown in the reference photos.

The generated image must be the SAME INDIVIDUAL - not a similar-looking person, but recognizably the exact same person from a different angle.

The FIRST reference image is the primary reference - match it exactly:
- Same face, same bone structure
- Same attire/clothing
- Same hair style
${attireInstruction}
${styleInstruction}
${STYLE_GUIDANCE}`;

            try {
                const response = await ai.models.generateContent({
                    model: "imagen-3.0-generate-001",
                    contents: [
                        {
                            parts: [
                                { text: prompt },
                                firstImagePart,
                                ...referenceParts,
                            ],
                        },
                    ],
                    config: {
                        responseModalities: ["IMAGE"],
                        imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
                    },
                });

                const candidate = response.candidates?.[0];
                if (candidate?.content?.parts) {
                    for (const part of candidate.content.parts) {
                        if ("inlineData" in part && part.inlineData) {
                            const imageData = part.inlineData.data;
                            const mimeType =
                                part.inlineData.mimeType || "image/png";

                            try {
                                const filename = `character-${characterName.replace(
                                    /\s+/g,
                                    "-"
                                )}-${angle.id}-${Date.now()}.png`;
                                const uploadedUrl = await uploadBase64Image(
                                    `data:${mimeType};base64,${imageData}`,
                                    filename
                                );
                                generatedAngles.push(uploadedUrl);
                            } catch {
                                generatedAngles.push(
                                    `data:${mimeType};base64,${imageData}`
                                );
                            }
                            break;
                        }
                    }
                }
            } catch (error) {
                console.error(`Error generating ${angle.id}:`, error);
            }
        }

        console.log("=== GENERATION COMPLETE ===");
        console.log("Total angles generated:", generatedAngles.length);

        return NextResponse.json({
            generatedAngles,
        });
    } catch (error) {
        console.error("Error generating angles:", error);
        return NextResponse.json(
            { error: "Failed to generate character angles" },
            { status: 500 }
        );
    }
}
