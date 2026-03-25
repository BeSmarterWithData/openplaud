/**
 * Recording analysis prompt presets for different use cases.
 * Each preset drives title generation, summaries, action items, and key points.
 */

import type {
    CustomPrompt,
    PromptConfiguration,
    PromptPreset,
} from "@/types/ai";

export type { CustomPrompt, PromptConfiguration, PromptPreset };

export interface PromptConfig {
    id: PromptPreset;
    name: string;
    description: string;
    /** Universal prompt that drives all AI outputs: titles, summaries, action items, key points */
    prompt: string;
}

export const PROMPT_PRESETS: Record<PromptPreset, PromptConfig> = {
    default: {
        id: "default",
        name: "Default",
        description: "General purpose analysis for any recording type",
        prompt: `You are an AI assistant that analyzes audio recording transcriptions. The recording could be any type—meeting, lecture, call, brainstorm, or personal note. Adapt your analysis to fit the content.

When analyzing, focus on:
- Main topics discussed and conclusions reached
- Decisions made and their rationale
- Tasks, follow-ups, or commitments mentioned
- The most important facts, insights, or takeaways
- Preserve specific names, dates, numbers, and references

When generating titles:
- Maximum 60 characters, title case, no colons or quotes
- Be specific and descriptive—avoid generic phrases like "Recording about" or "Discussion of"

Transcription:
{transcription}`,
    },
    meetings: {
        id: "meetings",
        name: "Meetings",
        description:
            "Optimized for business meetings, standups, and team discussions",
        prompt: `You are an AI assistant that analyzes business meeting recordings. These recordings include standups, planning sessions, design reviews, retrospectives, 1:1s, and cross-team syncs.

When analyzing, focus on:
- Decisions made and their rationale
- Action items with owners and deadlines when mentioned (format as "[Owner] - Task (deadline)")
- Blockers, risks, and dependencies raised
- Follow-ups and next steps agreed upon
- Project names, sprint references, ticket numbers, and tool names
- Any consensus or disagreements noted
- Status updates and progress reports shared

When generating titles:
- Maximum 60 characters, title case, no colons or quotes
- Include meeting type if relevant (Standup, Review, Planning, Retro, 1:1)
- Focus on the main agenda item, decision, or outcome

Transcription:
{transcription}`,
    },
    lectures: {
        id: "lectures",
        name: "Lectures",
        description:
            "Designed for educational content, courses, and presentations",
        prompt: `You are an AI assistant that analyzes lecture and educational recordings. These include university lectures, training sessions, workshops, presentations, and conference talks.

When analyzing, focus on:
- Core concepts and theories explained
- Key definitions and terminology introduced
- Examples, case studies, and analogies used
- Assignments, readings, or follow-up material mentioned
- Logical progression and structure of the lesson
- Questions raised by the audience and answers provided
- References to textbooks, papers, or external resources

When generating titles:
- Maximum 60 characters, title case, no colons or quotes
- Include the course or subject area if mentioned
- Focus on the main concept or lesson topic

Transcription:
{transcription}`,
    },
    "phone-calls": {
        id: "phone-calls",
        name: "Phone Calls",
        description: "Tailored for phone conversations and interviews",
        prompt: `You are an AI assistant that analyzes phone call and interview recordings. These include client calls, job interviews, support calls, sales conversations, and vendor discussions.

When analyzing, focus on:
- The purpose and outcome of the call
- Commitments and agreements made by each party
- Questions raised and answers provided
- Next steps and follow-up actions with deadlines
- Key contact information or references shared
- Scheduling, timelines, or deadlines discussed
- Any issues, concerns, or escalations raised

When generating titles:
- Maximum 60 characters, title case, no colons or quotes
- Include call type if relevant (Interview, Support, Sales, Follow-up)
- Focus on the purpose or outcome of the conversation

Transcription:
{transcription}`,
    },
    "audio-blog": {
        id: "audio-blog",
        name: "Casual Audio Blog",
        description: "Perfect for personal notes, vlogs, and casual recordings",
        prompt: `You are an AI assistant that analyzes casual and personal audio recordings. These include voice memos, audio journals, personal reflections, vlogs, and stream-of-consciousness notes.

When analyzing, focus on:
- Main ideas and reflections shared
- Personal goals, intentions, or resolutions mentioned
- Interesting observations or insights
- Plans, ideas, or things to revisit later
- Mood, themes, and emotional undertones
- References to people, places, books, or events
- Any self-assigned tasks or reminders

When generating titles:
- Maximum 60 characters, title case, no colons or quotes
- Capture the essence or main theme
- Be descriptive but conversational in tone

Transcription:
{transcription}`,
    },
    "idea-stormer": {
        id: "idea-stormer",
        name: "Idea Stormer",
        description:
            "Optimized for brainstorming sessions and creative thinking",
        prompt: `You are an AI assistant that analyzes brainstorming and ideation recordings. These include creative sessions, problem-solving discussions, product ideation, whiteboard sessions, and design thinking workshops.

When analyzing, focus on:
- Problems or challenges being explored
- Ideas generated and their potential impact
- Pros, cons, and trade-offs discussed for each idea
- Ideas that gained consensus or enthusiasm
- Rejected ideas and reasons why
- Next steps to validate, prototype, or research further
- Resources, references, or inspirations mentioned

When generating titles:
- Maximum 60 characters, title case, no colons or quotes
- Focus on the problem or creative direction being explored
- Include domain if relevant (Product, Marketing, Design, Feature)

Transcription:
{transcription}`,
    },
};

/**
 * Get the prompt for a given preset
 */
export function getPromptForPreset(preset: PromptPreset): string {
    return PROMPT_PRESETS[preset].prompt;
}

/**
 * Get default prompt config (default preset)
 */
export function getDefaultPromptConfig(): PromptConfiguration {
    return {
        selectedPrompt: "default",
        customPrompts: [],
    };
}

/**
 * Get all available prompts (presets + custom)
 */
export function getAllPrompts(config: PromptConfiguration): Array<{
    id: string;
    name: string;
    description: string;
    prompt: string;
    isPreset: boolean;
}> {
    const presets = Object.values(PROMPT_PRESETS).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        prompt: p.prompt,
        isPreset: true,
    }));

    const customs = config.customPrompts.map((p) => ({
        id: p.id,
        name: p.name,
        description: "Custom prompt",
        prompt: p.prompt,
        isPreset: false,
    }));

    return [...presets, ...customs];
}

/**
 * Get prompt by ID (preset or custom)
 */
export function getPromptById(
    id: string,
    config: PromptConfiguration,
): string | null {
    if (id in PROMPT_PRESETS) {
        return PROMPT_PRESETS[id as PromptPreset].prompt;
    }

    const custom = config.customPrompts.find((p) => p.id === id);
    return custom?.prompt || null;
}

/**
 * Get the enhancement context for a given prompt config.
 * For built-in presets, returns the preset's prompt (which contains the analysis focus areas).
 * For custom prompts, returns the custom prompt text as context.
 */
export function getEnhancementContext(config: PromptConfiguration): string {
    const id = config.selectedPrompt;

    if (id in PROMPT_PRESETS) {
        return PROMPT_PRESETS[id as PromptPreset].prompt;
    }

    const custom = config.customPrompts.find((p) => p.id === id);
    if (custom?.prompt) {
        return custom.prompt;
    }

    return PROMPT_PRESETS.default.prompt;
}
