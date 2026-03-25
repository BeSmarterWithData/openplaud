"use client";

import { CheckSquare, Lightbulb } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ActionItemsPanelProps {
    actionItems?: string[] | null;
    keyPoints?: string[] | null;
    isEnhancing: boolean;
}

export function ActionItemsPanel({
    actionItems,
    keyPoints,
    isEnhancing,
}: ActionItemsPanelProps) {
    const hasActionItems = actionItems && actionItems.length > 0;
    const hasKeyPoints = keyPoints && keyPoints.length > 0;
    const hasContent = hasActionItems || hasKeyPoints;

    if (isEnhancing) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <CheckSquare className="w-5 h-5" />
                        Action Items & Key Points
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center py-12">
                        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mb-4" />
                        <p className="text-sm text-muted-foreground">
                            Extracting action items and key points...
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (!hasContent) {
        return null;
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Action Items */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <CheckSquare className="w-5 h-5" />
                        Action Items
                        {hasActionItems && (
                            <span className="text-xs font-normal text-muted-foreground ml-auto">
                                {actionItems.length} item
                                {actionItems.length !== 1 ? "s" : ""}
                            </span>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {hasActionItems ? (
                        <ul className="space-y-2">
                            {actionItems.map((item) => (
                                <li
                                    key={item}
                                    className="flex items-start gap-2 text-sm"
                                >
                                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                    <span className="leading-relaxed">
                                        {item}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">
                            No action items identified
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* Key Points */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Lightbulb className="w-5 h-5" />
                        Key Points
                        {hasKeyPoints && (
                            <span className="text-xs font-normal text-muted-foreground ml-auto">
                                {keyPoints.length} point
                                {keyPoints.length !== 1 ? "s" : ""}
                            </span>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {hasKeyPoints ? (
                        <ul className="space-y-2">
                            {keyPoints.map((point) => (
                                <li
                                    key={point}
                                    className="flex items-start gap-2 text-sm"
                                >
                                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-yellow-500 shrink-0" />
                                    <span className="leading-relaxed">
                                        {point}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">
                            No key points identified
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
