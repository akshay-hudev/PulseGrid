import 'dotenv/config';
import { z } from 'zod';

const positiveInteger = z.coerce.number().int().positive();

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  EMAIL_QUEUE_NAME: z.string().min(1).default('pulsegrid-email'),
  API_INTERNAL_SECRET: z.string().min(32).optional(),
  CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
});

const workerSchema = baseSchema.extend({
  WORKER_CONCURRENCY: positiveInteger.default(10),
  ETHEREAL_SMTP_HOST: z.string().min(1).default('smtp.ethereal.email'),
  ETHEREAL_SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  ETHEREAL_SMTP_USER: z.string().min(1),
  ETHEREAL_SMTP_PASS: z.string().min(1),
});

export type BaseEnv = z.infer<typeof baseSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;

function parseEnvironment<T>(schema: z.ZodType<T>): T {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}

let baseEnv: BaseEnv | undefined;
let workerEnv: WorkerEnv | undefined;

export function getBaseEnv(): BaseEnv {
  baseEnv ??= parseEnvironment(baseSchema);
  return baseEnv;
}

export function getWorkerEnv(): WorkerEnv {
  workerEnv ??= parseEnvironment(workerSchema);
  return workerEnv;
}
