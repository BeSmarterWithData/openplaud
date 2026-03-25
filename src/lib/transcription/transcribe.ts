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

interface DeepgramWord {
    word: string;
    start: number;
    end: number;
    speaker: number;
    punctuated_word: string;
}

interface DeepgramResponse {
    results: {
        channels: Array<{
            alternatives: Array<{
                transcript: string;
                words: DeepgramWord[];
            }>;
        }>;
    };
}

/**
 * Convert audio to WAV format for Deepgram compatibility.
 * Deepgram rejects raw Ogg/Opus from Plaud devices.
 */
function convertToWav(audioBytes: Uint8Array): Buffer {
    const tempDir = mkdtempSync(join(tmpdir(), "openplaud-dg-"));
    const inputPath = join(tempDir, "input.audio");
    const outputPath = join(tempDir, "output.wav");

    try {
        writeFileSync(inputPath, audioBytes);
        execSync(
            `ffmpeg -y -i "${inputPath}" -ac 1 -ar 16000 "${outputPath}"`,
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

/**
 * Transcribe using Deepgram with speaker diarization.
 * Groups words by speaker and formats as "Speaker N: text"
 */
async function transcribeWithDeepgram(
    apiKey: string,
    audioBytes: Uint8Array,
): Promise<string> {
    // Convert to WAV for reliable Deepgram compatibility
    const wavBuffer = convertToWav(audioBytes);

    const response = await fetch(
        "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&diarize=true&paragraphs=true&punctuate=true",
        {
            method: "POST",
            headers: {
                Authorization: `Token ${apiKey}`,
                "Content-Type": "audio/wav",
            },
            body: wavBuffer as unknown as BodyInit,
        },
    );

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Deepgram API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as DeepgramResponse;
    const words = data.results?.channels?.[0]?.alternatives?.[0]?.words || [];

    if (words.length === 0) {
        return data.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
    }

    // Group consecutive words by speaker
    const segments: Array<{ speaker: number; text: string }> = [];
    for (const word of words) {
        const text = word.punctuated_word || word.word;
        if (
            segments.length === 0 ||
            segments[segments.length - 1].speaker !== word.speaker
        ) {
            segments.push({ speaker: word.speaker, text });
        } else {
            segments[segments.length - 1].text += ` ${text}`;
        }
    }

    // Format with speaker labels
    return segments
        .map((seg) => `Speaker ${seg.speaker + 1}: ${seg.text}`)
        .join("\n\n");
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

    let text: string;
    let detectedLanguage: string | null = null;
    const isDeepgram =
        creds.provider.toLowerCase() === "deepgram" ||
        (creds.baseUrl?.includes("deepgram") ?? false);

    if (isDeepgram) {
        // Use Deepgram with speaker diarization
        console.log(
            `Transcribing ${recording.filename} with Deepgram (diarization enabled), key starts: ${apiKey.substring(0, 6)}...`,
        );
        text = await transcribeWithDeepgram(apiKey, audioBytes);
    } else {
        // Use OpenAI-compatible API (Whisper, gpt-4o-transcribe, etc.)
        const openai = new OpenAI({
            apiKey,
            baseURL: creds.baseUrl || undefined,
        });

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

        type VerboseTranscription = {
            text: string;
            language?: string | null;
        };

        text =
            typeof transcription === "string"
                ? transcription
                : (transcription as VerboseTranscription).text;

        detectedLanguage =
            typeof transcription === "string" || isGpt4o
                ? null
                : (transcription as VerboseTranscription).language || null;
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
                model:
                    creds.defaultModel || (isDeepgram ? "nova-3" : "whisper-1"),
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
            model: creds.defaultModel || (isDeepgram ? "nova-3" : "whisper-1"),
        });
    }

    return { text, detectedLanguage };
}
