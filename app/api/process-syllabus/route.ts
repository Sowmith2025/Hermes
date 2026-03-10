import { GoogleGenAI } from "@google/genai";
import { NextRequest } from "next/server";
import type {
    Syllabus,
    Module,
    LearningObjective,
    Question,
    BloomLevel,
    QuestionType,
    MCQOption,
} from "@/lib/planning-types";
import { QUESTION_TIME_LIMITS, MODULE_COLORS } from "@/lib/planning-types";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY,
});


// ============================================
// REQUEST TYPE
// ============================================

type ProcessSyllabusRequest = {
    pdfUrls: string[];
    projectTitle?: string;
};

// ============================================
// AI RESPONSE TYPES
// ============================================

type AIQuestion = {
    bloomLevel: "remember" | "understand" | "apply";
    type: "mcq" | "short" | "paragraph";
    text: string;
    options?: Array<{ text: string; isCorrect: boolean }>;
    correctAnswer: string;
    rationale: string;
};

type AILearningObjective = {
    id: string;
    description: string;
    questions: AIQuestion[];
};

type AIModule = {
    title: string;
    description: string;
    learningObjectives: AILearningObjective[];
};

type AISyllabus = {
    title: string;
    description: string;
    modules: AIModule[];
};

// ============================================
// STREAMING EVENT TYPES
// ============================================

type StreamEvent =
    | { type: "session_start"; sessionId: string }
    | { type: "status"; message: string; phase: string; title: string }
    | { type: "thought"; content: string; title: string }
    | { type: "tool_call"; toolName: string; description: string }
    | { type: "content"; text: string; title: string }
    | { type: "search"; query: string; results?: number }
    | { type: "read"; source: string; preview: string }
    | { type: "research_output"; content: string; section: string }
    | { type: "structuring"; message: string }
    | { type: "stats"; stats: { searchQueries: number; documentsAnalyzed: number; processingTimeMs: number } }
    | { type: "complete"; syllabus: Syllabus; researchReport: string }
    | { type: "error"; message: string };

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateId(): string {
    return crypto.randomUUID();
}

async function fetchPdfAsBase64(url: string): Promise<string> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.toString("base64");
}

function transformQuestion(aiQuestion: AIQuestion): Question {
    const options: MCQOption[] =
        aiQuestion.type === "mcq" && aiQuestion.options
            ? aiQuestion.options.map((opt, index) => ({
                  id: `opt-${index}`,
                  text: opt.text,
                  isCorrect: opt.isCorrect,
              }))
            : [];

    return {
        id: generateId(),
        bloomLevel: aiQuestion.bloomLevel as BloomLevel,
        type: aiQuestion.type as QuestionType,
        text: aiQuestion.text,
        options,
        correctAnswer: aiQuestion.correctAnswer,
        rationale: aiQuestion.rationale,
        timeLimitSeconds: QUESTION_TIME_LIMITS[aiQuestion.type as QuestionType],
    };
}

function transformLearningObjective(
    aiLO: AILearningObjective
): LearningObjective {
    return {
        id: aiLO.id || generateId(),
        description: aiLO.description,
        questions: aiLO.questions.map(transformQuestion),
    };
}

function transformModule(aiModule: AIModule, index: number): Module {
    return {
        id: generateId(),
        title: aiModule.title,
        description: aiModule.description,
        learningObjectives: aiModule.learningObjectives.map(
            transformLearningObjective
        ),
        status: "draft",
        color: MODULE_COLORS[index % MODULE_COLORS.length],
        order: index,
    };
}

