// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  // Ensure clients always revalidate.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.NOW_GITHUB_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    "";
  return res.status(200).json({
    version,
    timestamp: new Date().toISOString(),
  });
}

