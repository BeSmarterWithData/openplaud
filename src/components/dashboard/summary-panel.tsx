"use client";

import { BookOpen, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SummaryPanelProps {
    summary?: string | null;
    provider?: string | null;
    model?: string | null;
    hasTranscription: boolean;
    isEnhancing: boolean;
    onEnhance: () => void;
}

export function SummaryPanel({
    summary,
    provider,
    model,
    hasTranscription,
    isEnhancing,
    onEnhance,
}: SummaryPanelProps) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <BookOpen className="w-5 h-5" />
                        Summary
                    </CardTitle>
                    {hasTranscription && !isEnhancing && (
                        <Button
                            onClick={onEnhance}
                            size="sm"
                            variant={summary ? "outline" : "default"}
                            disabled={isEnhancing}
                        >
                            {summary ? (
                                <>
                                    <RefreshCw className="w-4 h-4 mr-2" />
                                    Regenerate
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-4 h-4 mr-2" />
                                    Generate Summary
                                </>
                            )}
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {isEnhancing ? (
                    <div className="flex flex-col items-center justify-center py-12">
                        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mb-4" />
                        <p className="text-sm text-muted-foreground">
                            Analyzing transcription...
                        </p>
                    </div>
                ) : summary ? (
                    <div className="space-y-4">
                        <div className="bg-muted rounded-lg p-4">
                            <p className="text-sm leading-relaxed">{summary}</p>
                        </div>
                        {(provider || model) && (
                            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
                                {provider && <span>Provider: {provider}</span>}
                                {model && <span>Model: {model}</span>}
                            </div>
                        )}
                    </div>
                ) : hasTranscription ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <BookOpen className="w-10 h-10 text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground">
                            No summary generated yet
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <BookOpen className="w-10 h-10 text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground">
                            Transcribe the recording first to generate a summary
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
