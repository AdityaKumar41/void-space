/**
 * OpenAPI surface (SRS §3.1: "a documented, versioned REST API", §6.4).
 *
 * Registered in development and test only. The generated document lists every route
 * with its tags; the prose contract — request/response shapes, error codes and the
 * RBAC requirement per endpoint — lives in docs/VS-SDD-2.0-api.md, which is the
 * document the frontend and the QA matrix are written against.
 */
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { ApiEnv } from '../env';

/**
 * Registered through `fp` on purpose: swagger collects routes with an `onRoute` hook,
 * which only sees routes registered *inside its own encapsulation context*. Without
 * `fp` the document comes out with zero paths — the plugin's scope would contain no
 * routes at all.
 */
export const openApiPlugin = fp<ApiEnv>(
  async (app: FastifyInstance, env: ApiEnv) => {
    if (env.NODE_ENV === 'production') return;

    await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'VOID·SPACE API',
        description:
          'Multi-tenant 3D asset lifecycle API: ingestion, AI-assisted metadata, review, ' +
          'IPFS-backed storage and on-chain licensing. Authentication is cookie-based for ' +
          'browsers (httpOnly access + rotating refresh) and bearer-token based for machines ' +
          '(API keys exchanged at POST /api/v1/auth/token). See docs/VS-SDD-2.0-api.md.',
        version: '2.0.0',
      },
      servers: [{ url: 'https://localhost/api/v1', description: 'Local stack (nginx edge)' }],
      tags: [
        { name: 'auth', description: 'Sign-in, sessions, SSO, API keys (FR-2.x)' },
        { name: 'users', description: 'Tenant members and roles (FR-1.2, FR-1.3, §3.6)' },
        { name: 'tenant', description: 'Workspace settings and platform administration (FR-1.5, FR-14.x)' },
        { name: 'audit', description: 'Append-only audit log (FR-13.x)' },
      ],
      components: {
        securitySchemes: {
          accessCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: 'vs_access',
            description: 'httpOnly access JWT set by /auth/login (FR-2.3).',
          },
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Short-lived token from POST /auth/token (FR-2.5).',
          },
        },
      },
    },
  });

    await app.register(swaggerUi, {
      routePrefix: '/api/v1/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true },
      staticCSP: true,
    });
  },
  { name: 'void-space-openapi' },
);
