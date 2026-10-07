import 'dotenv/config';
import { deliverPendingReportEmails } from '../src/api/moderation-report-email.js';

// Bounded one-shot worker for the existing operator scheduler. No web endpoint
// or user-controlled recipient is exposed; output is aggregate counts only.
try {
  const result = await deliverPendingReportEmails();
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
} catch {
  console.error('REPORT_EMAIL_WORKER_UNAVAILABLE');
  process.exitCode = 1;
}
