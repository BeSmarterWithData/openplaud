import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { OpenAI } from "openai";
import { db } from "@/db";
import { apiCredentials, recordings, transcriptions } from "@/db/schema";
import { decrypt } from "@/lib/encryption";
import { createUserStorageProvider } from "@/lib/storage/factory";

const MAX_UPLOAD_SIZE = 24 * 1024 * 1024; // 24MB

function compressAudio(audioBuffer: ArrayBuffer | Buffer): Buffer {
    const tempDir = mkdtempSync(join(tmpdir(), "openplaud-"));
    const inputPath = join(tempDir, "input.ogg");
    const outputPath = join(tempDir, "output.mp3");

    try {
        writeFileSync(inputPath, new Uint8Array(audioBuffer));
        execSync(
            `ffmpeg -y -i "${inputPath}" -ac 1 -ab 64k -ar 16000 "${outputPath}"`,
            { stdio: "pipe", timeout: 120000 },
        );
        return readFileSync(outputPath);
    } finally {
        try {
            unlinkSync(inputPath);
        } catch {}
        try {
            unlinkSync(outputPath);
        } catch {}
    }
}

export interface TranscribeResult {
    text: string;
    detectedLanguage: string | null;
}

/**
 * Uses an LLM to identify and label different speakers in a transcription.
 * Returns the reformatted text with speaker labels (Speaker 1, Speaker 2, etc.)
 */
async function identifySpeakers(
    openai: OpenAI,
    model: string,
    rawText: string,
): Promise<string> {
    const response = await openai.chat.completions.create({
        model,
        messages: [
            {
                role: "system",
                content: `You are a transcription formatter that identifies different speakers in a conversation. Your job is to reformat a raw transcription by adding speaker labels.

Rules:
- Label speakers as "Speaker 1", "Speaker 2", etc. based on conversational cues (turn-taking, responses, different perspectives, questions vs answers)
- If you can identify a speaker's name from the conversation (e.g., "Thanks, Michael"), use their name instead of "Speaker N"
- Format each speaker turn on its own line as: "**Speaker Name:** text"
- Preserve ALL original text exactly — do not summarize, shorten, or rephrase anything
- If the recording appears to be a single speaker (monologue, lecture, presentation), label them as "Speaker" or by name if mentioned
- Group consecutive sentences from the same speaker together
- Return ONLY the reformatted transcription, nothing else`,
            },
            {
                role: "user",
                content: `Reformat this transcription with speaker labels:\n\n${rawText}`,
            },
        ],
        temperature: 0.1,
        max_completion_tokens: 16384,
    });

    return response.choices[0]?.message?.content?.trim() || rawText;
}

export async function transcribeRecording(
    userId: string,
    recordingId: string,
): Promise<TranscribeResult> {
    const [recording] = await db
        .select()
        .from(recordings)
        .where(
            and(eq(recordings.id, recordingId), eq(recordings.userId, userId)),
        )
        .limit(1);

    if (!recording) {
        throw new Error("Recording not found");
    }

    const [creds] = await db
        .select()
        .from(apiCredentials)
        .where(
            and(
                eq(apiCredentials.userId, userId),
                eq(apiCredentials.isDefaultTranscription, true),
            ),
        )
        .limit(1);

    if (!creds) {
        throw new Error("No transcription API configured");
    }

    const apiKey = decrypt(creds.apiKey);
    const openai = new OpenAI({
        apiKey,
        baseURL: creds.baseUrl || undefined,
    });

    // Download audio
    const storage = await createUserStorageProvider(userId);
    const rawBuffer = await storage.downloadFile(recording.storagePath);
    let audioBytes = new Uint8Array(rawBuffer);

    // Compress if over 25MB limit
    let wasCompressed = false;
    if (audioBytes.byteLength > MAX_UPLOAD_SIZE) {
        console.log(
            `Compressing ${recording.filename} (${(audioBytes.byteLength / 1024 / 1024).toFixed(1)}MB)...`,
        );
        const compressed = compressAudio(rawBuffer);
        audioBytes = new Uint8Array(compressed);
        wasCompressed = true;
        console.log(
            `Compressed to ${(audioBytes.byteLength / 1024 / 1024).toFixed(1)}MB`,
        );
    }

    // Detect actual format
    let contentType: string;
    let extension: string;
    if (wasCompressed) {
        contentType = "audio/mpeg";
        extension = ".mp3";
    } else {
        const isOgg =
            audioBytes[0] === 0x4f &&
            audioBytes[1] === 0x67 &&
            audioBytes[2] === 0x67 &&
            audioBytes[3] === 0x53;
        contentType = isOgg ? "audio/ogg" : "audio/mpeg";
        extension = isOgg ? ".ogg" : ".mp3";
    }

    const audioFile = new File(
        [audioBytes],
        `${recording.filename}${extension}`,
        { type: contentType },
    );

    const model = creds.defaultModel || "whisper-1";
    const isGpt4o = model.includes("gpt-4o");

    const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model,
        ...(isGpt4o ? {} : { response_format: "verbose_json" }),
    });

    type VerboseTranscription = { text: string; language?: string | null };

    const rawText =
        typeof transcription === "string"
            ? transcription
            : (transcription as VerboseTranscription).text;

    const detectedLanguage =
        typeof transcription === "string" || isGpt4o
            ? null
            : (transcription as VerboseTranscription).language || null;

    // Post-process: identify speakers using an LLM
    let text = rawText;
    try {
        // Get enhancement credentials (chat model) for speaker identification
        const [enhanceCreds] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.userId, userId),
                    eq(apiCredentials.isDefaultEnhancement, true),
                ),
            )
            .limit(1);

        const speakerCreds = enhanceCreds || creds;
        const speakerApiKey = decrypt(speakerCreds.apiKey);
        const speakerClient = new OpenAI({
            apiKey: speakerApiKey,
            baseURL: speakerCreds.baseUrl || undefined,
        });

        let speakerModel = speakerCreds.defaultModel || "gpt-4o-mini";
        if (speakerModel.includes("whisper")) {
            speakerModel = "gpt-4o-mini";
        }

        console.log(`Identifying speakers for ${recording.filename}...`);
        text = await identifySpeakers(speakerClient, speakerModel, rawText);
    } catch (e) {
        console.warn("Speaker identification failed, using raw text:", e);
    }

    // Save (upsert)
    const [existing] = await db
        .select()
        .from(transcriptions)
        .where(eq(transcriptions.recordingId, recordingId))
        .limit(1);

    if (existing) {
        await db
            .update(transcriptions)
            .set({
                text,
                detectedLanguage,
                transcriptionType: "server",
                provider: creds.provider,
                model,
            })
            .where(eq(transcriptions.id, existing.id));
    } else {
        await db.insert(transcriptions).values({
            recordingId,
            userId,
            text,
            detectedLanguage,
            transcriptionType: "server",
            provider: creds.provider,
            model,
        });
    }

    return { text, detectedLanguage };
}
