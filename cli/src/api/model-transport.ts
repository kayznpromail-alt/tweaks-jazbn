export const anthropicId = (id: string) => /(?:^|[^a-z0-9])(?:anthropic|claude|opus|sonnet|haiku)(?=$|[^a-z0-9])/i.test(id);
export const canonicalModel = (id: string) => id;
