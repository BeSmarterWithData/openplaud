import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { enhanceRecording } from "@/lib/ai/enhance";
import { auth } from "@/lib/auth";

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

        // Verify recording belongs to user
        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!recording) {
            return NextResponse.json(
                { error: "Recording not found" },
                { status: 404 },
            );
        }

        const result = await enhanceRecording(session.user.id, id);

        return NextResponse.json({
            summary: result.summary,
            actionItems: result.actionItems,
            keyPoints: result.keyPoints,
            provider: result.provider,
            model: result.model,
        });
    } catch (error) {
        console.error("Error enhancing recording:", error);
        const message =
            error instanceof Error
                ? error.message
                : "Failed to enhance recording";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
