import 'server-only';

import { ApiError, GoogleGenAI } from '@google/genai';
import { z, type ZodType } from 'zod';

import { geminiJsonSchema } from '@/lib/agent/gemini-schema';
import { env } from '@/lib/env';

export type LlmUsage = { tokensUsed: number | null; modelId: string; retried: boolean };
export type LlmResult<T> = { data: T; usage: LlmUsage };

export async function generateJson<T>({
  system,
  user,
  schema,
  signal,
}: {
  system: string;
  user: string;
  schema: ZodType<T>;
  signal?: AbortSignal;
}): Promise<LlmResult<T>> {
  if (!env.GEMINI_API_KEY) throw new Error('Gemini is unavailable.');
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    let repair = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await client.models.generateContent({
          model: env.GEMINI_MODEL,
          contents: `${user}${repair}`,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            responseJsonSchema: geminiJsonSchema(schema),
            temperature: 0.2,
            maxOutputTokens: 3_000,
            abortSignal: controller.signal,
          },
        });
        const data = schema.parse(JSON.parse(response.text ?? ''));
        return {
          data,
          usage: {
            tokensUsed: response.usageMetadata?.totalTokenCount ?? null,
            modelId: env.GEMINI_MODEL,
            retried: attempt === 1,
          },
        };
      } catch (cause) {
        if (attempt === 1) throw cause;
        if (cause instanceof z.ZodError || cause instanceof SyntaxError) {
          const issue =
            cause instanceof z.ZodError
              ? cause.issues.map((item) => `${item.path.join('.')}: ${item.message}`).join('; ')
              : 'Output was not valid JSON.';
          repair = `\nPrevious output failed validation: ${issue.slice(0, 500)}. Return the complete JSON object only.`;
        } else if (cause instanceof ApiError && (cause.status === 429 || cause.status >= 500)) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1_000 + Math.floor(Math.random() * 250)),
          );
        } else {
          throw cause;
        }
      }
    }
    throw new Error('Gemini did not return a valid report.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
