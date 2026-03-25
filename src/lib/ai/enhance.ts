import { and, eq } from "drizzle-orm";
import { OpenAI } from "openai";
import { db } from "@/db";
import {
    aiEnhancements,
    apiCredentials,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { decrypt } from "@/lib/encryption";
import {
    getDefaultPromptConfig,
    getEnhancementContext,
    type PromptConfiguration,
} from "./prompt-presets";

export interface EnhancementResult {
    summary: string;
    actionItems: string[];
    keyPoints: string[];
    provider: string;
    model: string;
}

function buildSystemPrompt(
    promptText: string,
    transcriptionText: string,
): string {
    // Send the full transcription — let the model's context window be the limit
    const contextWithTranscription = promptText.replace(
        "{transcription}",
        transcriptionText,
    );

    return `${contextWithTranscription}

Based on the above context and transcription, produce a comprehensive, detailed analysis. You MUST respond with valid JSON only. No markdown, no code fences, no extra text.

Response format:
{
  "summary": "A thorough paragraph...",
  "actionItems": ["Detailed action item 1", "Detailed action item 2"],
  "keyPoints": ["Detailed key point with explanation 1", "Detailed key point with explanation 2"]
}

SUMMARY RULES:
- Write a comprehensive paragraph (5-10 sentences) that captures the full scope of the recording.
- Include the main purpose/objective, all major topics covered, key decisions or conclusions, and the overall arc.
- Mention specific names, technical terms, frameworks, and methodologies discussed.
- A reader should understand everything important that happened without reading the full transcription.

ACTION ITEMS RULES:
- Extract EVERY task, assignment, follow-up, commitment, or recommended next step mentioned.
- Include implicit actions (e.g., "we should look into X" → "Investigate X").
- Include who is responsible when mentioned (format: "[Owner] - Task description").
- Include deadlines, timeframes, or priority when mentioned.
- Include recommendations and suggestions made by speakers, even if not formally assigned.
- If the recording is educational, extract study tasks, review assignments, and things to practice.
- If no action items exist, return an empty array.

KEY POINTS RULES:
- Extract ALL substantive knowledge points, not just surface-level observations.
- Each key point should be a detailed sentence or two explaining the concept, decision, or insight—not just a topic label.
- Group related details into single key points rather than splitting them into shallow bullets.
- Include technical details: specific functions, tools, frameworks, methodologies, metrics, and examples discussed.
- Include context and rationale—WHY something is important, not just WHAT was said.
- Include specific examples, case studies, or scenarios that were walked through.
- Include any problems discussed and their solutions.
- Aim for 10-25 detailed key points depending on the recording length and density.
- Preserve exact names, numbers, technical terms, and references.

Return ONLY the JSON object, nothing else.`;
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

    // Get user's prompt configuration (shared with title generation)
    const [userSettingsRow] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);

    let promptConfig: PromptConfiguration = getDefaultPromptConfig();
    if (userSettingsRow?.titleGenerationPrompt) {
        const config =
            userSettingsRow.titleGenerationPrompt as PromptConfiguration;
        promptConfig = {
            selectedPrompt: config.selectedPrompt || "default",
            customPrompts: config.customPrompts || [],
        };
    }

    const promptText = getEnhancementContext(promptConfig);
    const systemPrompt = buildSystemPrompt(promptText, transcription.text);

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
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content:
                    "Analyze the transcription above and return the JSON with summary, actionItems, and keyPoints.",
            },
        ],
        temperature: 0.3,
        max_completion_tokens: 4096,
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
