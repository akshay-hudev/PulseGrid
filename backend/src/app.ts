import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import emailRoutes from './routes/emails';
import authRoutes from './routes/auth';
import { errorHandler } from './http/errors';
import { getBaseEnv } from './config/env';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: getBaseEnv().CORS_ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'idempotency-key',
      'x-api-internal-secret',
      'x-user-id',
    ],
  }),
);
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'pulsegrid-api' });
});
app.use('/api/auth', authRoutes);
app.use('/api', emailRoutes);
app.use(errorHandler);

export default app;
