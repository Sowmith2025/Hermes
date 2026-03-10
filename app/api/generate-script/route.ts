import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import type {
    Character,
    Brand,
    Aesthetic,
    ProjectOverview,
    Scene,
    SceneType,
} from "@/lib/types";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY,
});


// ============================================
// REQUEST TYPE
// ============================================

type GenerateScriptRequest = {
    overview: ProjectOverview;
    aesthetic: Aesthetic | null;
    brand: Brand | null;
    characters: Character[];
    additionalGuidance?: string;
};

// ============================================
// AI RESPONSE TYPES (Simplified - only script content)
// ============================================

type AIScene = {
    type: SceneType;
    description: string;
    script: { characterId: string; dialogue: string } | null;
    includeBrandLogo?: boolean;
};

type AIResponse = {
    scenes: AIScene[];
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateId(): string {
    return crypto.randomUUID();
}

// ============================================
// MAIN ENDPOINT
// ============================================

export async function POST(request: NextRequest) {
    try {
        const body: GenerateScriptRequest = await request.json();
        const { overview, aesthetic, brand, characters, additionalGuidance } =
            body;

        const characterList =
            characters.length > 0
                ? characters.map((c) => `- ${c.name} (ID: ${c.id})`).join("\n")
                : "No characters provided.";

        const systemPrompt = `You are a video scriptwriter. Create a scene-by-scene script breakdown.

ASPECT RATIO: ${overview.aspectRatio} (${
            overview.aspectRatio === "16:9" ? "landscape" : "portrait"
        })
TARGET DURATION: ${
            overview.targetDurationSeconds
        } seconds (approximately ${Math.ceil(
            overview.targetDurationSeconds / 6
        )} scenes)

VIDEO CONCEPT:
${overview.prompt}

${
    overview.additionalNotes
        ? `ADDITIONAL NOTES:\n${overview.additionalNotes}`
        : ""
}

${aesthetic ? `ART STYLE: ${aesthetic.title}\n${aesthetic.description}` : ""}

AVAILABLE CHARACTERS:
${characterList}

SCENE TYPES:

1. "scene" - Speaking video with character talking
   - One character speaks (dialogue)
   - Main use case: talking head, presentation, dialogue

2. "broll" - Action/environmental video
   - Visual footage without direct speaking
   - Voiceover can play over this
   - Examples: product demos, walking shots, environmental footage

3. "infographic" - Static image/graphic
   - Data visualizations, text overlays, diagrams
   - Voiceover plays over still image

${
    brand
        ? `BRAND: ${brand.name} - ${brand.description}\nInclude brand logo where appropriate.`
        : ""
}

${additionalGuidance ? `ADDITIONAL GUIDANCE:\n${additionalGuidance}` : ""}

IMPORTANT RULES:
- Each scene should be 3-8 seconds of spoken content
- Vary scene types for visual interest
- Create an engaging hook in the first scene
- Only use characters from the list above
- For "scene" type, script is required
- For "broll" and "infographic", script is optional (voiceover)

RESPOND WITH JSON ONLY:
{
  "scenes": [
    {
      "type": "scene" | "broll" | "infographic",
      "description": "Visual description of what appears on screen",
      "script": { "characterId": "character-uuid", "dialogue": "spoken text" } | null,
      "includeBrandLogo": boolean
    }
  ]
}`;

        console.log("=== SCRIPT GENERATION ===");
        console.log("Target duration:", overview.targetDurationSeconds);
        console.log(
            "Characters:",
            characters.map((c) => c.name).join(", ") || "None"
        );

        const response = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: [{ parts: [{ text: systemPrompt }] }],
            config: {
                responseMimeType: "application/json",
                // thinkingConfig: {
                //     thinkingLevel: "high",
                // },
            },
        });

        const text = response.text || "";
        let aiResponse: AIResponse;

        try {
            aiResponse = JSON.parse(text);
        } catch {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                aiResponse = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error("Failed to parse script response");
            }
        }

        aiResponse.scenes = aiResponse.scenes || [];

        console.log("Scenes generated:", aiResponse.scenes.length);

        // Transform to final types - simplified without preprocessing fields
        const scenes: Scene[] = aiResponse.scenes.map((aiScene, index) => {
            const type = aiScene.type as SceneType;
            const includeBrandLogo = brand
                ? aiScene.includeBrandLogo ?? false
                : false;

            return {
                id: generateId(),
                index,
                type,
                duration: 5, // Default duration, will be calculated later
                description: aiScene.description,
                script: aiScene.script,
                includeBrandLogo,
                // These will be filled in during preprocessing
                locationId: null,
                visualCharacterIds: [],
                characterAttireIds: {},
                // Thumbnail will be generated after preprocessing
                thumbnailUrl: null,
                thumbnailStatus: "pending" as const,
                // Video will be generated after thumbnails
                videoUrl: null,
                videoStatus: "pending" as const,
            };
        });

        return NextResponse.json({
            scenes,
        });
    } catch (error) {
        console.error("Error generating script:", error);
        return NextResponse.json(
            { error: "Failed to generate script" },
            { status: 500 }
        );
    }
}
