import {
    Body,
    Container,
    Head,
    Heading,
    Html,
    Preview,
    Section,
    Text,
} from "@react-email/components";
import { emailStyles } from "./styles";

interface EnhancementEmailProps {
    recordingName: string;
    summary: string;
    actionItems: string[];
    keyPoints: string[];
    dashboardUrl: string;
}

export function EnhancementEmail({
    recordingName,
    summary,
    actionItems = [],
    keyPoints = [],
    dashboardUrl,
}: EnhancementEmailProps) {
    return (
        <Html>
            <Head />
            <Preview>Summary ready: {recordingName}</Preview>
            <Body style={emailStyles.main}>
                <Container style={emailStyles.container}>
                    <Section style={emailStyles.content}>
                        <Heading style={emailStyles.h1}>
                            📝 {recordingName}
                        </Heading>

                        <Text
                            style={{
                                ...emailStyles.text,
                                fontWeight: "600",
                                fontSize: "16px",
                            }}
                        >
                            Summary
                        </Text>
                        <Text
                            style={{
                                ...emailStyles.text,
                                backgroundColor: "#f4f4f5",
                                padding: "16px",
                                borderRadius: "8px",
                                lineHeight: "1.6",
                            }}
                        >
                            {summary}
                        </Text>

                        {actionItems.length > 0 && (
                            <>
                                <Text
                                    style={{
                                        ...emailStyles.text,
                                        fontWeight: "600",
                                        fontSize: "16px",
                                        marginTop: "24px",
                                    }}
                                >
                                    ✅ Action Items ({actionItems.length})
                                </Text>
                                {actionItems.map((item) => (
                                    <Text
                                        key={item}
                                        style={{
                                            ...emailStyles.text,
                                            paddingLeft: "16px",
                                            marginBottom: "2px",
                                            lineHeight: "1.5",
                                        }}
                                    >
                                        • {item}
                                    </Text>
                                ))}
                            </>
                        )}

                        {keyPoints.length > 0 && (
                            <>
                                <Text
                                    style={{
                                        ...emailStyles.text,
                                        fontWeight: "600",
                                        fontSize: "16px",
                                        marginTop: "24px",
                                    }}
                                >
                                    💡 Key Points ({keyPoints.length})
                                </Text>
                                {keyPoints.map((point) => (
                                    <Text
                                        key={point}
                                        style={{
                                            ...emailStyles.text,
                                            paddingLeft: "16px",
                                            marginBottom: "2px",
                                            lineHeight: "1.5",
                                        }}
                                    >
                                        • {point}
                                    </Text>
                                ))}
                            </>
                        )}
                    </Section>

                    <Section style={emailStyles.footer}>
                        <Text style={emailStyles.footerText}>
                            Sent from OpenPlaud — {dashboardUrl}
                        </Text>
                    </Section>
                </Container>
            </Body>
        </Html>
    );
}
