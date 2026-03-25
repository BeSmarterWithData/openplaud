import { and, eq } from "drizzle-orm";
import { OpenAI } from "openai";
import { db } from "@/db";
import { aiEnhancements, apiCredentials, transcriptions } from "@/db/schema";
import { decrypt } from "@/lib/encryption";

export interface EnhancementResult {
    summary: string;
    actionItems: string[];
    keyPoints: string[];
    provider: string;
    model: string;
}

const ENHANCEMENT_SYSTEM_PROMPT = `You are an expert assistant that analyzes audio recording transcriptions. You produce structured analysis with three sections: a summary, action items, and key points.

You MUST respond with valid JSON only. No markdown, no code fences, no extra text.

Response format:
{
  "summary": "A clear, concise paragraph summarizing the main topics and conclusions of the recording.",
  "actionItems": ["Action item 1", "Action item 2"],
  "keyPoints": ["Key point 1", "Key point 2"]
}

Rules:
- The summary should be 2-4 sentences capturing the essence of the conversation.
- Action items are specific tasks, follow-ups, or commitments mentioned. If none exist, return an empty array.
- Key points are the most important facts, decisions, or insights discussed. Extract 3-7 key points.
- Be specific and actionable—avoid vague summaries.
- Preserve important names, dates, numbers, and deadlines mentioned.
- Return ONLY the JSON object, nothing else.`;

function buildUserPrompt(transcriptionText: string): string {
    // Truncate long transcriptions to stay within token limits
    const maxLength = 8000;
    const truncated =
        transcriptionText.length > maxLength
            ? `${transcriptionText.substring(0, maxLength)}...\n\n[Transcription truncated for length]`
            : transcriptionText;

    return `Analyze the following transcription and provide a structured summary, action items, and key points.\n\nTranscription:\n${truncated}`;
}

export async function enhanceRecording(
    userId: string,
    recordingId: string,
): Promise<EnhancementResult> {
    // Get the transcription for this recording
    const [transcription] = await db
        .select()
        .from(transcriptions)
        .where(eq(transcriptions.recordingId, recordingId))
        .limit(1);

    if (!transcription?.text) {
        throw new Error(
            "No transcription available. Please transcribe the recording first.",
        );
    }

    // Get user's AI credentials (prefer enhancement provider, fallback to transcription)
    const [enhancementCredentials] = await db
        .select()
        .from(apiCredentials)
        .where(
            and(
                eq(apiCredentials.userId, userId),
                eq(apiCredentials.isDefaultEnhancement, true),
            ),
        )
        .limit(1);

    const [transcriptionCredentials] = await db
        .select()
        .from(apiCredentials)
        .where(
            and(
                eq(apiCredentials.userId, userId),
                eq(apiCredentials.isDefaultTranscription, true),
            ),
        )
        .limit(1);

    const credentials = enhancementCredentials || transcriptionCredentials;

    if (!credentials) {
        throw new Error(
            "No AI provider configured. Please add an API provider in settings.",
        );
    }

    const apiKey = decrypt(credentials.apiKey);

    const openai = new OpenAI({
        apiKey,
        baseURL: credentials.baseUrl || undefined,
    });

    // Select a chat model (not a whisper/transcription model)
    let model = credentials.defaultModel || "gpt-4o-mini";
    if (model.includes("whisper")) {
        model = "gpt-4o-mini";
    }

    const response = await openai.chat.completions.create({
        model,
        messages: [
            { role: "system", content: ENHANCEMENT_SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(transcription.text) },
        ],
        temperature: 0.3,
        max_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
        throw new Error("AI returned an empty response");
    }

    // Parse the JSON response (strip markdown fences if present)
    let parsed: {
        summary?: string;
        actionItems?: string[];
        keyPoints?: string[];
    };
    try {
        const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
        parsed = JSON.parse(cleaned);
    } catch {
        throw new Error("Failed to parse AI response as structured data");
    }

    const result: EnhancementResult = {
        summary: parsed.summary || "No summary generated.",
        actionItems: Array.isArray(parsed.actionItems)
            ? parsed.actionItems
            : [],
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        provider: credentials.provider,
        model,
    };

    // Save to database (upsert)
    const [existing] = await db
        .select()
        .from(aiEnhancements)
        .where(eq(aiEnhancements.recordingId, recordingId))
        .limit(1);

    if (existing) {
        await db
            .update(aiEnhancements)
            .set({
                summary: result.summary,
                actionItems: result.actionItems,
                keyPoints: result.keyPoints,
                provider: result.provider,
                model: result.model,
            })
            .where(eq(aiEnhancements.id, existing.id));
    } else {
        await db.insert(aiEnhancements).values({
            recordingId,
            userId,
            summary: result.summary,
            actionItems: result.actionItems,
            keyPoints: result.keyPoints,
            provider: result.provider,
            model: result.model,
        });
    }

    return result;
}
