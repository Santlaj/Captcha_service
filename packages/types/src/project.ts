import { z } from 'zod';

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  siteKey: z.string().min(16),
  allowedDomains: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectInputSchema = z.object({
  name: z.string().min(1).max(100),
  allowedDomains: z.array(z.string()).min(1),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