function sendEvent(
    controller: ReadableStreamDefaultController,
    event: StreamEvent
) {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

// ============================================
// DEEP RESEARCH PROMPT (Multi-step approach)
// ============================================

function buildResearchPrompt(
    projectTitle: string | undefined,
    pdfCount: number
): string {
    return `You are an expert instructional designer conducting deep research to create a comprehensive training syllabus.

${projectTitle ? `PROJECT CONTEXT: "${projectTitle}"` : ""}

RESEARCH TASK:
Thoroughly analyze all ${pdfCount} provided document(s) and create a detailed research report.

ANALYSIS STEPS:
1. **CONTENT EXTRACTION**: Identify all key topics, concepts, and knowledge areas from the documents
2. **STRUCTURE ANALYSIS**: Determine how topics relate to each other and optimal learning sequence
3. **COMPETENCY MAPPING**: Map content to cognitive levels (Remember facts → Understand concepts → Apply in scenarios)
4. **SCENARIO IDENTIFICATION**: Find real-world situations from the content that can be used for assessment
5. **GAP ANALYSIS**: Identify any areas that might need additional emphasis

OUTPUT REQUIREMENTS:
Create a structured research report with the following sections:

## EXECUTIVE SUMMARY
Brief overview of what the documents cover and the training needs they address.

## KEY TOPICS AND CONCEPTS
List all major topics with brief explanations. Group related topics together.

## RECOMMENDED MODULE STRUCTURE  
Propose how to organize content into 3-7 logical training modules.
For each module, list:
- Module title
- What it covers
- Key concepts to teach
- Suggested learning objectives (action-oriented: "Identify...", "Explain...", "Apply...")

## ASSESSMENT STRATEGIES
For each learning objective, suggest:
- Remember-level questions (recall facts, definitions)
- Understand-level questions (explain why, categorize)
- Apply-level questions (scenario-based situations)

## REAL-WORLD SCENARIOS
List specific scenarios from the documents that can be used for Apply-level questions.
Include context, the situation, and what the correct response should be.

Be thorough and analytical. This research will be converted into a formal training syllabus.`;
}

// ============================================
// SYLLABUS STRUCTURING PROMPT
// ============================================

function buildStructuringPrompt(
    researchReport: string,
    projectTitle: string | undefined
): string {
    return `Based on the following research report, create a structured training syllabus in JSON format.

RESEARCH REPORT:
${researchReport}

IMPORTANT CONTEXT - BLOOM'S TAXONOMY (Levels 1-3 Only):
Level 1 - REMEMBER (1 point): Recall facts, definitions, terminology
Level 2 - UNDERSTAND (2 points): Explain why, categorize, interpret
Level 3 - APPLY (3 points): Use in scenarios, solve problems, demonstrate

QUESTIONS PER LEARNING OBJECTIVE:
- Remember: 1-2 questions (MCQ or short answer)
- Understand: 2 questions (MCQ or short answer)  
- Apply: 2-3 questions (MUST be scenario-based)
- Total per LO: 5-6 questions

RESPOND WITH JSON ONLY:
{
  "title": "${projectTitle || "Training Syllabus"}",
  "description": "Brief overview of what this syllabus covers",
  "modules": [
    {
      "title": "Module title",
      "description": "What this module covers",
      "learningObjectives": [
        {
          "id": "LO1",
          "description": "Action-oriented learning objective (Identify/Explain/Apply...)",
          "questions": [
            {
              "bloomLevel": "remember",
              "type": "mcq",
              "text": "Question text",
              "options": [
                { "text": "Option A", "isCorrect": false },
                { "text": "Option B", "isCorrect": true },
                { "text": "Option C", "isCorrect": false },
                { "text": "Option D", "isCorrect": false }
              ],
              "correctAnswer": "The correct answer",
              "rationale": "Why this is correct"
            }
          ]
        }
      ]
    }
  ]
}

RULES:
1. Create 3-7 modules based on the research
2. Each module has 2-5 learning objectives
3. Each LO has 5-6 questions across all 3 Bloom levels
4. MCQ questions have exactly 4 options with one correct
5. Apply questions MUST be scenario-based using real situations from the research
6. All content must come from the research report`;
}

// ============================================
// MAIN STREAMING ENDPOINT
// ============================================

export async function POST(request: NextRequest) {
    const body: ProcessSyllabusRequest = await request.json();
    const { pdfUrls, projectTitle } = body;

    if (!pdfUrls || pdfUrls.length === 0) {
        return new Response(JSON.stringify({ error: "No PDF URLs provided" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    console.log("=== DEEP RESEARCH SYLLABUS PROCESSING ===");
    console.log("Processing", pdfUrls.length, "PDFs");

    // Create a streaming response
    const stream = new ReadableStream({
        async start(controller) {
            const startTime = Date.now();
            const sessionId = generateId();
            let searchQueries = 0;
            let researchReport = "";

            try {
                // Send session start
                sendEvent(controller, {
                    type: "session_start",
                    sessionId,
                });

                // Phase 1: Fetch PDFs
                sendEvent(controller, {
                    type: "status",
                    title: "Loading Documents",
                    message: "Fetching uploaded documents from storage...",
                    phase: "fetching",
                });

                const pdfContents = await Promise.all(
                    pdfUrls.map(async (url, index) => {
                        sendEvent(controller, {
                            type: "read",
                            source: `Document ${index + 1}`,
                            preview: `Loading PDF from ${url.slice(0, 50)}...`,
                        });
                        const base64 = await fetchPdfAsBase64(url);
                        return {
                            inlineData: {
                                mimeType: "application/pdf" as const,
                                data: base64,
                            },
                        };
                    })
                );

                sendEvent(controller, {
                    type: "status",
                    title: "Documents Loaded",
                    message: `Successfully loaded ${pdfUrls.length} document(s)`,
                    phase: "documents_loaded",
                });

                // Phase 2: Deep Research Analysis (with streaming)
                sendEvent(controller, {
                    type: "tool_call",
                    toolName: "deep_research",
                    description: "Initiating deep research analysis on uploaded documents",
                });

                const researchPrompt = buildResearchPrompt(
                    projectTitle,
                    pdfUrls.length
                );

                sendEvent(controller, {
                    type: "status",
                    title: "Deep Research Started",
                    message: "AI agent is analyzing your documents. This involves multiple analysis passes...",
                    phase: "researching",
                });

                try {
                    // Stream the research response
                    const researchStream =
                        await ai.models.generateContentStream({
                    model: "gemini-1.5-flash",
                            contents: [
                                {
                                    parts: [
                                        { text: researchPrompt },
                                        ...pdfContents,
                                    ],
                                },
                            ],
                            config: {
                                thinkingConfig: {
                                    includeThoughts: true,
                                },
                            },
                        });

                    let thoughtCount = 0;
                    let currentSection = "";
                    let sectionBuffer = "";

                    for await (const chunk of researchStream) {
                        // Check for thoughts
                        if (chunk.candidates?.[0]?.content?.parts) {
                            for (const part of chunk.candidates[0].content.parts) {
                                // Handle thought parts
                                if ("thought" in part && part.thought) {
                                    thoughtCount++;
                                    const thoughtText = typeof part.thought === "string"
                                        ? part.thought
                                        : "Processing...";
                                    
                                    // Detect different thought patterns
                                    if (thoughtText.toLowerCase().includes("search") || 
                                        thoughtText.toLowerCase().includes("looking for")) {
                                        searchQueries++;
                                        sendEvent(controller, {
                                            type: "search",
                                            query: thoughtText.slice(0, 100),
                                        });
                                    } else if (thoughtCount <= 15) {
                                        sendEvent(controller, {
                                            type: "thought",
                                            title: `Analysis Step ${thoughtCount}`,
                                            content: thoughtText.slice(0, 200),
                                        });
                                    }
                                }
                                // Handle text parts
                                if ("text" in part && part.text) {
                                    researchReport += part.text;
                                    sectionBuffer += part.text;

                                    // Detect section headers in the output
                                    const sectionMatch = part.text.match(/^## (.+)$/m);
                                    if (sectionMatch) {
                                        if (currentSection && sectionBuffer.length > 50) {
                                            sendEvent(controller, {
                                                type: "research_output",
                                                section: currentSection,
                                                content: sectionBuffer.slice(0, 300) + "...",
                                            });
                                        }
                                        currentSection = sectionMatch[1];
                                        sectionBuffer = "";
                                    }
                                }
                            }
                        }

                        // Also check direct text
                        const text = chunk.text;
                        if (text && !researchReport.includes(text)) {
                            researchReport += text;
                        }
                    }

                    // Send final section if any
                    if (currentSection && sectionBuffer.length > 50) {
                        sendEvent(controller, {
                            type: "research_output",
                            section: currentSection,
                            content: sectionBuffer.slice(0, 300) + "...",
                        });
                    }

                    sendEvent(controller, {
                        type: "status",
                        title: "Research Complete",
                        message: `Analysis complete! Found ${thoughtCount} insights across ${pdfUrls.length} documents.`,
                        phase: "research_complete",
                    });
                } catch (researchError) {
                    console.error("Research streaming error:", researchError);

                    sendEvent(controller, {
                        type: "status",
                        title: "Switching Analysis Mode",
                        message: "Using standard analysis as fallback...",
                        phase: "fallback",
                    });

                    const fallbackResponse = await ai.models.generateContent({
                        model: "gemini-1.5-flash",
                        contents: [
                            {
                                parts: [
                                    { text: researchPrompt },
                                    ...pdfContents,
                                ],
                            },
                        ],
                    });

                    researchReport = fallbackResponse.text || "";
                }

                // Phase 3: Structure into Syllabus JSON
                sendEvent(controller, {
                    type: "tool_call",
                    toolName: "syllabus_generator",
                    description: "Converting research findings into structured syllabus format",
                });

                sendEvent(controller, {
                    type: "structuring",
                    message: "Generating modules, learning objectives, and assessment questions...",
                });

                const structuringPrompt = buildStructuringPrompt(
                    researchReport,
                    projectTitle
                );

                const structureResponse = await ai.models.generateContent({
                    model: "gemini-1.5-flash",
                    contents: [{ parts: [{ text: structuringPrompt }] }],
                    config: {
                        responseMimeType: "application/json",
                    },
                });

                const structuredText = structureResponse.text || "";
                let aiResponse: AISyllabus;

                try {
                    aiResponse = JSON.parse(structuredText);
                } catch {
                    const jsonMatch = structuredText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        aiResponse = JSON.parse(jsonMatch[0]);
                    } else {
                        throw new Error("Failed to parse syllabus structure");
                    }
                }

                // Transform to final syllabus
                const now = Date.now();
                const syllabus: Syllabus = {
                    id: generateId(),
                    title: aiResponse.title || projectTitle || "Untitled Syllabus",
                    description: aiResponse.description || "",
                    modules: (aiResponse.modules || []).map(transformModule),
                    createdAt: now,
                    updatedAt: now,
                };

                // Calculate stats
                const totalLOs = syllabus.modules.reduce(
                    (acc, m) => acc + m.learningObjectives.length,
                    0
                );
                const totalQuestions = syllabus.modules.reduce(
                    (acc, m) =>
                        acc +
                        m.learningObjectives.reduce(
                            (acc2, lo) => acc2 + lo.questions.length,
                            0
                        ),
                    0
                );
                const processingTimeMs = Date.now() - startTime;

                console.log("=== SYLLABUS GENERATED ===");
                console.log("Modules:", syllabus.modules.length);
                console.log("Total LOs:", totalLOs);
                console.log("Total Questions:", totalQuestions);
                console.log("Processing Time:", processingTimeMs, "ms");

                // Send stats
                sendEvent(controller, {
                    type: "stats",
                    stats: {
                        searchQueries,
                        documentsAnalyzed: pdfUrls.length,
                        processingTimeMs,
                    },
                });

                // Send completion event with full research report
                sendEvent(controller, {
                    type: "complete",
                    syllabus,
                    researchReport,
                });
            } catch (error) {
                console.error("Error in deep research processing:", error);
                sendEvent(controller, {
                    type: "error",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Failed to process syllabus",
                });
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
