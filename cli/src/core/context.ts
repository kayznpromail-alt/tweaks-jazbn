import type { Message, Profile, WireMessage } from "../types";

/** jedna instrukcja; dla każdej tury tylko ostatnia niepusta próba odpowiedzi. */
export function buildContext(messages: Message[], profile: Profile | null, retry: boolean): WireMessage[] {
  const context: WireMessage[] = profile ? [{ role: "system", content: profile.instructions }] : [];
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  let assistant: Message | undefined;
  const flush = () => {
    if (assistant) context.push({ role: "assistant", content: assistant.content });
    assistant = undefined;
  };
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "user") {
      flush();
      context.push({ role: "user", content: message.content, ...(message.images?.length ? {images:message.images} : {}) });
    } else if (message.role === "assistant" && message.content.trim() && !(retry && index > lastUser)) {
      assistant = message;
    }
  }
  flush();
  return context;
}
