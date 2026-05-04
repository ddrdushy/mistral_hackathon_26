import LegalLayout from "@/components/marketing/LegalLayout";

export const metadata = {
  title: "Terms of Service — HireOps AI",
  description: "Terms of service for using HireOps AI.",
};

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="2026-05-04">
      <p>
        These Terms of Service govern your use of HireOps AI, a product of Symprio. By
        creating an account, you agree to these terms.
      </p>
      <p>
        <strong>This is a template.</strong> Have a lawyer review it for your
        jurisdiction before launching to paying customers.
      </p>

      <h2>1. Your account</h2>
      <ul>
        <li>You must be at least 18 years old.</li>
        <li>You are responsible for keeping your password secure and for activity under your account.</li>
        <li>You are responsible for the actions of teammates you invite.</li>
        <li>One person, one workspace owner. Don&apos;t share credentials across employees — invite teammates instead.</li>
      </ul>

      <h2>2. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Upload data you don&apos;t have the right to process (candidates&apos; resumes you obtained without consent, etc.)</li>
        <li>Use the service for unlawful, discriminatory, or harassing purposes</li>
        <li>Reverse engineer, scrape, or attempt to extract our models or training data</li>
        <li>Run load or stress tests against our infrastructure without prior consent</li>
        <li>Attempt to access another tenant&apos;s data</li>
      </ul>
      <p>
        Violations may result in account suspension or termination without refund.
      </p>

      <h2>3. AI-generated content</h2>
      <p>
        HireOps AI uses third-party AI models (currently Mistral and ElevenLabs) to score
        resumes, generate interview questions, and conduct voice interviews. AI output:
      </p>
      <ul>
        <li>May contain mistakes. Treat AI suggestions as one signal, not the final decision.</li>
        <li>Should be reviewed by a human before any hiring decision is made.</li>
        <li>Is generated based on the inputs you provide; we do not warrant its accuracy.</li>
      </ul>
      <p>
        You are solely responsible for the hiring decisions you make using HireOps AI,
        and for compliance with employment law in your jurisdiction (including
        anti-discrimination law).
      </p>

      <h2>4. Billing and refunds</h2>
      <ul>
        <li>The Free plan is free indefinitely.</li>
        <li>Paid plans are billed monthly via Stripe. Charges are non-refundable except where required by law.</li>
        <li>You can cancel at any time via the in-app billing portal. Your plan stays active until the end of the current billing period.</li>
        <li>Failed payments mark your account &quot;past_due&quot;. We&apos;ll email you and retry. After repeated failures we may downgrade you to Free.</li>
      </ul>

      <h2>5. Service availability</h2>
      <p>
        We aim for high availability but make no formal SLA on the Free plan. Pro
        customers will receive a written SLA when we launch one.
      </p>

      <h2>6. Termination</h2>
      <ul>
        <li>You can delete your account anytime by contacting <a href="mailto:support@symprio.com">support@symprio.com</a>.</li>
        <li>We may terminate accounts that violate these Terms with notice except in cases of egregious abuse.</li>
        <li>On termination, your data is deleted within 30 days unless we&apos;re required to retain it by law.</li>
      </ul>

      <h2>7. Liability</h2>
      <p>
        To the maximum extent permitted by law, our total liability for any claim arising
        from your use of HireOps AI is limited to the amount you paid us in the prior
        12 months. We are not liable for indirect, consequential, or incidental damages.
      </p>

      <h2>8. Changes to these terms</h2>
      <p>
        We may update these Terms. Material changes will be emailed to active workspace
        owners with at least 14 days&apos; notice. Continued use after changes take effect
        constitutes acceptance.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions? Email <a href="mailto:legal@symprio.com">legal@symprio.com</a>.
      </p>
    </LegalLayout>
  );
}
