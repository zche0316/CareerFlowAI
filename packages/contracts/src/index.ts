import { z } from 'zod';

// Shared input contracts drive server validation and client field types.
export const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    goals: z.string().trim().min(3).max(2000),
    skills: z.array(z.string().trim().min(1).max(80)).max(40),
    interests: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    education: z.string().trim().min(1, 'Enter education or explicitly state none yet.').max(2000),
    experience: z
      .string()
      .trim()
      .min(1, 'Enter experience or explicitly state none yet.')
      .max(4000),
    experienceYears: z.number().min(0).max(60),
    location: z.string().trim().max(100).default(''),
    employmentType: z.string().max(100).default(''),
    workArrangement: z.string().trim().max(100).default(''),
    companySize: z.string().trim().max(100).default(''),
    industry: z.string().trim().max(100).default(''),
    startDate: z.string().date().nullable().default(null),
    endDate: z.string().date().nullable().default(null),
    salaryMin: z.number().nonnegative().nullable().default(null),
    salaryMax: z.number().nonnegative().nullable().default(null),
    currency: z.string().max(10).default(''),
    sharing: z.object({
      coach: z.boolean(),
      matching: z.boolean(),
      resume: z.boolean(),
      interview: z.boolean(),
    }),
  })

  // Cross-field rules cannot be expressed by individual field validators.
  .superRefine((p, c) => {
    if (!p.skills.length && !p.interests.length)
      c.addIssue({
        code: 'custom',
        path: ['skills'],
        message: 'Add at least one skill or career interest.',
      });
    if (p.endDate && p.startDate && p.endDate < p.startDate)
      c.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must not precede start date.',
      });
    if (p.salaryMin !== null || p.salaryMax !== null) {
      if (!p.currency)
        c.addIssue({ code: 'custom', path: ['currency'], message: 'Salary requires a currency.' });
      if (p.salaryMin !== null && p.salaryMax !== null && p.salaryMin > p.salaryMax)
        c.addIssue({
          code: 'custom',
          path: ['salaryMax'],
          message: 'Maximum salary must not be below minimum.',
        });
    }
  });

export type CareerProfile = z.infer<typeof profileSchema>;

export type Fact = { id: string; kind: string; text: string; source: string };

const coachRecommendationSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  evidenceIds: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  reason: z.string().trim().min(1).max(1000),
});

export const coachSchema = z.object({
  strengths: z.array(coachRecommendationSchema),
  gaps: z.array(coachRecommendationSchema),
  directions: z.array(coachRecommendationSchema),
  actions: z.array(coachRecommendationSchema),
});

export const profileBuilderDraftSchema = z.object({
  draft: z.object({
    name: z.string().trim().min(1).max(100).optional(),
    goals: z.string().trim().min(3).max(2000).optional(),
    skills: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
    interests: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    education: z.string().trim().min(1).max(2000).optional(),
    experience: z.string().trim().min(1).max(4000).optional(),
    experienceYears: z.number().min(0).max(60).optional(),
    location: z.string().trim().max(100).optional(),
    employmentType: z.string().trim().max(100).optional(),
    workArrangement: z.string().trim().max(100).optional(),
    companySize: z.string().trim().max(100).optional(),
    industry: z.string().trim().max(100).optional(),
    startDate: z.string().date().nullable().optional(),
    endDate: z.string().date().nullable().optional(),
    salaryMin: z.number().nonnegative().nullable().optional(),
    salaryMax: z.number().nonnegative().nullable().optional(),
    currency: z.string().trim().max(10).optional(),
  }),
  followUpQuestions: z.array(z.string().trim().min(1).max(500)).max(8),
  proposedChanges: z
    .array(
      z.object({
        field: z.enum([
          'name',
          'goals',
          'skills',
          'interests',
          'education',
          'experience',
          'experienceYears',
          'location',
          'employmentType',
          'workArrangement',
          'companySize',
          'industry',
          'startDate',
          'endDate',
          'salaryMin',
          'salaryMax',
          'currency',
        ]),
        proposedValue: z.string().trim().min(1).max(8000),
        evidence: z.string().trim().min(1).max(2000),
      }),
    )
    .max(40),
});

// Models propose evidence IDs and emphasis only; the server supplies candidate claim text.
export const resumePlanSchema = z.object({
  claims: z
    .array(z.object({ factId: z.string(), reason: z.string() }))
    .min(1)
    .max(20),
});

