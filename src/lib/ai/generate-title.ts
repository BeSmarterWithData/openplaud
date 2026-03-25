import { and, eq } from "drizzle-orm";
import { OpenAI } from "openai";
import { db } from "@/db";
import { apiCredentials, userSettings } from "@/db/schema";
import { decrypt } from "@/lib/encryption";
import {
    getDefaultPromptConfig,
    getPromptById,
    type PromptConfiguration,
} from "./prompt-presets";

export async function generateTitleFromTranscription(
    userId: string,
    transcriptionText: string,
): Promise<string | null> {
    try {
        // Get user's prompt configuration
        const [userSettingsRow] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1);

        // Get prompt config
        let promptConfig: PromptConfiguration = getDefaultPromptConfig();
        if (userSettingsRow?.titleGenerationPrompt) {
            const config =
                userSettingsRow.titleGenerationPrompt as PromptConfiguration;
            promptConfig = {
                selectedPrompt: config.selectedPrompt || "default",
                customPrompts: config.customPrompts || [],
            };
        }

        // Get the prompt by ID (preset or custom)
        let promptTemplate = getPromptById(
            promptConfig.selectedPrompt,
            promptConfig,
        );

        if (!promptTemplate) {
            console.warn(
                `Prompt not found: ${promptConfig.selectedPrompt}, using default`,
            );
            const defaultConfig = getDefaultPromptConfig();
            promptTemplate = getPromptById(
                defaultConfig.selectedPrompt,
                defaultConfig,
            );
            if (!promptTemplate) {
                return null;
            }
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

        // Prefer enhancement provider, fallback to transcription provider
        const credentials = enhancementCredentials || transcriptionCredentials;

        if (!credentials) {
            console.warn("No AI provider found for title generation");
            return null;
        }

        // Decrypt API key
        const apiKey = decrypt(credentials.apiKey);

        // Create OpenAI client
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        // Use a lightweight model for title generation
        // Prefer chat models (gpt-4o-mini, gpt-3.5-turbo) over Whisper models
        // Fallback to default model if no specific model is set
        let model = credentials.defaultModel || "gpt-4o-mini";

        // If the model is a Whisper model (for transcription), use a chat model instead
        if (model.includes("whisper") || model.includes("whisper-")) {
            model = "gpt-4o-mini";
        }

        // Send full transcription — let the model's context window be the limit
        const systemContent = promptTemplate.replace(
            "{transcription}",
            transcriptionText,
        );

        const response = await openai.chat.completions.create({
            model,
            messages: [
                {
                    role: "system",
                    content: systemContent,
                },
                {
                    role: "user",
                    content:
                        "Generate a concise, descriptive title for this recording. Maximum 60 characters, title case, no colons or quotes. Return ONLY the title text, nothing else.",
                },
            ],
            temperature: 0.7,
            max_completion_tokens: 50,
        });

        const title = response.choices[0]?.message?.content?.trim() || null;

        if (!title) {
            return null;
        }

        // Clean up the title (remove quotes, colons, etc. if AI didn't follow rules)
        let cleanedTitle = title
            .replace(/^["']|["']$/g, "") // Remove surrounding quotes
            .replace(/[:;]/g, "") // Remove colons and semicolons
            .trim();

        // Enforce 60 character limit
        if (cleanedTitle.length > 60) {
            cleanedTitle = `${cleanedTitle.substring(0, 57)}...`;
        }

        return cleanedTitle || null;
    } catch (error) {
        console.error("Error generating title:", error);
        return null;
    }
}
