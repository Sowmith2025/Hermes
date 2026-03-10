"use client";

import { cn } from "@/lib/utils";
import type {
    ChatMessage,
    UploadedFile,
    ToolCallResult,
    AgentStep,
} from "@/lib/types";
import {
    User,
    Paperclip,
    Wrench,
    ChevronDown,
    ChevronUp,
    Loader2,
    CheckCircle,
    AlertCircle,
    Brain,
    Upload,
    Image as ImageIcon,
    Film,
    Download,
    PartyPopper,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useState } from "react";
import { ScriptPreview } from "./script-preview";
import { ScriptEditDiffDisplay } from "./script-edit-diff";

type ChatMessageProps = {
    message: ChatMessage;
};

function AttachmentPreview({ attachment }: { attachment: UploadedFile }) {
    if (attachment.type === "image") {
        return (
            <div className="relative h-20 w-20 rounded-md overflow-hidden border border-border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={attachment.url}
                    alt={attachment.name}
                    className="h-full w-full object-cover"
                />
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            <span className="truncate max-w-[150px]">{attachment.name}</span>
        </div>
    );
}

function ToolCallDisplay({ toolCall }: { toolCall: ToolCallResult }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const status = toolCall.status || "completed";

    const getStatusIcon = () => {
        switch (status) {
            case "running":
                return (
                    <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
                );
            case "completed":
                return <CheckCircle className="h-4 w-4 text-green-500" />;
            case "error":
                return <AlertCircle className="h-4 w-4 text-red-500" />;
            default:
                return <Wrench className="h-4 w-4 text-primary" />;
        }
    };

    const getToolDisplayName = (toolName: string) => {
        const names: Record<string, string> = {
            save_overview: "Saving project overview",
            save_aesthetic: "Saving art style",
            save_brand: "Saving brand guidelines",
            add_character: "Creating character",
            update_character: "Updating character",
            generate_character_angles: "Generating character angles",
            create_voice_clone: "Creating voice clone",
            generate_script: "Generating script",
            update_script: "Updating script",
            add_scene: "Adding scene",
            remove_scene: "Removing scene",
            extract_locations: "Extracting locations",
            extract_attires: "Extracting character attires",
            update_checklist: "Updating checklist",
            show_preview: "Updating preview",
            request_upload: "Requesting upload",
            generate_location_image: "Generating location image",
            generate_attire_angles: "Generating attire references",
        };
        return names[toolName] || toolName;
    };

    return (
        <div className="rounded-md border border-border bg-muted/50 text-sm overflow-hidden">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex w-full items-center justify-between px-3 py-2 hover:bg-muted/80"
            >
                <div className="flex items-center gap-2">
                    {getStatusIcon()}
                    <span className="font-medium">
                        {getToolDisplayName(toolCall.toolName)}
                    </span>
                    {status === "running" && (
                        <span className="text-xs text-muted-foreground">
                            {toolCall.outputMessage || "Processing..."}
                        </span>
                    )}
                </div>
                {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                ) : (
                    <ChevronDown className="h-4 w-4" />
                )}
            </button>

            {isExpanded && (
                <div className="border-t border-border px-3 py-2 space-y-2">
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">
                            Arguments:
                        </p>
                        <pre className="text-xs text-muted-foreground overflow-x-auto bg-background rounded p-2">
                            {JSON.stringify(toolCall.args, null, 2)}
                        </pre>
                    </div>
                    {toolCall.result !== undefined &&
                        toolCall.result !== null && (
                            <div>
                                <p className="text-xs text-muted-foreground mb-1">
                                    Result:
                                </p>
                                <pre className="text-xs text-muted-foreground overflow-x-auto bg-background rounded p-2">
                                    {JSON.stringify(toolCall.result, null, 2)}
                                </pre>
                            </div>
                        )}
                </div>
            )}

            {/* Output images inline */}
            {toolCall.outputImages && toolCall.outputImages.length > 0 && (
                <div className="border-t border-border px-3 py-2">
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                        <ImageIcon className="h-3 w-3" />
                        Generated {toolCall.outputImages.length} image
                        {toolCall.outputImages.length > 1 ? "s" : ""}
                    </p>
                    {/* Thumbnail images - show in proper aspect ratio */}
                    {toolCall.toolName === "edit_thumbnail" ? (
                        <div className="space-y-2">
                            {toolCall.outputImages.map((url, idx) => (
                                <div
                                    key={idx}
                                    className="aspect-video max-w-sm overflow-hidden rounded-md bg-background border border-border"
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={url}
                                        alt={`Edited thumbnail ${idx + 1}`}
                                        className="h-full w-full object-cover"
                                    />
                                </div>
                            ))}
                        </div>
                    ) : toolCall.toolName === "edit_location_image" ||
                      toolCall.toolName === "generate_location_image" ? (
                        /* Location images - show larger with video aspect */
                        <div className="space-y-2">
                            {toolCall.outputImages.map((url, idx) => (
                                <div
                                    key={idx}
                                    className="aspect-video max-w-sm overflow-hidden rounded-md bg-background border border-border"
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={url}
                                        alt={`Location ${idx + 1}`}
                                        className="h-full w-full object-cover"
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        /* Character angles and other square images */
                        <div className="grid grid-cols-4 gap-2">
                            {toolCall.outputImages.map((url, idx) => (
                                <div
                                    key={idx}
                                    className="aspect-square overflow-hidden rounded-md bg-background border border-border"
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={url}
                                        alt={`Generated ${idx + 1}`}
                                        className="h-full w-full object-cover"
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Output message */}
            {status === "completed" && toolCall.outputMessage && (
                <div className="border-t border-border px-3 py-2 text-xs text-green-600">
                    ✓ {toolCall.outputMessage}
                </div>
            )}

            {/* Error message */}
            {status === "error" && toolCall.error && (
                <div className="border-t border-border px-3 py-2 text-xs text-red-600">
                    ✗ {toolCall.error}
                </div>
            )}
        </div>
    );
}

function AgentStepDisplay({ step }: { step: AgentStep }) {
    const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);

    if (step.type === "thinking") {
        return (
            <div className="mb-2">
                <button
                    onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                >
                    <Brain className="h-3 w-3" />
                    <span>View thinking process</span>
                    {isThinkingExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                    ) : (
                        <ChevronDown className="h-3 w-3" />
                    )}
                </button>
                {isThinkingExpanded && (
                    <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                        {step.content}
                    </div>
                )}
            </div>
        );
    }

    if (step.type === "tool" && step.toolCall) {
        return (
            <div className="mb-2">
                <ToolCallDisplay toolCall={step.toolCall} />
            </div>
        );
    }

    if (step.type === "upload_request") {
        return (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                <Upload className="h-4 w-4 text-primary" />
                <span>{step.content}</span>
            </div>
        );
    }

    if (step.type === "script_preview" && step.scenes) {
        return (
            <div className="mb-2">
                <div className="flex items-center gap-2 mb-2 text-sm font-medium">
                    <Film className="h-4 w-4 text-primary" />
                    <span>Generated Script ({step.scenes.length} scenes)</span>
                </div>
                <ScriptPreview
                    scenes={step.scenes}
                    maxHeight="350px"
                    isEditable={false}
                />
            </div>
        );
    }

    if (step.type === "script_edit" && step.editDiff) {
        return (
            <div className="mb-2">
                <ScriptEditDiffDisplay diff={step.editDiff} />
            </div>
        );
    }

    if (
        step.type === "script_edit" &&
        step.editDiffs &&
        step.editDiffs.length > 0
    ) {
        return (
            <div className="mb-2 space-y-2">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                    {step.editDiffs.length} change
                    {step.editDiffs.length > 1 ? "s" : ""} made:
                </div>
                {step.editDiffs.map((diff, idx) => (
                    <ScriptEditDiffDisplay key={idx} diff={diff} />
                ))}
            </div>
        );
    }

    if (step.type === "preprocessing_result" && step.preprocessingResult) {
        const { locationsCount, attiresCount, scenesTagged } =
            step.preprocessingResult;
        return (
            <div className="mb-2 rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span>Preprocessing Complete</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded border bg-background p-2 text-center">
                        <div className="text-lg font-bold text-primary">
                            {locationsCount}
                        </div>
                        <div className="text-muted-foreground">Locations</div>
                    </div>
                    <div className="rounded border bg-background p-2 text-center">
                        <div className="text-lg font-bold text-primary">
                            {attiresCount}
                        </div>
                        <div className="text-muted-foreground">Attires</div>
                    </div>
                    <div className="rounded border bg-background p-2 text-center">
                        <div className="text-lg font-bold text-primary">
                            {scenesTagged}
                        </div>
                        <div className="text-muted-foreground">Tagged</div>
                    </div>
                </div>
            </div>
        );
    }

    // Assets generated (locations + attires)
    if (step.type === "assets_generated" && step.generatedAssets) {
        const { generatedLocations, generatedAttires } = step.generatedAssets;
        return (
            <div className="mb-2 rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span>Assets Generated</span>
                </div>

                {/* Locations */}
                {generatedLocations.length > 0 && (
                    <div>
                        <h4 className="text-xs font-medium text-muted-foreground mb-2">
                            Location Images ({generatedLocations.length})
                        </h4>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                            {generatedLocations.map((loc) => (
                                <div key={loc.id} className="shrink-0">
                                    <div className="h-16 w-24 overflow-hidden rounded-lg border bg-muted">
                                        {loc.imageUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={loc.imageUrl}
                                                alt={loc.name}
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
                                                Failed
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground text-center mt-1 truncate max-w-[96px]">
                                        {loc.name}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Attires */}
                {generatedAttires.length > 0 && (
                    <div>
                        <h4 className="text-xs font-medium text-muted-foreground mb-2">
                            Character Attires ({generatedAttires.length})
                        </h4>
                        <div className="space-y-2">
                            {generatedAttires.map((att) => (
                                <div
                                    key={att.id}
                                    className="flex items-center gap-2"
                                >
                                    <span className="text-xs font-medium shrink-0 min-w-[100px]">
                                        {att.characterName} - {att.name}
                                    </span>
                                    <div className="flex gap-1 overflow-x-auto">
                                        {att.generatedAngles?.map(
                                            (url, idx) => (
                                                <div
                                                    key={idx}
                                                    className="h-10 w-10 shrink-0 overflow-hidden rounded border bg-muted"
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={url}
                                                        alt={`${
                                                            att.name
                                                        } angle ${idx + 1}`}
                                                        className="h-full w-full object-cover"
                                                    />
                                                </div>
                                            )
                                        ) || (
                                            <span className="text-xs text-muted-foreground">
                                                Failed
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Thumbnails generated
    if (step.type === "thumbnails_generated" && step.generatedThumbnails) {
        const { thumbnails, totalGenerated, totalScenes, aspectRatio } =
            step.generatedThumbnails;
        const isPortrait = aspectRatio === "9:16";
        return (
            <div className="mb-2 rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span>
                        Thumbnails Generated ({totalGenerated}/{totalScenes})
                    </span>
                </div>

                <div
                    className={`grid gap-2 max-h-80 overflow-y-auto ${
                        isPortrait ? "grid-cols-3" : "grid-cols-2"
                    }`}
                >
                    {thumbnails.map((thumb) => (
                        <div
                            key={thumb.sceneId}
                            className="rounded-lg border overflow-hidden bg-background"
                        >
                            <div
                                className={`relative ${
                                    isPortrait
                                        ? "aspect-[9/16]"
                                        : "aspect-video"
                                }`}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={thumb.thumbnailUrl}
                                    alt={`Scene ${thumb.sceneIndex + 1}`}
                                    className="h-full w-full object-cover"
                                />
                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                                    <span className="text-xs font-medium text-white">
                                        Scene {thumb.sceneIndex + 1}
                                    </span>
                                </div>
                            </div>
                            <p className="text-[10px] text-muted-foreground p-2 line-clamp-2">
                                {thumb.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Videos generated
    if (step.type === "videos_generated" && step.generatedVideos) {
        const { videos, totalGenerated, totalScenes, aspectRatio } =
            step.generatedVideos;
        const isPortrait = aspectRatio === "9:16";
        return (
            <div className="mb-2 rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span>
                        Videos Generated ({totalGenerated}/{totalScenes})
                    </span>
                </div>

                <div
                    className={`grid gap-2 max-h-96 overflow-y-auto ${
                        isPortrait ? "grid-cols-3" : "grid-cols-2"
                    }`}
                >
                    {videos.map((vid) => (
                        <div
                            key={vid.sceneId}
                            className="rounded-lg border overflow-hidden bg-black"
                        >
                            <div
                                className={`relative ${
                                    isPortrait
                                        ? "aspect-[9/16]"
                                        : "aspect-video"
                                }`}
                            >
                                <video
                                    src={vid.videoUrl}
                                    className="h-full w-full object-contain"
                                    controls
                                    playsInline
                                />
                                <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent p-2 pointer-events-none">
                                    <span className="text-xs font-medium text-white">
                                        Scene {vid.sceneIndex + 1}
                                    </span>
                                </div>
                            </div>
                            <p className="text-[10px] text-muted-foreground p-2 line-clamp-2 bg-background">
                                {vid.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Final video ready
    if (step.type === "final_video_ready" && step.finalVideo) {
        const { videoUrl, totalScenes, totalDuration, aspectRatio, fileName } =
            step.finalVideo;
        const isPortrait = aspectRatio === "9:16";

        const handleDownload = () => {
            const link = document.createElement("a");
            link.href = videoUrl;
            link.download = fileName;
            link.target = "_blank";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        return (
            <div className="mb-2 rounded-lg border bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 p-4 space-y-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500 text-white">
                        <PartyPopper className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-green-700 dark:text-green-400">
                            🎉 Your Video is Ready!
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            {totalScenes} scenes • ~{totalDuration}s •{" "}
                            {aspectRatio}
                        </p>
                    </div>
                </div>

                <div
                    className={`relative rounded-lg border bg-black overflow-hidden ${
                        isPortrait
                            ? "aspect-[9/16] max-w-[200px] mx-auto"
                            : "aspect-video max-w-md mx-auto"
                    }`}
                >
                    <video
                        src={videoUrl}
                        className="h-full w-full object-contain"
                        controls
                        playsInline
                    />
                </div>

                <button
                    onClick={handleDownload}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
                >
                    <Download className="h-5 w-5" />
                    Download Final Video
                </button>

                <p className="text-xs text-center text-muted-foreground">
                    Click the button above or{" "}
                    <a
                        href={videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-primary"
                    >
                        open in new tab
                    </a>
                </p>
            </div>
        );
    }

    if (step.type === "text" && step.content) {
        return (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5">
                <ReactMarkdown>{step.content}</ReactMarkdown>
            </div>
        );
    }

    return null;
}

export function ChatMessageComponent({ message }: ChatMessageProps) {
    const isUser = message.role === "user";

    return (
        <div
            className={cn(
                "flex gap-3 px-4 py-4",
                isUser ? "bg-transparent" : "bg-muted/30"
            )}
        >
            {/* Avatar */}
            {isUser ? (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <User className="h-4 w-4" />
                </div>
            ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                    src="/images/icon.png"
                    alt="Hermes Director"
                    className="h-8 w-8 shrink-0 rounded-full"
                />
            )}

            {/* Content */}
            <div className="flex-1 space-y-2 overflow-hidden">
                {/* Role label */}
                <p className="text-sm font-medium">
                    {isUser ? "You" : "Hermes Director"}
                </p>

                {/* Attachments (for user messages) */}
                {message.attachments && message.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {message.attachments.map((attachment, idx) => (
                            <AttachmentPreview
                                key={idx}
                                attachment={attachment}
                            />
                        ))}
                    </div>
                )}

                {/* User message content */}
                {isUser && message.content && (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                        <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                )}

                {/* Assistant message with agent steps */}
                {!isUser && (
                    <>
                        {/* Display agent steps progressively */}
                        {message.agentSteps && message.agentSteps.length > 0 ? (
                            <div className="space-y-2">
                                {message.agentSteps.map((step) => (
                                    <AgentStepDisplay
                                        key={step.id}
                                        step={step}
                                    />
                                ))}
                            </div>
                        ) : message.content ? (
                            // Fallback for messages without steps
                            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5">
                                <ReactMarkdown>{message.content}</ReactMarkdown>
                            </div>
                        ) : null}

                        {/* Streaming indicator */}
                        {message.isStreaming && (
                            <div className="flex items-center gap-1 mt-2">
                                <div className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                                <div className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                                <div className="h-2 w-2 animate-bounce rounded-full bg-primary" />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
