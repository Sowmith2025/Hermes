"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { useAppStore } from "@/lib/store";
import { ChatMessageComponent } from "./chat-message";
import { ChatInput } from "./chat-input";
import { UploadRequestModal } from "./upload-request-modal";
import type {
    ChatMessage,
    UploadedFile,
    GeminiContent,
    ToolCallResult,
    AgentStep,
    Scene,
    ScriptEditDiff,
    PreprocessingResult,
    GeneratedAssetsResult,
    GeneratedThumbnailsResult,
    GeneratedVideosResult,
    FinalVideoResult,
} from "@/lib/types";
import Image from "next/image";

// Maximum iterations for the agentic loop to prevent infinite loops
const MAX_AGENT_ITERATIONS = 10;

export function ChatInterface() {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const conversationHistoryRef = useRef<GeminiContent[]>([]);
    const [uploadRequest, setUploadRequest] = useState<{
        type: string;
        purpose: string;
        targetId?: string;
    } | null>(null);

    const {
        project,
        messages,
        isGenerating,
        addMessage,
        updateMessage,
        setIsGenerating,
        setOverview,
        setAesthetic,
        setBrand,
        addCharacter,
        updateCharacter,
        setScenes,
        updateScene,
        addScene,
        removeScene,
        setLocations,
        updateLocation,
        setCharacterAttires,
        updateCharacterAttire,
        updateChecklistItem,
        setCurrentArtifact,
        setFinalVideoUrl,
    } = useAppStore();

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Apply state updates from tool execution
    const applyStateUpdates = useCallback(
        (stateUpdates: { type: string; payload: unknown }) => {
            const { type, payload } = stateUpdates;
            switch (type) {
                case "setOverview":
                    setOverview(payload as Parameters<typeof setOverview>[0]);
                    break;
                case "setAesthetic":
                    setAesthetic(payload as Parameters<typeof setAesthetic>[0]);
                    break;
                case "setBrand":
                    setBrand(payload as Parameters<typeof setBrand>[0]);
                    break;
                case "addCharacter":
                    addCharacter(payload as Parameters<typeof addCharacter>[0]);
                    break;
                case "updateCharacter": {
                    const p = payload as {
                        id: string;
                        updates: Parameters<typeof updateCharacter>[1];
                    };
                    updateCharacter(p.id, p.updates);
                    break;
                }
                case "setScenes":
                    setScenes(payload as Parameters<typeof setScenes>[0]);
                    break;
                case "updateScene": {
                    const p = payload as {
                        id: string;
                        updates: Parameters<typeof updateScene>[1];
                    };
                    updateScene(p.id, p.updates);
                    break;
                }
                case "updateScenes": {
                    // Batch update multiple scenes
                    const updates = payload as Array<{
                        sceneId: string;
                        type?: string;
                        description?: string;
                        dialogue?: string;
                        speakingCharacterId?: string;
                        duration?: number;
                        includeBrandLogo?: boolean;
                    }>;
                    for (const update of updates) {
                        const sceneUpdates: Partial<Scene> = {};
                        if (update.type !== undefined)
                            sceneUpdates.type = update.type as Scene["type"];
                        if (update.description !== undefined)
                            sceneUpdates.description = update.description;
                        if (update.duration !== undefined)
                            sceneUpdates.duration = update.duration;
                        if (update.includeBrandLogo !== undefined)
                            sceneUpdates.includeBrandLogo =
                                update.includeBrandLogo;
                        if (
                            update.dialogue !== undefined ||
                            update.speakingCharacterId !== undefined
                        ) {
                            // Get existing scene to preserve script
                            const currentProject =
                                useAppStore.getState().project;
                            const existingScene = currentProject?.scenes.find(
                                (s) => s.id === update.sceneId
                            );
                            sceneUpdates.script = {
                                characterId:
                                    update.speakingCharacterId ||
                                    existingScene?.script?.characterId ||
                                    "",
                                dialogue:
                                    update.dialogue ??
                                    existingScene?.script?.dialogue ??
                                    "",
                            };
                        }
                        if (Object.keys(sceneUpdates).length > 0) {
                            updateScene(update.sceneId, sceneUpdates);
                        }
                    }
                    break;
                }
                case "addScene":
                    addScene(payload as Parameters<typeof addScene>[0]);
                    break;
                case "removeScene":
                    removeScene(payload as string);
                    break;
                case "setLocations":
                    setLocations(payload as Parameters<typeof setLocations>[0]);
                    break;
                case "updateLocation": {
                    const p = payload as {
                        id: string;
                        updates: Parameters<typeof updateLocation>[1];
                    };
                    updateLocation(p.id, p.updates);
                    break;
                }
                case "setCharacterAttires":
                    setCharacterAttires(
                        payload as Parameters<typeof setCharacterAttires>[0]
                    );
                    break;
                case "updateCharacterAttire": {
                    const p = payload as {
                        id: string;
                        updates: Parameters<typeof updateCharacterAttire>[1];
                    };
                    updateCharacterAttire(p.id, p.updates);
                    break;
                }
                case "updateChecklistItem": {
                    const p = payload as {
                        id: string;
                        updates: Parameters<typeof updateChecklistItem>[1];
                    };
                    updateChecklistItem(p.id, p.updates);
                    break;
                }
                case "setCurrentArtifact":
                    setCurrentArtifact(
                        payload as Parameters<typeof setCurrentArtifact>[0]
                    );
                    break;
                case "setFinalVideoUrl":
                    setFinalVideoUrl(payload as string);
                    break;
            }
        },
        [
            setOverview,
            setAesthetic,
            setBrand,
            addCharacter,
            updateCharacter,
            setScenes,
            updateScene,
            addScene,
            removeScene,
            setLocations,
            updateLocation,
            setCharacterAttires,
            updateCharacterAttire,
            updateChecklistItem,
            setCurrentArtifact,
            setFinalVideoUrl,
        ]
    );

    // Execute a single tool call
    const executeToolCall = useCallback(
        async (
            toolCall: ToolCallResult,
            onStatusUpdate: (status: string, message?: string) => void
        ): Promise<{
            result: unknown;
            outputImages?: string[];
            outputScenes?: Scene[];
            outputEditDiff?: ScriptEditDiff;
            outputEditDiffs?: ScriptEditDiff[];
            outputPreprocessing?: PreprocessingResult;
            outputGeneratedAssets?: GeneratedAssetsResult;
            outputGeneratedThumbnails?: GeneratedThumbnailsResult;
            outputGeneratedVideos?: GeneratedVideosResult;
            outputFinalVideo?: FinalVideoResult;
            outputMessage?: string;
        }> => {
            // Get fresh project state
            const currentProject = useAppStore.getState().project;

            const response = await fetch("/api/execute-tool", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    toolName: toolCall.toolName,
                    args: toolCall.args,
                    projectState: currentProject
                        ? {
                              overview: currentProject.overview,
                              aesthetic: currentProject.aesthetic,
                              brand: currentProject.brand,
                              characters: currentProject.characters,
                              scenes: currentProject.scenes,
                              locations: currentProject.locations,
                              characterAttires: currentProject.characterAttires,
                          }
                        : null,
                }),
            });

            const result = await response.json();

            if (result.success && result.stateUpdates) {
                applyStateUpdates(result.stateUpdates);
            }

            // Apply additional state updates (e.g., for script generation)
            if (result.success && result.additionalUpdates) {
                for (const update of result.additionalUpdates) {
                    applyStateUpdates(update);
                }
            }

            // Extract output images if present (for character angles, location images, thumbnails, etc.)
            let outputImages: string[] | undefined;
            if (result.data?.generatedAngles) {
                outputImages = result.data.generatedAngles;
            } else if (result.data?.imageUrl) {
                // Single image (e.g., location image)
                outputImages = [result.data.imageUrl as string];
            } else if (result.data?.thumbnailUrl) {
                // Single thumbnail (e.g., edit_thumbnail)
                outputImages = [result.data.thumbnailUrl as string];
            }

            // Extract scenes if present (for script generation)
            let outputScenes: Scene[] | undefined;
            if (result.data?.scenes) {
                outputScenes = result.data.scenes;
            }

            // Extract edit diff if present (for edit_scene - single diff)
            let outputEditDiff: ScriptEditDiff | undefined;
            if (
                result.data?.oldValue !== undefined &&
                result.data?.newValue !== undefined
            ) {
                outputEditDiff = {
                    sceneNumber: result.data.sceneNumber as number,
                    field: result.data.field as string,
                    oldValue: result.data.oldValue as string,
                    newValue: result.data.newValue as string,
                    reason: result.data.reason as string | undefined,
                };
            }

            // Extract multiple diffs if present (for update_script - multiple diffs)
            let outputEditDiffs: ScriptEditDiff[] | undefined;
            if (result.data?.diffs && Array.isArray(result.data.diffs)) {
                outputEditDiffs = result.data.diffs as ScriptEditDiff[];
            }

            // Extract preprocessing result if present
            let outputPreprocessing: PreprocessingResult | undefined;
            if (
                result.data?.locations &&
                result.data?.attires &&
                result.data?.sceneUpdates
            ) {
                outputPreprocessing = {
                    locationsCount: (result.data.locations as unknown[]).length,
                    attiresCount: (result.data.attires as unknown[]).length,
                    scenesTagged: (result.data.sceneUpdates as unknown[])
                        .length,
                };
            }

            // Extract generated assets if present (for generate_preprocessing_assets)
            let outputGeneratedAssets: GeneratedAssetsResult | undefined;
            if (
                result.data?.generatedLocations ||
                result.data?.generatedAttires
            ) {
                outputGeneratedAssets = {
                    generatedLocations: (result.data.generatedLocations ||
                        []) as GeneratedAssetsResult["generatedLocations"],
                    generatedAttires: (result.data.generatedAttires ||
                        []) as GeneratedAssetsResult["generatedAttires"],
                };
            }

            // Extract generated thumbnails if present (for generate_all_thumbnails)
            let outputGeneratedThumbnails:
                | GeneratedThumbnailsResult
                | undefined;
            if (result.data?.generatedThumbnails) {
                outputGeneratedThumbnails = {
                    thumbnails: result.data
                        .generatedThumbnails as GeneratedThumbnailsResult["thumbnails"],
                    totalGenerated: result.data.totalGenerated as number,
                    totalScenes: result.data.totalScenes as number,
                    aspectRatio: result.data.aspectRatio as
                        | "16:9"
                        | "9:16"
                        | undefined,
                };
            }

            // Extract generated videos if present (for generate_all_videos)
            let outputGeneratedVideos: GeneratedVideosResult | undefined;
            if (result.data?.generatedVideos) {
                outputGeneratedVideos = {
                    videos: result.data
                        .generatedVideos as GeneratedVideosResult["videos"],
                    totalGenerated: result.data.totalGenerated as number,
                    totalScenes: result.data.totalScenes as number,
                    aspectRatio: result.data.aspectRatio as
                        | "16:9"
                        | "9:16"
                        | undefined,
                };
            }

            // Extract final video if present (for stitch_final_video)
            let outputFinalVideo: FinalVideoResult | undefined;
            if (result.data?.finalVideo) {
                outputFinalVideo = result.data.finalVideo as FinalVideoResult;
            }

            return {
                result,
                outputImages,
                outputScenes,
                outputEditDiff,
                outputEditDiffs,
                outputPreprocessing,
                outputGeneratedAssets,
                outputGeneratedThumbnails,
                outputGeneratedVideos,
                outputFinalVideo,
                outputMessage: result.data?.message,
            };
        },
        [applyStateUpdates]
    );

    // Get current project state for API calls
    const getProjectState = useCallback(() => {
        const currentProject = useAppStore.getState().project;
        if (!currentProject) return null;

        return {
            status: currentProject.status,
            overview: currentProject.overview,
            aesthetic: currentProject.aesthetic,
            brand: currentProject.brand,
            characters: currentProject.characters.map((c) => ({
                id: c.id,
                name: c.name,
                hasReferencePhotos: c.referencePhotos.length > 0,
                hasVoiceSample: !!c.voiceSampleUrl,
                hasGeneratedAngles: c.generatedAngles.length > 0,
                hasVoiceClone: !!c.voiceCloneId,
                status: c.status,
            })),
            sceneCount: currentProject.scenes.length,
            // Include full location details so agent knows IDs
            locations: currentProject.locations.map((loc) => ({
                id: loc.id,
                name: loc.name,
                description: loc.description,
                hasImage: !!loc.referenceImageUrl,
                status: loc.status,
            })),
            // Include full attire details so agent knows IDs
            characterAttires: currentProject.characterAttires.map((att) => ({
                id: att.id,
                characterId: att.characterId,
                characterName:
                    currentProject.characters.find(
                        (c) => c.id === att.characterId
                    )?.name || "Unknown",
                name: att.name,
                description: att.description,
                hasAngles: att.referenceAngles.length > 0,
                status: att.status,
            })),
        };
    }, []);

    // Main agentic loop - handles tool calls and continues until model is done
    const runAgentLoop = useCallback(
        async (
            initialMessage: string,
            attachments: UploadedFile[] | undefined,
            assistantMessageId: string,
            updateAssistantMessage: (updates: Partial<ChatMessage>) => void
        ) => {
            let iterations = 0;
            let continueLoop = true;
            const allSteps: AgentStep[] = [];

            while (continueLoop && iterations < MAX_AGENT_ITERATIONS) {
                iterations++;

                // Call the chat API
                const response = await fetch("/api/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        message: iterations === 1 ? initialMessage : "",
                        attachments: iterations === 1 ? attachments : undefined,
                        conversationHistory: conversationHistoryRef.current,
                        projectState: getProjectState(),
                    }),
                });

                if (!response.ok) {
                    throw new Error("Failed to get response");
                }

                const data = await response.json();

                // Update conversation history
                conversationHistoryRef.current = data.updatedHistory;

                // Add thinking step if available
                if (data.thoughtSummary) {
                    const thinkingStep: AgentStep = {
                        id: crypto.randomUUID(),
                        type: "thinking",
                        content: data.thoughtSummary,
                        timestamp: Date.now(),
                    };
                    allSteps.push(thinkingStep);
                    updateAssistantMessage({
                        agentSteps: [...allSteps],
                        thoughtSummary: data.thoughtSummary,
                    });
                }

                // Process tool calls if present
                if (data.toolCalls && data.toolCalls.length > 0) {
                    const functionResponseParts: Array<{
                        functionResponse: { name: string; response: unknown };
                    }> = [];

                    for (const toolCall of data.toolCalls) {
                        // Check for upload request - this pauses the loop
                        if (toolCall.toolName === "request_upload") {
                            setUploadRequest({
                                type: toolCall.args.uploadType as string,
                                purpose: toolCall.args.purpose as string,
                                targetId: toolCall.args.targetId as
                                    | string
                                    | undefined,
                            });

                            // Add upload request step
                            const uploadStep: AgentStep = {
                                id: crypto.randomUUID(),
                                type: "upload_request",
                                content: `Please upload: ${toolCall.args.purpose}`,
                                toolCall: {
                                    ...toolCall,
                                    status: "completed",
                                },
                                timestamp: Date.now(),
                            };
                            allSteps.push(uploadStep);

                            // Add any text response
                            if (data.message) {
                                const textStep: AgentStep = {
                                    id: crypto.randomUUID(),
                                    type: "text",
                                    content: data.message,
                                    timestamp: Date.now(),
                                };
                                allSteps.push(textStep);
                            }

                            updateAssistantMessage({
                                content: data.message || "",
                                agentSteps: [...allSteps],
                                isStreaming: false,
                            });

                            // Stop the loop - wait for user upload
                            return;
                        }

                        // Add tool step as "running"
                        const toolStep: AgentStep = {
                            id: crypto.randomUUID(),
                            type: "tool",
                            toolCall: {
                                ...toolCall,
                                status: "running",
                            },
                            timestamp: Date.now(),
                        };
                        allSteps.push(toolStep);
                        updateAssistantMessage({
                            agentSteps: [...allSteps],
                        });

                        // Execute the tool
                        try {
                            const {
                                result,
                                outputImages,
                                outputScenes,
                                outputEditDiff,
                                outputEditDiffs,
                                outputPreprocessing,
                                outputGeneratedAssets,
                                outputGeneratedThumbnails,
                                outputGeneratedVideos,
                                outputFinalVideo,
                                outputMessage,
                            } = await executeToolCall(
                                toolCall,
                                (status, msg) => {
                                    // Update step status during execution
                                    toolStep.toolCall!.outputMessage = msg;
                                    updateAssistantMessage({
                                        agentSteps: [...allSteps],
                                    });
                                }
                            );

                            // Update step as completed
                            toolStep.toolCall = {
                                ...toolCall,
                                status: "completed",
                                result,
                                outputImages,
                                outputMessage,
                            };
                            updateAssistantMessage({
                                agentSteps: [...allSteps],
                            });

                            // If scenes were generated, add a script preview step
                            if (outputScenes && outputScenes.length > 0) {
                                const scriptStep: AgentStep = {
                                    id: crypto.randomUUID(),
                                    type: "script_preview",
                                    scenes: outputScenes,
                                    timestamp: Date.now(),
                                };
                                allSteps.push(scriptStep);
                                updateAssistantMessage({
                                    agentSteps: [...allSteps],
                                });

                                // Show script artifact on the right
                                setCurrentArtifact({
                                    type: "script",
                                    data: null,
                                });
                            }

                            // If scene was edited (single), add a script edit diff step
                            if (outputEditDiff) {
                                const editStep: AgentStep = {
                                    id: crypto.randomUUID(),
                                    type: "script_edit",
                                    editDiff: outputEditDiff,
                                    timestamp: Date.now(),
                                };
                                allSteps.push(editStep);
                                updateAssistantMessage({
                                    agentSteps: [...allSteps],
                                });

                                // Show script artifact on the right
                                setCurrentArtifact({
                                    type: "script",
                                    data: null,
                                });
                            }

                            // If multiple scenes were edited, add a step with all diffs
                            if (outputEditDiffs && outputEditDiffs.length > 0) {
                                const editStep: AgentStep = {
                                    id: crypto.randomUUID(),
                                    type: "script_edit",
                                    editDiffs: outputEditDiffs,
                                    timestamp: Date.now(),
                                };
                                allSteps.push(editStep);
                                updateAssistantMessage({
                                    agentSteps: [...allSteps],
                                });

                                // Show script artifact on the right
                                setCurrentArtifact({
                                    type: "script",
                                    data: null,
                                });
                            }

                            // If preprocessing was completed, add a preprocessing result step
                            if (outputPreprocessing) {
                                const preprocessingStep: AgentStep = {
                                    id: crypto.randomUUID(),
                                    type: "preprocessing_result",
                                    preprocessingResult: outputPreprocessing,
                                    timestamp: Date.now(),
                                };
                                allSteps.push(preprocessingStep);
                                updateAssistantMessage({
                                    agentSteps: [...allSteps],
                                });

                                // Show preprocessing artifact on the right
                                setCurrentArtifact({
                                    type: "preprocessing",
                                    data: null,
                                });
                            }

                            // If assets were generated (locations + attires), add step
                            if (outputGeneratedAssets) {
                                const assetsStep: AgentStep = {
                                    id: crypto.randomUUID(),
                                    type: "assets_generated",
                                    generatedAssets: outputGeneratedAssets,
                                    timestamp: Date.now(),
                                };
                                allSteps.push(assetsStep);
                                updateAssistantMessage({
                                    agentSteps: [...allSteps],
                                });

                                // Show preprocessing artifact on the right
                                setCurrentArtifact({
                                    type: "preprocessing",
                                    data: null,
                                });
                            }

                            // If thumbnails were generated, add step
                            if (outputGeneratedThumbnails) {
                                const thumbnailsStep: AgentStep = {
                                    id: crypto.randomUUID(),
                                    type: "thumbnails_generated",
                                    generatedThumbnails:
                                        outputGeneratedThumbnails,
                                    timestamp: Date.now(),
                                };
                                allSteps.push(thumbnailsStep);
                                updateAssistantMessage({
                                    agentSteps: [...allSteps],
                                });

                                // Show thumbnails artifact on the right
                                setCurrentArtifact({
                                    type: "thumbnails",
                                    data: null,
                                });
                            }

                            // If a single thumbnail was edited, update the artifact panel
                            if (
                                toolCall.toolName === "edit_thumbnail" &&
                                (result as { success?: boolean })?.success
                            ) {
                                // Show thumbnails artifact on the right to reflect the edit
                                setCurrentArtifact({
                                    type: "thumbnails",
                                    data: null,
                                });
                            }

                            // If videos were generated, add step
                            if (outputGeneratedVideos) {
                                const videosStep: AgentStep = {
                                    id: crypto.randomUUID(),
                                    type: "videos_generated",
                                    generatedVideos: outputGeneratedVideos,
                                    timestamp: Date.now(),
                                };
                                allSteps.push(videosStep);
                                updateAssistantMessage({
                                    agentSteps: [...allSteps],
                                });

                                // Show videos artifact on the right
                                setCurrentArtifact({
                                    type: "videos",
                                    data: null,
                                });
                            }

                            // If final video was created, add step
                            if (outputFinalVideo) {
                                const finalVideoStep: AgentStep = {
                                    id: crypto.randomUUID(),
                                    type: "final_video_ready",
                                    finalVideo: outputFinalVideo,
                                    timestamp: Date.now(),
                                };
                                allSteps.push(finalVideoStep);
                                updateAssistantMessage({
                                    agentSteps: [...allSteps],
                                });

                                // Show final video artifact on the right
                                setCurrentArtifact({
                                    type: "final_video",
                                    data: null,
                                });
                            }

                            // Build function response for Gemini
                            functionResponseParts.push({
                                functionResponse: {
                                    name: toolCall.toolName,
                                    response: result,
                                },
                            });
                        } catch (error) {
                            toolStep.toolCall = {
                                ...toolCall,
                                status: "error",
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : "Unknown error",
                            };
                            updateAssistantMessage({
                                agentSteps: [...allSteps],
                            });

                            functionResponseParts.push({
                                functionResponse: {
                                    name: toolCall.toolName,
                                    response: {
                                        error: "Tool execution failed",
                                    },
                                },
                            });
                        }
                    }

                    // Add function responses to conversation history for next iteration
                    if (functionResponseParts.length > 0) {
                        conversationHistoryRef.current.push({
                            role: "user",
                            parts: functionResponseParts as GeminiContent["parts"],
                        });
                    }
                } else {
                    // No tool calls - add text response and exit loop
                    continueLoop = false;
                }

                // Add text response if present
                if (data.message) {
                    const textStep: AgentStep = {
                        id: crypto.randomUUID(),
                        type: "text",
                        content: data.message,
                        timestamp: Date.now(),
                    };
                    allSteps.push(textStep);
                    updateAssistantMessage({
                        content: data.message,
                        agentSteps: [...allSteps],
                        thoughtSignature: data.thoughtSignature,
                    });
                }

                // If no tool calls, we're done
                if (!data.toolCalls || data.toolCalls.length === 0) {
                    continueLoop = false;
                }
            }

            // Mark as done streaming
            updateAssistantMessage({ isStreaming: false });
        },
        [getProjectState, executeToolCall]
    );

    // Send message to chat API
    const handleSendMessage = useCallback(
        async (content: string, attachments?: UploadedFile[]) => {
            if (!content.trim() && (!attachments || attachments.length === 0))
                return;

            // Add user message
            const userMessage: ChatMessage = {
                id: crypto.randomUUID(),
                role: "user",
                content,
                timestamp: Date.now(),
                attachments,
            };
            addMessage(userMessage);
            setIsGenerating(true);

            // Create assistant message placeholder
            const assistantMessageId = crypto.randomUUID();
            const assistantMessage: ChatMessage = {
                id: assistantMessageId,
                role: "assistant",
                content: "",
                timestamp: Date.now(),
                isStreaming: true,
                agentSteps: [],
            };
            addMessage(assistantMessage);

            // Helper to update the assistant message
            const updateAssistantMessage = (updates: Partial<ChatMessage>) => {
                updateMessage(assistantMessageId, updates);
            };

            try {
                await runAgentLoop(
                    content,
                    attachments,
                    assistantMessageId,
                    updateAssistantMessage
                );
            } catch (error) {
                console.error("Error in agent loop:", error);
                updateAssistantMessage({
                    content: "Sorry, I encountered an error. Please try again.",
                    isStreaming: false,
                });
            } finally {
                setIsGenerating(false);
            }
        },
        [addMessage, updateMessage, setIsGenerating, runAgentLoop]
    );

    // Handle upload from the request modal
    const handleUploadComplete = useCallback(
        (files: UploadedFile[]) => {
            setUploadRequest(null);
            // Send the uploaded files as a new message with clear context
            const fileDescriptions = files
                .map((f) => `${f.type}: ${f.name}`)
                .join(", ");
            handleSendMessage(
                `I've uploaded the requested files: ${fileDescriptions}`,
                files
            );
        },
        [handleSendMessage]
    );

    return (
        <div className="flex h-full flex-col">
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto">
                {messages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                        <div className="mb-4">
                            <Image
                                src="/images/icon.png"
                                alt="Hermes"
                                width={64}
                                height={64}
                                className="rounded-2xl"
                            />
                        </div>
                        <h2 className="mb-2 text-xl font-semibold">
                            Welcome to Hermes
                        </h2>
                        <p className="max-w-md text-muted-foreground">
                            Your AI-powered video director for creating
                            professional, compliant video content. I&apos;ll
                            guide you through defining your project, characters,
                            and script—then help generate visual assets for
                            production.
                        </p>
                        <div className="mt-6 flex flex-wrap justify-center gap-2">
                            {[
                                "Create a compliance training video",
                                "Build an internal communications video",
                                "Design a product explainer",
                            ].map((suggestion) => (
                                <button
                                    key={suggestion}
                                    onClick={() =>
                                        handleSendMessage(suggestion)
                                    }
                                    className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {messages.map((message) => (
                            <ChatMessageComponent
                                key={message.id}
                                message={message}
                            />
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Input area */}
            <ChatInput
                onSend={handleSendMessage}
                isLoading={isGenerating}
                placeholder="Describe your video idea or ask a question..."
            />

            {/* Upload request modal */}
            {uploadRequest && (
                <UploadRequestModal
                    type={uploadRequest.type as "image" | "audio" | "document"}
                    purpose={uploadRequest.purpose}
                    onUploadComplete={handleUploadComplete}
                    onCancel={() => setUploadRequest(null)}
                />
            )}
        </div>
    );
}
