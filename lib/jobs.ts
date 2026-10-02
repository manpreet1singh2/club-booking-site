/** Authorizes internal jobs: manual calls (x-internal-job-secret) and Vercel Cron (Authorization: Bearer). */
export function isAuthorizedJob(req: Request): boolean {
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!secret) return false;
  if (req.headers.get("x-internal-job-secret") === secret) return true;
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET || secret}`;
}
