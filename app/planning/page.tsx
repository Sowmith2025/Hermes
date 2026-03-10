"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePlanningStore } from "@/lib/planning-store";
import {
    PdfUpload,
    SyllabusMindMap,
    ModuleGrid,
    ModuleDetailsPanel,
    ProcessingLogs,
} from "@/components/planning";
import type { LiveLogEntry } from "@/components/planning";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ModeToggle } from "@/components/mode-toggle";
import {
    Loader2,
    ArrowLeft,
    Plus,
    Trash2,
    Sparkles,
    Map,
    Grid3X3,
    FileText,
    CheckCircle2,
    AlertCircle,
    History,
    X,
} from "lucide-react";
import type {
    PlanningProject,
    Syllabus,
    Module,
    LearningObjective,
    Question,
    ProcessingSession,
} from "@/lib/planning-types";

type ViewMode = "upload" | "mindmap" | "grid";

// Streaming event types from API
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
    | {
          type: "stats";
          stats: {
              searchQueries: number;
              documentsAnalyzed: number;
              processingTimeMs: number;
          };
      }
    | { type: "complete"; syllabus: Syllabus; researchReport: string }
    | { type: "error"; message: string };

export default function PlanningPage() {
    const {
        _hasHydrated,
        projects,
        currentProjectId,
        isProcessing,
        createProject,
        setCurrentProject,
        deleteProject,
        addPdfToProject,
        removePdfFromProject,
        setSyllabus,
        updateProjectStatus,
        updateSyllabus,
        updateModule,
        updateLearningObjective,
        updateQuestion,
        setIsProcessing,
        selectedModuleId,
        setSelectedModule,
        startProcessingSession,
        addLogEntry,
        completeProcessingSession,
    } = usePlanningStore();

    const [viewMode, setViewMode] = useState<ViewMode>("upload");
    const [newProjectTitle, setNewProjectTitle] = useState("");
    const [newProjectDescription, setNewProjectDescription] = useState("");
    const [showNewProject, setShowNewProject] = useState(false);
    const [processingError, setProcessingError] = useState<string | null>(null);

    // Streaming state
    const [currentPhase, setCurrentPhase] = useState<string>("");
    const [liveLogEntries, setLiveLogEntries] = useState<LiveLogEntry[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(
        null
    );
    const [showHistoryPanel, setShowHistoryPanel] = useState(false);
    const [selectedHistorySession, setSelectedHistorySession] =
        useState<ProcessingSession | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const currentProject = currentProjectId
        ? projects.find((p) => p.id === currentProjectId)
        : null;

    // Auto-switch to mind map when syllabus is generated
    useEffect(() => {
        if (
            currentProject?.syllabus &&
            viewMode === "upload" &&
            !isProcessing
        ) {
            setViewMode("mindmap");
        }
    }, [currentProject?.syllabus, viewMode, isProcessing]);

    const handleCreateProject = () => {
        if (!newProjectTitle.trim()) return;
        createProject(newProjectTitle.trim(), newProjectDescription.trim());
        setNewProjectTitle("");
        setNewProjectDescription("");
        setShowNewProject(false);
        setViewMode("upload");
    };

    const handleFilesUploaded = (files: { url: string; name: string }[]) => {
        if (!currentProjectId) return;
        files.forEach((file) => {
            addPdfToProject(currentProjectId, file.url, file.name);
        });
    };

    const handleRemoveFile = (url: string) => {
        if (!currentProjectId) return;
        removePdfFromProject(currentProjectId, url);
    };

    const addLiveLogEntry = useCallback(
        (entry: Omit<LiveLogEntry, "id" | "timestamp">) => {
            const newEntry: LiveLogEntry = {
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                ...entry,
            };
            setLiveLogEntries((prev) => [...prev, newEntry]);

            // Also persist to store if we have a session
            if (currentSessionId && currentProjectId) {
                addLogEntry(currentProjectId, currentSessionId, {
                    type: entry.type as import("@/lib/planning-types").ProcessingLogType,
                    phase: entry.phase || "",
                    title: entry.title,
                    content: entry.content,
                    metadata: entry.metadata,
                });
            }
        },
        [currentSessionId, currentProjectId, addLogEntry]
    );

    const handleStreamEvent = useCallback(
        (event: StreamEvent, projectId: string) => {
            switch (event.type) {
                case "session_start":
                    // Start a new session in the store
                    const sessionId = startProcessingSession(projectId);
                    setCurrentSessionId(sessionId);
                    break;

                case "status":
                    setCurrentPhase(event.phase);
                    addLiveLogEntry({
                        type: "status",
                        title: event.title,
                        content: event.message,
                        phase: event.phase,
                    });
                    break;

                case "thought":
                    addLiveLogEntry({
                        type: "thought",
                        title: event.title,
                        content: event.content,
                        phase: currentPhase,
                    });
                    break;

                case "tool_call":
                    addLiveLogEntry({
                        type: "tool_call",
                        title: `Tool: ${event.toolName}`,
                        content: event.description,
                        phase: currentPhase,
                        metadata: { toolName: event.toolName },
                    });
                    break;

                case "search":
                    addLiveLogEntry({
                        type: "search",
                        title: "Search Query",
                        content: event.query,
                        phase: currentPhase,
                        metadata: event.results
                            ? { results: event.results }
                            : undefined,
                    });
                    break;

                case "read":
                    addLiveLogEntry({
                        type: "read",
                        title: `Reading: ${event.source}`,
                        content: event.preview,
                        phase: currentPhase,
                        metadata: { source: event.source },
                    });
                    break;

                case "research_output":
                    addLiveLogEntry({
                        type: "research_output",
                        title: `Research: ${event.section}`,
                        content: event.content,
                        phase: "researching",
                    });
                    break;

                case "structuring":
                    setCurrentPhase("structuring");
                    addLiveLogEntry({
                        type: "structuring",
                        title: "Structuring Syllabus",
                        content: event.message,
                        phase: "structuring",
                    });
                    break;

                case "stats":
                    // Complete the session with stats
                    if (currentSessionId) {
                        completeProcessingSession(
                            projectId,
                            currentSessionId,
                            undefined,
                            event.stats
                        );
                    }
                    break;

                case "complete":
                    setSyllabus(projectId, event.syllabus);
                    // Update session with research report
                    if (currentSessionId) {
                        completeProcessingSession(
                            projectId,
                            currentSessionId,
                            event.researchReport
                        );
                    }
                    addLiveLogEntry({
                        type: "complete",
                        title: "Processing Complete",
                        content: `Generated ${
                            event.syllabus.modules.length
                        } modules with ${event.syllabus.modules.reduce(
                            (acc, m) => acc + m.learningObjectives.length,
                            0
                        )} learning objectives`,
                        phase: "complete",
                    });
                    setViewMode("mindmap");
                    break;

                case "error":
                    setProcessingError(event.message);
                    updateProjectStatus(projectId, "uploading");
                    addLiveLogEntry({
                        type: "error",
                        title: "Error",
                        content: event.message,
                        phase: "error",
                    });
                    break;
            }
        },
        [
            currentPhase,
            currentSessionId,
            addLiveLogEntry,
            startProcessingSession,
            completeProcessingSession,
            setSyllabus,
            updateProjectStatus,
        ]
    );

    const handleProcessSyllabus = async () => {
        if (!currentProject || currentProject.pdfUrls.length === 0) return;

        // Reset state
        setIsProcessing(true);
        setProcessingError(null);
        setCurrentPhase("");
        setLiveLogEntries([]);
        setCurrentSessionId(null);
        updateProjectStatus(currentProject.id, "processing");

        // Create abort controller for cleanup
        abortControllerRef.current = new AbortController();

        try {
            const response = await fetch("/api/process-syllabus", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pdfUrls: currentProject.pdfUrls,
                    projectTitle: currentProject.title,
                }),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || "Failed to process syllabus");
            }

            // Handle streaming response
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error("No response stream available");
            }

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        try {
                            const event: StreamEvent = JSON.parse(
                                line.slice(6)
                            );
                            handleStreamEvent(event, currentProject.id);
                        } catch (e) {
                            console.error("Failed to parse event:", e);
                        }
                    }
                }
            }

            // Process any remaining buffer
            if (buffer.startsWith("data: ")) {
                try {
                    const event: StreamEvent = JSON.parse(buffer.slice(6));
                    handleStreamEvent(event, currentProject.id);
                } catch (e) {
                    console.error("Failed to parse final event:", e);
                }
            }
        } catch (error) {
            if ((error as Error).name === "AbortError") {
                console.log("Processing cancelled");
                return;
            }
            console.error("Error processing syllabus:", error);
            setProcessingError(
                error instanceof Error ? error.message : "Failed to process"
            );
            updateProjectStatus(currentProject.id, "uploading");
        } finally {
            setIsProcessing(false);
            abortControllerRef.current = null;
        }
    };

    const handleCancelProcessing = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setIsProcessing(false);
            setCurrentPhase("");
            updateProjectStatus(currentProject?.id || "", "uploading");
        }
    };

    const handleUpdateSyllabus = useCallback(
        (updates: Partial<Syllabus>) => {
            if (!currentProjectId) return;
            updateSyllabus(currentProjectId, updates);
        },
        [currentProjectId, updateSyllabus]
    );

    const handleUpdateModule = useCallback(
        (moduleId: string, updates: Partial<Module>) => {
            if (!currentProjectId) return;
            updateModule(currentProjectId, moduleId, updates);
        },
        [currentProjectId, updateModule]
    );

    const handleUpdateLO = useCallback(
        (
            moduleId: string,
            loId: string,
            updates: Partial<LearningObjective>
        ) => {
            if (!currentProjectId) return;
            updateLearningObjective(currentProjectId, moduleId, loId, updates);
        },
        [currentProjectId, updateLearningObjective]
    );

    const handleUpdateQuestion = useCallback(
        (
            moduleId: string,
            loId: string,
            questionId: string,
            updates: Partial<Question>
        ) => {
            if (!currentProjectId) return;
            updateQuestion(
                currentProjectId,
                moduleId,
                loId,
                questionId,
                updates
            );
        },
        [currentProjectId, updateQuestion]
    );

    const selectedModule = currentProject?.syllabus?.modules.find(
        (m) => m.id === selectedModuleId
    );

    // Get processing sessions for current project
    const processingSessions = currentProject?.processingSessions || [];

    // Loading state
    if (!_hasHydrated) {
        return (
            <div className="flex h-screen items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <Image
                        src="/images/icon.png"
                        alt="Hermes"
                        width={48}
                        height={48}
                        className="rounded-xl"
                    />
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Loading...</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen flex-col bg-background">
            {/* Header */}
            <header className="flex h-14 items-center justify-between border-b border-border px-4">
                <div className="flex items-center gap-4">
                    <Link href="/">
                        <Button variant="ghost" size="sm">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back
                        </Button>
                    </Link>
                    <Separator orientation="vertical" className="h-6" />
                    <div className="flex items-center gap-2">
                        <Image
                            src="/images/icon.png"
                            alt="Hermes"
                            width={28}
                            height={28}
                            className="rounded-lg"
                        />
                        <span className="font-semibold">Syllabus Planning</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {currentProject?.syllabus && (
                        <div className="flex items-center border rounded-lg p-1">
                            <Button
                                variant={
                                    viewMode === "mindmap"
                                        ? "secondary"
                                        : "ghost"
                                }
                                size="sm"
                                onClick={() => setViewMode("mindmap")}
                            >
                                <Map className="h-4 w-4 mr-1" />
                                Mind Map
                            </Button>
                            <Button
                                variant={
                                    viewMode === "grid" ? "secondary" : "ghost"
                                }
                                size="sm"
                                onClick={() => setViewMode("grid")}
                            >
                                <Grid3X3 className="h-4 w-4 mr-1" />
                                Modules
                            </Button>
                        </div>
                    )}
                    {/* History button */}
                    {processingSessions.length > 0 && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                setShowHistoryPanel(!showHistoryPanel)
                            }
                        >
                            <History className="h-4 w-4 mr-1" />
                            History
                            <Badge variant="secondary" className="ml-1">
                                {processingSessions.length}
                            </Badge>
                        </Button>
                    )}
                    <ModeToggle />
                </div>
            </header>

            {/* Main content */}
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar - Project List */}
                <div className="w-64 border-r border-border p-4 overflow-auto">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="font-semibold text-sm">Projects</h2>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowNewProject(true)}
                        >
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* New Project Form */}
                    {showNewProject && (
                        <Card className="mb-4">
                            <CardContent className="p-3 space-y-3">
                                <Input
                                    placeholder="Project title"
                                    value={newProjectTitle}
                                    onChange={(e) =>
                                        setNewProjectTitle(e.target.value)
                                    }
                                    autoFocus
                                />
                                <Textarea
                                    placeholder="Description (optional)"
                                    value={newProjectDescription}
                                    onChange={(e) =>
                                        setNewProjectDescription(e.target.value)
                                    }
                                    rows={2}
                                />
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        onClick={handleCreateProject}
                                        disabled={!newProjectTitle.trim()}
                                    >
                                        Create
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setShowNewProject(false)}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Project List */}
                    <div className="space-y-2">
                        {projects.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">
                                No projects yet
                            </p>
                        ) : (
                            projects.map((project) => (
                                <ProjectCard
                                    key={project.id}
                                    project={project}
                                    isSelected={currentProjectId === project.id}
                                    onSelect={() => {
                                        setCurrentProject(project.id);
                                        setViewMode(
                                            project.syllabus
                                                ? "mindmap"
                                                : "upload"
                                        );
                                        setShowHistoryPanel(false);
                                        setSelectedHistorySession(null);
                                    }}
                                    onDelete={() => deleteProject(project.id)}
                                />
                            ))
                        )}
                    </div>
                </div>

                {/* Main Panel */}
                <div className="flex-1 overflow-hidden flex">
                    <div className="flex-1 overflow-hidden">
                        {!currentProject ? (
                            <div className="flex flex-col items-center justify-center h-full text-center p-8">
                                <FileText className="h-16 w-16 text-muted-foreground mb-4" />
                                <h2 className="text-xl font-semibold mb-2">
                                    No Project Selected
                                </h2>
                                <p className="text-muted-foreground mb-4 max-w-md">
                                    Select a project from the sidebar or create
                                    a new one to get started with syllabus
                                    planning.
                                </p>
                                <Button onClick={() => setShowNewProject(true)}>
                                    <Plus className="h-4 w-4 mr-2" />
                                    Create New Project
                                </Button>
                            </div>
                        ) : viewMode === "upload" || isProcessing ? (
                            <div className="h-full overflow-auto">
                                <div className="p-6 max-w-5xl mx-auto space-y-6">
                                    <div>
                                        <h1 className="text-2xl font-bold mb-1">
                                            {currentProject.title}
                                        </h1>
                                        {currentProject.description && (
                                            <p className="text-muted-foreground">
                                                {currentProject.description}
                                            </p>
                                        )}
                                    </div>

                                    {/* Processing View */}
                                    {isProcessing ? (
                                        <Card className="flex-1">
                                            {/* Header with status and cancel */}
                                            <CardHeader className="pb-3">
                                                <div className="flex items-center justify-between">
                                                    <CardTitle className="text-lg flex items-center gap-2">
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Deep Research in
                                                        Progress
                                                    </CardTitle>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={
                                                            handleCancelProcessing
                                                        }
                                                    >
                                                        Cancel
                                                    </Button>
                                                </div>
                                                {processingError && (
                                                    <div className="flex items-center gap-2 text-sm text-destructive p-3 bg-destructive/10 rounded-lg mt-2">
                                                        <AlertCircle className="h-4 w-4 shrink-0" />
                                                        {processingError}
                                                    </div>
                                                )}
                                            </CardHeader>
                                            <CardContent className="pt-0">
                                                {/* Full-width live logs */}
                                                <ProcessingLogs
                                                    isLive
                                                    embedded
                                                    liveEntries={liveLogEntries}
                                                    currentPhase={currentPhase}
                                                />
                                            </CardContent>
                                        </Card>
                                    ) : (
                                        <>
                                            <Card>
                                                <CardHeader>
                                                    <CardTitle className="text-lg">
                                                        Upload Documents
                                                    </CardTitle>
                                                </CardHeader>
                                                <CardContent>
                                                    <PdfUpload
                                                        onFilesUploaded={
                                                            handleFilesUploaded
                                                        }
                                                        uploadedFiles={currentProject.pdfUrls.map(
                                                            (url, i) => ({
                                                                url,
                                                                name:
                                                                    currentProject
                                                                        .pdfNames[
                                                                        i
                                                                    ] ||
                                                                    `Document ${
                                                                        i + 1
                                                                    }`,
                                                            })
                                                        )}
                                                        onRemoveFile={
                                                            handleRemoveFile
                                                        }
                                                        disabled={isProcessing}
                                                    />
                                                </CardContent>
                                            </Card>

                                            {/* Process Button */}
                                            {currentProject.pdfUrls.length >
                                                0 && (
                                                <Card>
                                                    <CardContent className="p-6">
                                                        {processingError && (
                                                            <div className="flex items-center gap-2 text-sm text-destructive mb-4">
                                                                <AlertCircle className="h-4 w-4" />
                                                                {
                                                                    processingError
                                                                }
                                                            </div>
                                                        )}
                                                        <Button
                                                            className="w-full"
                                                            size="lg"
                                                            onClick={
                                                                handleProcessSyllabus
                                                            }
                                                            disabled={
                                                                isProcessing
                                                            }
                                                        >
                                                            <Sparkles className="h-4 w-4 mr-2" />
                                                            Generate Syllabus
                                                            with Deep Research
                                                        </Button>
                                                        <p className="text-xs text-muted-foreground text-center mt-2">
                                                            The Gemini Deep
                                                            Research Agent will
                                                            thoroughly analyze
                                                            your documents and
                                                            create a
                                                            comprehensive
                                                            syllabus
                                                        </p>
                                                    </CardContent>
                                                </Card>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        ) : viewMode === "mindmap" &&
                          currentProject.syllabus ? (
                            <SyllabusMindMap
                                syllabus={currentProject.syllabus}
                                onUpdateSyllabus={handleUpdateSyllabus}
                                onUpdateModule={handleUpdateModule}
                                onUpdateLO={handleUpdateLO}
                                onUpdateQuestion={handleUpdateQuestion}
                            />
                        ) : viewMode === "grid" && currentProject.syllabus ? (
                            <div className="flex h-full">
                                <div
                                    className={`flex-1 p-6 overflow-auto ${
                                        selectedModule ? "border-r" : ""
                                    }`}
                                >
                                    <div className="mb-6">
                                        <h1 className="text-2xl font-bold mb-1">
                                            {currentProject.syllabus.title}
                                        </h1>
                                        <p className="text-muted-foreground">
                                            {
                                                currentProject.syllabus
                                                    .description
                                            }
                                        </p>
                                    </div>
                                    <ModuleGrid
                                        modules={
                                            currentProject.syllabus.modules
                                        }
                                        onModuleClick={setSelectedModule}
                                        selectedModuleId={selectedModuleId}
                                    />
                                </div>
                                {selectedModule && (
                                    <div className="w-96">
                                        <ModuleDetailsPanel
                                            module={selectedModule}
                                            onClose={() =>
                                                setSelectedModule(null)
                                            }
                                        />
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </div>

                    {/* History Panel (slides in from right) */}
                    {showHistoryPanel && (
                        <div className="w-96 border-l border-border overflow-auto">
                            <div className="p-4">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-semibold">
                                        Processing History
                                    </h3>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                            setShowHistoryPanel(false);
                                            setSelectedHistorySession(null);
                                        }}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>

                                {selectedHistorySession ? (
                                    <div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="mb-4"
                                            onClick={() =>
                                                setSelectedHistorySession(null)
                                            }
                                        >
                                            <ArrowLeft className="h-4 w-4 mr-1" />
                                            Back to list
                                        </Button>
                                        <ProcessingLogs
                                            session={selectedHistorySession}
                                        />
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {processingSessions.map((session) => (
                                            <Card
                                                key={session.id}
                                                className="cursor-pointer hover:bg-muted/50 transition-colors"
                                                onClick={() =>
                                                    setSelectedHistorySession(
                                                        session
                                                    )
                                                }
                                            >
                                                <CardContent className="p-3">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <Badge
                                                            variant={
                                                                session.completedAt
                                                                    ? "default"
                                                                    : "secondary"
                                                            }
                                                        >
                                                            {session.completedAt
                                                                ? "Completed"
                                                                : "In Progress"}
                                                        </Badge>
                                                        <span className="text-xs text-muted-foreground">
                                                            {new Date(
                                                                session.startedAt
                                                            ).toLocaleDateString()}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-muted-foreground">
                                                        {session.logs.length}{" "}
                                                        log entries
                                                    </p>
                                                    {session.stats && (
                                                        <div className="flex gap-2 mt-2">
                                                            <Badge
                                                                variant="outline"
                                                                className="text-xs"
                                                            >
                                                                {
                                                                    session
                                                                        .stats
                                                                        .documentsAnalyzed
                                                                }{" "}
                                                                docs
                                                            </Badge>
                                                            <Badge
                                                                variant="outline"
                                                                className="text-xs"
                                                            >
                                                                {Math.round(
                                                                    session
                                                                        .stats
                                                                        .processingTimeMs /
                                                                        1000
                                                                )}
                                                                s
                                                            </Badge>
                                                        </div>
                                                    )}
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ============================================
// PROJECT CARD COMPONENT
// ============================================

type ProjectCardProps = {
    project: PlanningProject;
    isSelected: boolean;
    onSelect: () => void;
    onDelete: () => void;
};

function ProjectCard({
    project,
    isSelected,
    onSelect,
    onDelete,
}: ProjectCardProps) {
    return (
        <div
            className={`
                p-3 rounded-lg cursor-pointer transition-colors group
                ${
                    isSelected
                        ? "bg-primary/10 border border-primary/20"
                        : "hover:bg-muted/50"
                }
            `}
            onClick={onSelect}
        >
            <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                        {project.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                        <Badge
                            variant={
                                project.status === "editing" ||
                                project.status === "ready"
                                    ? "default"
                                    : "secondary"
                            }
                            className="text-xs"
                        >
                            {project.status === "editing" ||
                            project.status === "ready" ? (
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                            ) : null}
                            {project.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                            {project.pdfUrls.length} PDF
                            {project.pdfUrls.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                    {/* Show session count */}
                    {project.processingSessions &&
                        project.processingSessions.length > 0 && (
                            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                <History className="h-3 w-3" />
                                {project.processingSessions.length} session
                                {project.processingSessions.length !== 1
                                    ? "s"
                                    : ""}
                            </div>
                        )}
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (
                            confirm(
                                "Are you sure you want to delete this project?"
                            )
                        ) {
                            onDelete();
                        }
                    }}
                >
                    <Trash2 className="h-3 w-3" />
                </Button>
            </div>
        </div>
    );
}
