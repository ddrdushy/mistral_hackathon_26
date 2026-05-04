import LegalLayout from "@/components/marketing/LegalLayout";

export const metadata = {
  title: "Cookie Policy — HireOps AI",
  description: "What cookies HireOps AI uses and why.",
};

export default function CookiesPage() {
  return (
    <LegalLayout title="Cookie Policy" lastUpdated="2026-05-04">
      <p>
        We try to be honest and minimal about cookies. We don&apos;t run advertising or
        third-party analytics that track you across the web.
      </p>

      <h2>What we set</h2>
      <ul>
        <li>
          <strong>hireops_session</strong> — a signed JWT in an HttpOnly, SameSite=Lax
          cookie. Required to keep you logged in. Expires in 7 days. Without this you
          can&apos;t use the app.
        </li>
        <li>
          <strong>sidebar-collapsed</strong> — localStorage key (technically not a
          cookie but listed here for completeness) that remembers if you collapsed
          the sidebar. Cosmetic only.
        </li>
        <li>
          <strong>hireops:tour-completed:v1</strong> — localStorage key that prevents
          the onboarding tour from re-showing every visit. Cosmetic only.
        </li>
        <li>
          <strong>hireops:cookie-consent</strong> — localStorage key that remembers
          you&apos;ve seen the cookie banner. Cosmetic only.
        </li>
      </ul>

      <h2>What we don&apos;t set</h2>
      <ul>
        <li>No advertising cookies.</li>
        <li>No cross-site trackers.</li>
        <li>No third-party analytics that fingerprint you.</li>
      </ul>

      <h2>Stripe</h2>
      <p>
        When you upgrade and are redirected to Stripe Checkout, Stripe sets its own
        cookies on its own domain to process the payment. See{" "}
        <a href="https://stripe.com/cookies-policy/legal" target="_blank" rel="noopener noreferrer">
          Stripe&apos;s cookie policy
        </a>{" "}
        for details. We never see your card details.
      </p>

      <h2>Disabling cookies</h2>
      <p>
        Disabling the <code className="px-1 py-0.5 bg-slate-100 rounded text-xs">hireops_session</code> cookie will
        log you out and prevent you from using the app. The other localStorage keys
        only affect cosmetics — disabling them is fine.
      </p>

      <h2>Contact</h2>
      <p>
        Questions? Email <a href="mailto:privacy@symprio.com">privacy@symprio.com</a>.
      </p>
    </LegalLayout>
  );
}
