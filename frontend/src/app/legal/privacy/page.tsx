import LegalLayout from "@/components/marketing/LegalLayout";

export const metadata = {
  title: "Privacy Policy — HireOps AI",
  description: "How HireOps AI collects, uses, and protects your data.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="2026-05-04">
      <p>
        HireOps AI (&quot;we&quot;, &quot;us&quot;) is a product of Symprio. This Privacy Policy
        explains what data we collect, how we use it, and the rights you have over it.
      </p>
      <p>
        <strong>This is a template.</strong> Before going to production with real users,
        have a lawyer review it for your jurisdiction. The substance below describes the
        product&apos;s actual data handling so a lawyer can refine the wording.
      </p>

      <h2>1. Data we collect</h2>
      <h3>Account data</h3>
      <ul>
        <li>Email, name, password (stored as an argon2 hash — never plaintext)</li>
        <li>Workspace name and plan</li>
        <li>Login timestamps and IP addresses</li>
      </ul>

      <h3>Recruiting data you upload or generate</h3>
      <ul>
        <li>Job postings, candidate names, emails, phone numbers, resume text</li>
        <li>Email content from connected inboxes (when you sync via Gmail or IMAP)</li>
        <li>Interview transcripts (Q&A answers and voice transcripts)</li>
        <li>Webcam-derived signals during interviews: face presence and attention scores. We do <strong>not</strong> store interview video.</li>
        <li>Behavioural signals during Q&A interviews: tab focus loss, paste events, typing time</li>
      </ul>

      <h3>Usage data</h3>
      <ul>
        <li>Pages viewed, actions taken, errors encountered</li>
        <li>Stripe billing metadata (when you upgrade) — Stripe handles card details directly; we never see them</li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>To run the product: route candidates through your pipeline, score resumes, conduct interviews</li>
        <li>To bill you for paid plans (via Stripe)</li>
        <li>To improve product reliability via aggregated, de-identified telemetry</li>
        <li>To send transactional email (signup verification, password reset, interview invitations)</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your data, share it with advertisers, or use your
        recruiting data to train AI models.
      </p>

      <h2>3. Subprocessors</h2>
      <p>To deliver the product, we share specific data with the following processors:</p>
      <ul>
        <li><strong>Mistral AI</strong> — resume scoring, Q&A question generation and grading, interview evaluation. Resume text and interview transcripts are sent for inference; not stored long-term by Mistral per their data policy.</li>
        <li><strong>ElevenLabs</strong> — voice interview agent. Audio streams during the interview only.</li>
        <li><strong>Stripe</strong> — payment processing and billing portal.</li>
        <li><strong>Google (Gmail API)</strong> — only if you connect your Gmail. Read/send scopes apply only to the connected account.</li>
        <li><strong>Hosting</strong> — VPS infrastructure for the application and database.</li>
      </ul>

      <h2>4. Data isolation</h2>
      <p>
        Each workspace (tenant) is isolated at the database level via a
        <code className="px-1 py-0.5 bg-slate-100 rounded text-xs">tenant_id</code> column on every record.
        Queries from one tenant never see data from another.
      </p>

      <h2>5. Retention</h2>
      <ul>
        <li>Account data: retained while your workspace is active. Deleted on request.</li>
        <li>Candidate data: retained per your workspace&apos;s preferences. You can delete a candidate at any time.</li>
        <li>Email verification + password reset tokens: 24 hours / 1 hour respectively, then expire.</li>
        <li>Audit logs: 12 months.</li>
      </ul>

      <h2>6. Your rights</h2>
      <p>
        You can request access, export, correction, or deletion of your personal data at any time.
        Email <a href="mailto:privacy@symprio.com">privacy@symprio.com</a>. We aim to respond within 30 days.
      </p>

      <h2>7. Security</h2>
      <ul>
        <li>Passwords hashed with argon2 (memory-hard, industry standard)</li>
        <li>JWT session cookies are HttpOnly and SameSite=Lax</li>
        <li>HTTPS for all connections in production</li>
        <li>Daily automated backups of the database, encrypted at rest</li>
      </ul>

      <h2>8. Cookies</h2>
      <p>
        See our <a href="/legal/cookies">Cookie Policy</a> for what cookies we set and why.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions? Email <a href="mailto:privacy@symprio.com">privacy@symprio.com</a>.
      </p>
    </LegalLayout>
  );
}
