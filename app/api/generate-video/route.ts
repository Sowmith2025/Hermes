import {
    GoogleGenAI,
    VideoGenerationReferenceImage,
    VideoGenerationReferenceType,
} from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { UTApi } from "uploadthing/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fal } from "@fal-ai/client";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY,
});

const utapi = new UTApi();

type CharacterInScene = {
    name: string;
    attireName: string;
    attireAngles: string[]; // 4 angle reference images
};

type GenerateVideoRequest = {
    sceneId: string;
    sceneIndex: number;
    sceneType: "scene" | "broll" | "infographic";
    sceneDescription: string;
    dialogue: string | null;
    speakerName: string | null;
    aspectRatio: "16:9" | "9:16";
    aestheticDescription: string;
    thumbnailUrl: string;
    charactersInScene: CharacterInScene[];
    brandName: string | null;
    includeBrandLogo: boolean;
};

/**
 * Fetch an image from URL and return as buffer
 */
async function fetchImageAsBuffer(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

/**
 * Create a 2x2 grid from 4 character angle images
 * Each input image is assumed to be square
 */
async function createCharacterGrid(angleUrls: string[]): Promise<Buffer> {
    // Fetch all 4 images
    const images: Buffer[] = [];
    for (let i = 0; i < Math.min(4, angleUrls.length); i++) {
        if (angleUrls[i]) {
            const buffer = await fetchImageAsBuffer(angleUrls[i]);
            images.push(buffer);
        }
    }

    // If we don't have 4 images, duplicate to fill
    while (images.length < 4) {
        images.push(images[0] || Buffer.alloc(0));
    }

    // Resize each image to consistent size (512x512)
    const tileSize = 512;
    const resizedImages = await Promise.all(
        images.map((img) =>
            sharp(img).resize(tileSize, tileSize, { fit: "cover" }).toBuffer()
        )
    );

    // Create 2x2 grid (1024x1024)
    const gridSize = tileSize * 2;
    const grid = await sharp({
        create: {
            width: gridSize,
            height: gridSize,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
    })
        .composite([
            { input: resizedImages[0], left: 0, top: 0 },
            { input: resizedImages[1], left: tileSize, top: 0 },
            { input: resizedImages[2], left: 0, top: tileSize },
            { input: resizedImages[3], left: tileSize, top: tileSize },
        ])
        .png()
        .toBuffer();

    return grid;
}

/**
 * Build the Veo prompt from scene info
 */
function buildVideoPrompt(
    sceneDescription: string,
    dialogue: string | null,
    speakerName: string | null,
    sceneType: string,
    aestheticDescription: string,
    brandName: string | null,
    includeBrandLogo: boolean,
    charactersInScene: CharacterInScene[]
): string {
    const characterNames = charactersInScene.map((c) => c.name).join(" and ");

    let prompt = `Create a cinematic video scene with the following details:

VISUAL DESCRIPTION: ${sceneDescription}

ART STYLE: ${aestheticDescription}

SCENE TYPE: ${
        sceneType === "scene"
            ? "Speaking/dialogue scene"
            : sceneType === "broll"
            ? "B-roll/ambient footage"
            : "Infographic/visual display"
    }`;

    if (characterNames) {
        prompt += `\n\nCHARACTERS IN SCENE: ${characterNames}`;
        if (charactersInScene.length > 0) {
            prompt += ` (reference images provided for character consistency)`;
        }
    }

    if (dialogue && speakerName) {
        prompt += `\n\nDIALOGUE: ${speakerName} says: "${dialogue}"`;
        prompt += `\nGenerate appropriate voice audio for this dialogue that matches the character.`;
    } else if (dialogue) {
        prompt += `\n\nVOICEOVER: "${dialogue}"`;
    }

    if (includeBrandLogo && brandName) {
        prompt += `\n\nBRANDING: Subtly incorporate "${brandName}" branding into the scene.`;
    }

    prompt += `\n\nREQUIREMENTS:
- Maintain consistent character appearance using the provided reference images
- Create smooth, cinematic motion
- Generate appropriate ambient sound and any dialogue audio
- Match the visual style described above`;

    return prompt;
}

async function generateWithFal(
    prompt: string,
    thumbnailUrl: string,
    aspectRatio: "16:9" | "9:16"
): Promise<string> {
    console.log("Starting Fal.ai generation with Wan 2.1...");
    
    try {
        // Use Image-to-Video model (14B parameter version)
        const result: any = await fal.subscribe("fal-ai/wan-2.1-i2v-14b", {
            input: {
                prompt: prompt,
                image_url: thumbnailUrl,
                aspect_ratio: aspectRatio,
            },
            logs: true,
            onQueueUpdate: (update) => {
                if (update.status === "IN_PROGRESS") {
                    update.logs.map((log) => log.message).forEach(msg => console.log(`[Fal]: ${msg}`));
                }
            },
        });

        if (result.video && result.video.url) {
            console.log("Fal generation successful:", result.video.url);
            return result.video.url;
        }
        
        throw new Error("No video URL in Fal response");
    } catch (error) {
        console.error("Fal generation failed:", error);
        throw error;
    }
}

async function generateWithHuggingFace(
    prompt: string,
    thumbnailUrl: string,
    aspectRatio: "16:9" | "9:16"
): Promise<Buffer> {
    console.log("Starting Hugging Face generation with Wan-AI/Wan2.2-TI2V-5B...");
    
    const hfToken = process.env.HF_TOKEN;
    if (!hfToken) {
        throw new Error("HF_TOKEN is missing");
    }

    // Try to get video from the Inference API
    const response = await fetch(
        "https://api-inference.huggingface.co/models/Wan-AI/Wan2.2-TI2V-5B",
        {
            headers: {
                Authorization: `Bearer ${hfToken}`,
                "Content-Type": "application/json",
                "x-use-cache": "false" 
            },
            method: "POST",
            body: JSON.stringify({
                inputs: prompt,
                parameters: {
                    // Models might interpret parameters differently
                    aspect_ratio: aspectRatio 
                } 
            }),
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`HF API Error (${response.status}):`, errorText);
        throw new Error(`Hugging Face API failed: ${response.status} ${errorText}`);
    }

    // The response is expected to be the video bytes
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

export async function POST(request: NextRequest) {
    try {
        const body: GenerateVideoRequest = await request.json();
        const {
            sceneId,
            sceneIndex,
            sceneType,
            sceneDescription,
            dialogue,
            speakerName,
            aspectRatio,
            aestheticDescription,
            thumbnailUrl,
            charactersInScene,
            brandName,
            includeBrandLogo,
        } = body;

        const isPortrait = aspectRatio === "9:16";

        console.log(`=== GENERATING VIDEO FOR SCENE ${sceneIndex + 1} ===`);
        console.log(`Aspect ratio: ${aspectRatio}`);

        // Build the prompt
        const prompt = buildVideoPrompt(
            sceneDescription,
            dialogue,
            speakerName,
            sceneType,
            aestheticDescription,
            brandName,
            includeBrandLogo,
            charactersInScene
        );

        let videoUrl: string;

        // 1. Try Hugging Face (User requested prioritization)
        if (process.env.HF_TOKEN) {
             console.log("HF_TOKEN found. Using Wan 2.2 Model (via Hugging Face).");
             try {
                const videoBuffer = await generateWithHuggingFace(prompt, thumbnailUrl, aspectRatio);
                
                // Upload to UploadThing
                const blob = new Blob([new Uint8Array(videoBuffer)], { type: "video/mp4" });
                const file = new File([blob], `scene-${sceneIndex + 1}-wan-hf.mp4`, { type: "video/mp4" });
                
                const uploadResponse = await utapi.uploadFiles([file]);
                
                if (uploadResponse[0]?.data?.url) {
                    videoUrl = uploadResponse[0].data.url;
                    console.log(`Video uploaded to UploadThing: ${videoUrl}`);
                } else {
                    throw new Error("Failed to upload generated video to UploadThing");
                }
             } catch (hfError) {
                 console.error("Hugging Face generation failed:", hfError);
                 throw hfError;
             }
        } 
        // 2. Try Fal.ai
        else if (process.env.FAL_KEY) {
            console.log("FAL_KEY found. Using Wan 2.1 Model (via Fal.ai).");
            const falVideoUrl = await generateWithFal(prompt, thumbnailUrl, aspectRatio);
            
            // Fetch and upload
            const videoBuffer = await fetchImageAsBuffer(falVideoUrl);
            const blob = new Blob([new Uint8Array(videoBuffer)], { type: "video/mp4" });
            const file = new File([blob], `scene-${sceneIndex + 1}-wan.mp4`, { type: "video/mp4" });
            
            const uploadResponse = await utapi.uploadFiles([file]);
            
            if (uploadResponse[0]?.data?.url) {
                videoUrl = uploadResponse[0].data.url;
                console.log(`Video uploaded to UploadThing: ${videoUrl}`);
            } else {
                console.warn("UploadThing upload failed, using Fal URL directly.");
                videoUrl = falVideoUrl;
            }

        } 
        // 3. Default to Google Veo
        else {
            console.log("No 3rd party keys found. Defaulting to Google Veo.");
            
            // Fetch thumbnail as buffer
            const thumbnailBuffer = await fetchImageAsBuffer(thumbnailUrl);
            const thumbnailBase64 = thumbnailBuffer.toString("base64");
    
            let operation;
    
            if (isPortrait) {
                // PORTRAIT MODE: Use image-to-video (no reference images allowed per docs)
                console.log("Using image-to-video mode (portrait)");
    
                operation = await ai.models.generateVideos({
                    model: "veo-3.1-generate-preview",
                    prompt: prompt,
                    image: {
                        imageBytes: thumbnailBase64,
                        mimeType: "image/png",
                    },
                    config: {
                        aspectRatio: "9:16",
                        personGeneration: "allow_adult",
                    },
                });
            } else {
                // LANDSCAPE MODE: Use reference images (up to 3)
                console.log("Using reference images mode (landscape)");
    
                const referenceImages: VideoGenerationReferenceImage[] = [];
    
                // Add thumbnail as first reference
                referenceImages.push({
                    image: {
                        imageBytes: thumbnailBase64,
                        mimeType: "image/png",
                    },
                    referenceType: VideoGenerationReferenceType.ASSET,
                });
    
                // Add character grids
                for (let i = 0; i < Math.min(2, charactersInScene.length); i++) {
                    const char = charactersInScene[i];
                    if (char.attireAngles && char.attireAngles.length >= 4) {
                        try {
                            const gridBuffer = await createCharacterGrid(char.attireAngles);
                            const gridBase64 = gridBuffer.toString("base64");
                            referenceImages.push({
                                image: {
                                    imageBytes: gridBase64,
                                    mimeType: "image/png",
                                },
                                referenceType: VideoGenerationReferenceType.ASSET,
                            });
                        } catch (e) {
                            console.warn(`Failed to create grid for ${char.name}:`, e);
                        }
                    }
                }
    
                operation = await ai.models.generateVideos({
                    model: "veo-3.1-generate-preview",
                    prompt: prompt,
                    config: {
                        aspectRatio: "16:9",
                        durationSeconds: 8,
                        personGeneration: "allow_adult",
                        referenceImages: referenceImages,
                    },
                });
            }
    
            // Poll for completion
            console.log("Veo video generation started, polling for completion...");
            let pollCount = 0;
            const maxPolls = 60;
    
            while (!operation.done && pollCount < maxPolls) {
                pollCount++;
                console.log(`Poll ${pollCount}/${maxPolls}...`);
                await new Promise((resolve) => setTimeout(resolve, 10000));
                operation = await ai.operations.getVideosOperation({
                    operation: operation,
                });
            }
    
            if (!operation.done) {
                throw new Error("Video generation timed out");
            }
    
            const generatedVideo = operation.response?.generatedVideos?.[0];
            if (!generatedVideo?.video) {
                throw new Error("No video generated");
            }
    
            const videoFile = generatedVideo.video;
            
            // Download and Upload for Veo Result
            const tempDir = os.tmpdir();
            const tempFilePath = path.join(tempDir, `scene-${sceneIndex + 1}-${Date.now()}.mp4`);
            
            await ai.files.download({
                file: videoFile,
                downloadPath: tempFilePath,
            });
            
            const videoBuffer = fs.readFileSync(tempFilePath);
            const blob = new Blob([new Uint8Array(videoBuffer)], { type: "video/mp4" });
            const file = new File([blob], `scene-${sceneIndex + 1}-video.mp4`, { type: "video/mp4" });
            
            const uploadResponse = await utapi.uploadFiles([file]);
            
            if (uploadResponse[0]?.data?.url) {
                videoUrl = uploadResponse[0].data.url;
            } else {
                throw new Error("Failed to upload video to UploadThing");
            }
            
            fs.unlinkSync(tempFilePath);
        }

        console.log(`Final video URL: ${videoUrl}`);

        return NextResponse.json({
            sceneId,
            sceneIndex,
            videoUrl,
            message: `Generated video for Scene ${sceneIndex + 1}`,
        });
    } catch (error) {
        console.error("Error generating video:", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to generate video",
            },
            { status: 500 }
        );
    }
}
