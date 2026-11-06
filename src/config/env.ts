import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    PORT: z.coerce.number().int().positive().default(3000),

    STORE: z.enum(['gcs', 's3', 'azure']),

    // The bucket's name, or account/container for azure.
    BUCKET: z.string().min(1),

    // Set for an S3-compatible service; the AWS SDK reads it too.
    AWS_ENDPOINT_URL_S3: z.url().optional(),

    // This server's URL: CI requests its GitHub OIDC token for this audience.
    OIDC_AUDIENCE: z.string().min(1),

    // gh api repos/OWNER/REPO -q .id
    GITHUB_REPOSITORY_ID: z.string().regex(/^\d+$/),

    // The branch whose jobs write the shared namespace.
    GITHUB_DEFAULT_BRANCH: z.string().min(1).default('main'),

    // 32 random bytes, base64. Signs cache tokens; changing it invalidates the ones issued.
    TOKEN_KEY: z
      .string()
      .transform((value) => new Uint8Array(Buffer.from(value, 'base64')))
      .refine((key) => key.length === 32, 'must be 32 bytes, base64-encoded'),
  },
  runtimeEnv: process.env,
});
