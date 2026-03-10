import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import type {
    Character,
    Aesthetic,
    Scene,
    Location,
    CharacterAttire,
} from "@/lib/types";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY,
});


// ============================================
// REQUEST TYPE
// ============================================

type PreprocessScriptRequest = {
    scenes: Scene[];
    characters: Character[];
    aesthetic: Aesthetic | null;
};

// ============================================
// AI RESPONSE TYPES
// ============================================

type AILocation = {
    name: string;
    description: string;
    sceneIndices: number[];
};

type AIAttire = {
    characterId: string;
    characterName: string;
    name: string;
    description: string;
    sceneIndices: number[];
};

type AISceneTagging = {
    sceneIndex: number;
    visualCharacterIds: string[];
    locationName: string | null;
};

type AIResponse = {
    locations: AILocation[];
    attires: AIAttire[];
    sceneTagging: AISceneTagging[];
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
        const body: PreprocessScriptRequest = await request.json();
        const { scenes, characters, aesthetic } = body;

        // Build scene descriptions for the AI
        const sceneDescriptions = scenes
            .map(
                (s, i) =>
                    `Scene ${i + 1} (${s.type}): ${s.description}${
                        s.script
                            ? ` - ${
                                  characters.find(
                                      (c) => c.id === s.script?.characterId
                                  )?.name || "Unknown"
                              } says: "${s.script.dialogue}"`
                            : ""
                    }`
            )
            .join("\n");

        const characterList = characters
            .map((c) => `- ${c.name} (ID: ${c.id})`)
            .join("\n");

        const systemPrompt = `Analyze this video script and extract:
1. Unique LOCATIONS where scenes take place
2. Unique CHARACTER ATTIRES (clothing/outfits) for each character
3. For each scene: which characters appear visually and which location

SCRIPT SCENES:
${sceneDescriptions}

AVAILABLE CHARACTERS:
${characterList}

${aesthetic ? `ART STYLE: ${aesthetic.title} - ${aesthetic.description}` : ""}

RULES:
- Identify the MINIMUM number of unique locations needed
- If a character appears in multiple scenes with the same outfit, that's ONE attire
- If a character changes clothes, that's a NEW attire
- For "scene" type: the speaking character MUST be first in visualCharacterIds
- For "infographic" type: visualCharacterIds should be empty []
- For "broll" type: include characters who appear visually (not just voiceover)
- locationName should match exactly one of the locations you define

RESPOND WITH JSON ONLY:
{
  "locations": [
    {
      "name": "Location Name (e.g., Modern Office, City Street)",
      "description": "Brief visual description for image generation (style, lighting, key elements)",
      "sceneIndices": [0, 1, 4]
    }
  ],
  "attires": [
    {
      "characterId": "character-uuid",
      "characterName": "Character Name",
      "name": "Attire Name (e.g., Business Casual, Workout Gear)",
      "description": "Brief visual description (colors, style, key clothing items)",
      "sceneIndices": [0, 1, 2]
    }
  ],
  "sceneTagging": [
    {
      "sceneIndex": 0,
      "visualCharacterIds": ["char-id-1", "char-id-2"],
      "locationName": "Location Name" | null
    }
  ]
}`;

        console.log("=== PREPROCESSING SCRIPT ===");
        console.log("Scenes:", scenes.length);
        console.log("Characters:", characters.map((c) => c.name).join(", "));

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
                throw new Error("Failed to parse preprocessing response");
            }
        }

        // Ensure arrays exist
        aiResponse.locations = aiResponse.locations || [];
        aiResponse.attires = aiResponse.attires || [];
        aiResponse.sceneTagging = aiResponse.sceneTagging || [];

        console.log(
            "Locations identified:",
            aiResponse.locations.map((l) => l.name).join(", ")
        );
        console.log("Attires identified:", aiResponse.attires.length);

        // 1. Create locations with IDs
        const locations: Location[] = aiResponse.locations.map((loc) => ({
            id: generateId(),
            name: loc.name,
            description: loc.description,
            referenceImageUrl: null,
            status: "pending" as const,
        }));

        // Create locationName -> locationId mapping
        const locationNameToId = new Map(
            locations.map((loc) => [loc.name, loc.id])
        );

        // 2. Create attires with IDs
        const attires: CharacterAttire[] = aiResponse.attires.map((attire) => ({
            id: generateId(),
            characterId: attire.characterId,
            name: attire.name,
            description: attire.description,
            referenceAngles: [],
            status: "pending" as const,
        }));

        // Create (characterId, sceneIndex) -> attireId mapping
        const attireMap = new Map<string, string>();
        aiResponse.attires.forEach((aiAttire, attireIndex) => {
            const attireId = attires[attireIndex].id;
            aiAttire.sceneIndices.forEach((sceneIdx) => {
                attireMap.set(`${aiAttire.characterId}-${sceneIdx}`, attireId);
            });
        });

        // 3. Create scene updates with resolved references
        const sceneUpdates: Array<{
            sceneId: string;
            locationId: string | null;
            visualCharacterIds: string[];
            characterAttireIds: Record<string, string>;
        }> = scenes.map((scene, index) => {
            const tagging = aiResponse.sceneTagging.find(
                (t) => t.sceneIndex === index
            );

            // Get locationId from locationName
            let locationId: string | null = null;
            if (tagging?.locationName) {
                locationId = locationNameToId.get(tagging.locationName) || null;
            }

            // Get visualCharacterIds
            let visualCharacterIds = tagging?.visualCharacterIds || [];

            // For "scene" type, ensure speaking character is first
            if (scene.type === "scene" && scene.script?.characterId) {
                const speakingCharId = scene.script.characterId;
                if (!visualCharacterIds.includes(speakingCharId)) {
                    visualCharacterIds = [
                        speakingCharId,
                        ...visualCharacterIds,
                    ];
                } else if (visualCharacterIds[0] !== speakingCharId) {
                    visualCharacterIds = [
                        speakingCharId,
                        ...visualCharacterIds.filter(
                            (id) => id !== speakingCharId
                        ),
                    ];
                }
            }

            // For "infographic", ensure no characters
            if (scene.type === "infographic") {
                visualCharacterIds = [];
            }

            // Build characterAttireIds for this scene
            const characterAttireIds: Record<string, string> = {};
            visualCharacterIds.forEach((charId) => {
                const attireId = attireMap.get(`${charId}-${index}`);
                if (attireId) {
                    characterAttireIds[charId] = attireId;
                }
            });

            return {
                sceneId: scene.id,
                locationId,
                visualCharacterIds,
                characterAttireIds,
            };
        });

        return NextResponse.json({
            locations,
            attires,
            sceneUpdates,
        });
    } catch (error) {
        console.error("Error preprocessing script:", error);
        return NextResponse.json(
            { error: "Failed to preprocess script" },
            { status: 500 }
        );
    }
}
