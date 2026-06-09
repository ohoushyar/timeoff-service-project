import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { loadEnv, getEnv } from './config/env.js';

async function main(): Promise<void> {
  loadEnv();
  const env = getEnv();
  const app = await NestFactory.create(AppModule.register(), { bufferLogs: true });
  app.useLogger(app.get(Logger));

  await configureApp(app);
  await app.listen(env.PORT, '0.0.0.0');

  app.get(Logger).log(`Listening on 0.0.0.0:${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
