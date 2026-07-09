import { NylasClient } from "./client.js";

// Sending is deliberately NOT an agent tool. The agent drafts; this
// function is only called from app code after explicit human confirmation
// (CLI prompt or the web confirm form). Agent proposes, human disposes.

export interface SendResult {
  messageId: string;
  requestId?: string;
}

export async function sendMessage(
  client: NylasClient,
  grantId: string,
  options: {
    to: { email: string; name?: string }[];
    subject: string;
    body: string;
    replyToMessageId?: string;
  },
): Promise<SendResult> {
  const res = await client.request<{ id: string }>(
    `/v3/grants/${grantId}/messages/send`,
    {
      method: "POST",
      body: {
        to: options.to,
        subject: options.subject,
        body: options.body,
        ...(options.replyToMessageId
          ? { reply_to_message_id: options.replyToMessageId }
          : {}),
      },
    },
  );

  return { messageId: res.data.id, requestId: res.requestId };
}
