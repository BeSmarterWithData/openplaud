import { and, eq, notInArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { aiEnhancements, recordings, transcriptions } from "@/db/schema";
import { enhanceRecording } from "@/lib/ai/enhance";
import { auth } from "@/lib/auth";
import { transcribeRecording } from "@/lib/transcription/transcribe";

// In-memory job store (persists across requests in the same server process)
interface BatchJob {
    userId: string;
    status: "running" | "done" | "error";
    total: number;
    completed: number;
    failed: number;
    current: string;
    step: string;
    errors: string[];
    startedAt: number;
}

const activeJobs = new Map<string, BatchJob>();

async function runBatchJob(userId: string) {
    const job: BatchJob = {
        userId,
        status: "running",
        total: 0,
        completed: 0,
        failed: 0,
        current: "",
        step: "",
        errors: [],
        startedAt: Date.now(),
    };
    activeJobs.set(userId, job);

    try {
        const allRecordings = await db
            .select({ id: recordings.id, filename: recordings.filename })
            .from(recordings)
            .where(eq(recordings.userId, userId));

        const existingTranscriptions = await db
            .select({ recordingId: transcriptions.recordingId })
            .from(transcriptions)
            .where(eq(transcriptions.userId, userId));

        const transcribedIds = new Set(
            existingTranscriptions.map((t) => t.recordingId),
        );

        const existingEnhancements = await db
            .select({ recordingId: aiEnhancements.recordingId })
            .from(aiEnhancements)
            .where(eq(aiEnhancements.userId, userId));

        const enhancedIds = new Set(
            existingEnhancements.map((e) => e.recordingId),
        );

        const needsTranscription = allRecordings.filter(
            (r) => !transcribedIds.has(r.id),
        );
        const needsEnhancementOnly = allRecordings.filter(
            (r) => transcribedIds.has(r.id) && !enhancedIds.has(r.id),
        );

        job.total = needsTranscription.length + needsEnhancementOnly.length;

        if (job.total === 0) {
            job.status = "done";
            return;
        }

        // Transcribe recordings (also auto-enhances)
        for (const rec of needsTranscription) {
            job.current = rec.filename;
            job.step = "transcribing";

            try {
                await transcribeRecording(userId, rec.id);
                // Auto-enhance after transcription
                try {
                    await enhanceRecording(userId, rec.id);
                } catch (e) {
                    console.warn(`Enhancement failed for ${rec.filename}:`, e);
                }
                job.completed++;
            } catch (e) {
                job.failed++;
                job.errors.push(
                    `${rec.filename}: ${e instanceof Error ? e.message : "Unknown error"}`,
                );
                console.error(
                    `Batch transcribe failed for ${rec.filename}:`,
                    e,
                );
            }
        }

        // Enhance recordings that only need summarization
        for (const rec of needsEnhancementOnly) {
            job.current = rec.filename;
            job.step = "summarizing";

            try {
                await enhanceRecording(userId, rec.id);
                job.completed++;
            } catch (e) {
                job.failed++;
                job.errors.push(
                    `${rec.filename}: ${e instanceof Error ? e.message : "Enhancement failed"}`,
                );
                console.error(`Batch enhance failed for ${rec.filename}:`, e);
            }
        }

        job.status = "done";
        job.current = "";
        job.step = "";
    } catch (e) {
        job.status = "error";
        job.errors.push(
            e instanceof Error ? e.message : "Batch processing failed",
        );
        console.error("Batch job error:", e);
    }
}

export async function GET(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        // Check for active job first
        const job = activeJobs.get(session.user.id);
        if (job && job.status === "running") {
            return NextResponse.json({
                active: true,
                status: job.status,
                total: job.total,
                completed: job.completed,
                failed: job.failed,
                current: job.current,
                step: job.step,
            });
        }

        // Return finished job if recent (within 30s) so the client can see the final state
        if (job && job.status !== "running") {
            const age = Date.now() - job.startedAt;
            const response = {
                active: false,
                status: job.status,
                total: job.total,
                completed: job.completed,
                failed: job.failed,
                errors: job.errors,
            };
            // Clean up old jobs after client has seen the result
            if (age > 30000) {
                activeJobs.delete(session.user.id);
            }
            return NextResponse.json(response);
        }

        // No active job — return remaining counts
        const existingTranscriptions = await db
            .select({ recordingId: transcriptions.recordingId })
            .from(transcriptions)
            .where(eq(transcriptions.userId, session.user.id));

        const transcribedIds = existingTranscriptions.map((t) => t.recordingId);

        const untranscribed = await db
            .select({ id: recordings.id })
            .from(recordings)
            .where(
                and(
                    eq(recordings.userId, session.user.id),
                    transcribedIds.length > 0
                        ? notInArray(recordings.id, transcribedIds)
                        : undefined,
                ),
            );

        const existingEnhancements = await db
            .select({ recordingId: aiEnhancements.recordingId })
            .from(aiEnhancements)
            .where(eq(aiEnhancements.userId, session.user.id));

        const enhancedIds = existingEnhancements.map((e) => e.recordingId);
        const unenhanced = transcribedIds.filter(
            (id) => !enhancedIds.includes(id),
        );

        return NextResponse.json({
            active: false,
            totalRemaining: untranscribed.length + unenhanced.length,
        });
    } catch (error) {
        console.error("Error checking status:", error);
        return NextResponse.json(
            { error: "Failed to check status" },
            { status: 500 },
        );
    }
}

export async function POST(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        // Don't start if already running
        const existingJob = activeJobs.get(session.user.id);
        if (existingJob?.status === "running") {
            return NextResponse.json({
                message: "Batch processing already in progress",
                active: true,
            });
        }

        // Fire and forget — calls lib functions directly, no HTTP needed
        runBatchJob(session.user.id);

        return NextResponse.json({
            message: "Batch processing started",
            active: true,
        });
    } catch (error) {
        console.error("Error starting batch:", error);
        return NextResponse.json(
            { error: "Failed to start batch processing" },
            { status: 500 },
        );
    }
}
