import { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import express from 'express';
import { JsonApiExceptionFilter } from './common/filters/jsonapi-exception.filter.js';
import { loadOpenApiSpec } from './openapi/load-spec.js';

export async function configureApp(app: INestApplication): Promise<void> {
  app.use(express.json({ type: ['application/json', 'application/vnd.api+json'] }));
  app.useGlobalFilters(new JsonApiExceptionFilter());

  const document = loadOpenApiSpec() as unknown as OpenAPIObject;
  SwaggerModule.setup('/docs', app, document, {
    jsonDocumentUrl: '/docs/json',
    swaggerOptions: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
}
