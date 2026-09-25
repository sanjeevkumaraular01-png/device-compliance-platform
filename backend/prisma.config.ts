// Prisma CLI configuration (replaces the deprecated `prisma` block in package.json).
// With a config file present the CLI no longer loads .env on its own, so do it here;
// in containers the variables come from the environment and .env is simply absent.
import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
});
