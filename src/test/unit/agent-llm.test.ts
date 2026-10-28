import { describe, expect, it, vi } from 'vitest';

import { generateJson } from '@/lib/agent/llm-client';
import { InvestigationReportSchema } from '@/lib/agent/types';

const state = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@google/genai', () => {
  class ApiError extends Error {
    status: number;
    constructor(input: { message: string; status: number }) {
      super(input.message);
      this.status = input.status;
    }
  }
  return {
    ApiError,
    GoogleGenAI: class {
      models = {
        generateContent: async () => {
          state.calls += 1;
          throw new ApiError({ message: 'simulated provider outage', status: 503 });
        },
      };
    },
  };
});

describe('agent provider retry', () => {
  it('attempts a transient provider failure twice and then fails closed to the caller', async () => {
    state.calls = 0;
    await expect(
      generateJson({
        system: 'Return JSON.',
        user: 'Synthetic case.',
        schema: InvestigationReportSchema,
      }),
    ).rejects.toThrow('simulated provider outage');
    expect(state.calls).toBe(2);
  });
});
