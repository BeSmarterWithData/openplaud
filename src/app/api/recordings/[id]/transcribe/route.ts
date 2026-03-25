import { NextResponse } from "next/server";
import { enhanceRecording } from "@/lib/ai/enhance";
import { auth } from "@/lib/auth";
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
