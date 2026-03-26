import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, userSettings } from "@/db/schema";
import { enhanceRecording } from "@/lib/ai/enhance";
import { auth } from "@/lib/auth";
import { sendEnhancementEmail } from "@/lib/notifications/email";
import { transcribeRecording } from "@/lib/transcription/transcribe";

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
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

        const { id } = await params;

        const result = await transcribeRecording(session.user.id, id);

        // Auto-generate summary, action items, and key points
        let enhancement = null;
        try {
            enhancement = await enhanceRecording(session.user.id, id);
        } catch (enhanceError) {
            console.warn(
                "Auto-enhancement failed (non-blocking):",
                enhanceError,
            );
        }

        // Auto-email if enabled and enhancement succeeded
        if (enhancement) {
            try {
                const [settings] = await db
                    .select()
                    .from(userSettings)
                    .where(eq(userSettings.userId, session.user.id))
                    .limit(1);

                if (
                    settings?.emailNotifications &&
                    settings?.notificationEmail
                ) {
                    const [recording] = await db
                        .select({ filename: recordings.filename })
                        .from(recordings)
                        .where(eq(recordings.id, id))
                        .limit(1);

                    await sendEnhancementEmail(
                        settings.notificationEmail,
                        recording?.filename || "Recording",
                        enhancement.summary,
                        enhancement.actionItems,
                        enhancement.keyPoints,
                    );
                }
            } catch (emailError) {
                console.warn("Auto-email failed (non-blocking):", emailError);
            }
        }

        return NextResponse.json({
            transcription: result.text,
            detectedLanguage: result.detectedLanguage,
            enhancement,
        });
    } catch (error) {
        console.error("Error transcribing:", error);
        const message =
            error instanceof Error
                ? error.message
                : "Failed to transcribe recording";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
