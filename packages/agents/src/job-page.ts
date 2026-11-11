import { z } from 'zod';
import { generate, type Mode, type ProviderHooks } from './provider.js';

// The model only proposes fields with quotes; the web source accepts a page after checking
// each quote against the page text on the server.
export const jobPageSchema = z.object({
  isJobPosting: z.boolean(),
  title: z.string().max(300),
  titleQuote: z.string().max(500),
  company: z.string().max(300),
  companyQuote: z.string().max(500),
  location: z.string().max(300),
  locationQuote: z.string().max(500),
  employmentType: z.string().max(80),
});
export type JobPage = z.infer<typeof jobPageSchema>;

export async function extractJobPage(
  page: { url: string; text: string },
  mode: Mode,
  hooks: ProviderHooks,
  signal?: AbortSignal,
): Promise<JobPage> {
  return generate(
    'job-page',
    {
      goal: 'Read one public job page',
      facts: [],
      sourceText: page.url + '\n' + page.text.slice(0, 24000),
    },
    jobPageSchema,
    mode,
    hooks,
    signal,
  );
}