export const questionsSchema = z
  .object({
    questions: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(100),
          question: z.string().trim().min(8).max(2000),
          focus: z.string().trim().min(1).max(200),
        }),
      )
      .min(1)
      .max(3),
  })
  .superRefine(({ questions }, context) => {
    if (new Set(questions.map((question) => question.id)).size !== questions.length)
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'Interview question IDs must be unique.',
      });
  });

export const feedbackSchema = z.object({
  strengths: z.array(z.string().trim().min(1).max(1000)).min(1).max(5),
  improvements: z.array(z.string().trim().min(1).max(1000)).min(1).max(5),
  nextSteps: z.array(z.string().trim().min(1).max(1000)).min(1).max(5),
});

export const negotiationInputSchema = z.object({
  offerSalary: z.number().positive().max(100_000_000),
  targetSalary: z.number().positive().max(100_000_000),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  candidateMessage: z.string().trim().min(10).max(4000),
});

export const negotiationOutputSchema = z.object({
  recruiterReply: z.string().trim().min(10).max(2000),
  feedback: feedbackSchema,
});

export const negotiationDecisionSchema = z.object({
  decision: z.enum(['accept', 'decline']),
});

export const answerSchema = z.object({
  questionId: z.string().max(100),
  answer: z.string().trim().min(1).max(6000),
});

// Discriminated decisions map directly to the three persisted human-intervention points.
export const decisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('job'), jobId: z.string().max(100) }),
  z.object({
    kind: z.literal('resume'),
    decision: z.enum(['approve', 'revise']),
    draftHash: z.string(),
    feedback: z.string().max(2000).default(''),
  }),
  z.object({ kind: z.literal('interview'), endedEarly: z.boolean().default(false) }),
]);

// Fictional development data; using it still requires explicit profile review.
export const sampleProfile: CareerProfile = {
  name: 'Alex Morgan',
  goals: 'Find an entry-level data analyst role and develop practical reporting skills.',
  skills: ['Python', 'SQL', 'Git', 'Excel'],
  interests: ['data analysis'],
  education: 'Bachelor of Information Technology (fictional demo candidate)',
  experience: 'Built a student project that cleaned a sample dataset and produced SQL reports.',
  experienceYears: 0,
  location: 'Sydney',
  employmentType: 'Full-time',
  workArrangement: '',
  companySize: '',
  industry: '',
  startDate: null,
  endDate: null,
  salaryMin: null,
  salaryMax: null,
  currency: '',
  sharing: { coach: true, matching: true, resume: true, interview: true },
};

export const AGENTS = [
  {
    id: 'profile',
    name: 'Profile Builder',
    requirement: 'R1',
    purpose: 'Turn your information into an approved, reusable profile.',
  },
  {
    id: 'coach',
    name: 'Career Coach',
    requirement: 'R2',
    purpose: 'Identify strengths, skill gaps and practical career directions.',
  },
  {
    id: 'matching',
    name: 'Job Matcher',
    requirement: 'R3',
    purpose: 'Rank supported jobs and explain the evidence behind each match.',
  },
  {
    id: 'resume',
    name: 'Resume Tailor',
    requirement: 'R4',
    purpose: 'Prepare a factual resume with traceable claims and your approval.',
  },
  {
    id: 'interview',
    name: 'Interview Coach',
    requirement: 'R5',
    purpose: 'Practise role-specific questions and learn from your feedback.',
  },
];

export const jobSearchSchema = z.object({
  provider: z
    .enum(['employers', 'greenhouse', 'adzuna', 'fixtures', 'manual'])
    .default('greenhouse'),
  board: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .default('spaceship'),
  country: z.enum(['au', 'nz', 'gb', 'us', 'ca', 'sg', 'de', 'fr']).default('au'),
  region: z.string().max(150).default(''),
  location: z.string().max(150).default(''),
  keyword: z.string().max(150).default(''),
  listing: z
    .object({
      url: z.string().max(2000),
      title: z.string().trim().min(1).max(300),
      company: z.string().trim().min(1).max(300),
      location: z.string().trim().min(1).max(300),
      description: z.string().trim().min(20).max(20000),
    })
    .optional(),
});
export type JobSearch = z.infer<typeof jobSearchSchema>;
