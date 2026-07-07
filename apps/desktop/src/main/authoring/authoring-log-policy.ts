const RAW_REPLY_LOG_FLAG = "MOTIONREAL_AUTHORING_RAW_LOGS";
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function shouldLogRawAiReplies(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[RAW_REPLY_LOG_FLAG]?.trim().toLowerCase();
  return value ? TRUE_VALUES.has(value) : false;
}

export function rawAiReplyLogFields(reply: string, env: NodeJS.ProcessEnv = process.env): { rawReply: string } | Record<string, never> {
  return shouldLogRawAiReplies(env) ? { rawReply: reply.slice(0, 2000) } : {};
}
