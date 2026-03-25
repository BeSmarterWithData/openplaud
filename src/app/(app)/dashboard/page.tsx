import { desc, eq } from "drizzle-orm";
import { Workstation } from "@/components/dashboard/workstation";
import { db } from "@/db";
import { aiEnhancements, recordings, transcriptions } from "@/db/schema";
import { requireAuth } from "@/lib/auth-server";
import { serializeRecording } from "@/types/recording";

export default async function DashboardPage() {
    const session = await requireAuth();

    const userRecordings = await db
        .select({
            id: recordings.id,
            filename: recordings.filename,
            duration: recordings.duration,
            startTime: recordings.startTime,
            filesize: recordings.filesize,
            deviceSn: recordings.deviceSn,
        })
        .from(recordings)
        .where(eq(recordings.userId, session.user.id))
        .orderBy(desc(recordings.startTime));

    const userTranscriptions = await db
        .select({
            recordingId: transcriptions.recordingId,
            text: transcriptions.text,
            language: transcriptions.detectedLanguage,
        })
        .from(transcriptions)
        .where(eq(transcriptions.userId, session.user.id));

    const userEnhancements = await db
        .select({
            recordingId: aiEnhancements.recordingId,
            summary: aiEnhancements.summary,
            actionItems: aiEnhancements.actionItems,
            keyPoints: aiEnhancements.keyPoints,
            provider: aiEnhancements.provider,
            model: aiEnhancements.model,
        })
        .from(aiEnhancements)
        .where(eq(aiEnhancements.userId, session.user.id));

    const recordingsData = userRecordings.map(serializeRecording);

    const transcriptionMap = new Map(
        userTranscriptions.map((t) => [
            t.recordingId,
            { text: t.text, language: t.language || undefined },
        ]),
    );

    const enhancementMap = new Map(
        userEnhancements.map((e) => [
            e.recordingId,
            {
                summary: e.summary || undefined,
                actionItems: (e.actionItems as string[]) || undefined,
                keyPoints: (e.keyPoints as string[]) || undefined,
                provider: e.provider,
                model: e.model,
            },
        ]),
    );

    return (
        <Workstation
            recordings={recordingsData}
            transcriptions={transcriptionMap}
            enhancements={enhancementMap}
        />
    );
}
