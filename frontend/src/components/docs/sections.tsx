"use client";

import { DocImage, K, Tip } from "./DocsLayout";
import Link from "next/link";

/**
 * One React component per docs slug. Keyed off the slug so the dynamic
 * page can render the right body without setting up MDX. Each section
 * follows the same shape: a short intro paragraph, screenshot, then
 * step-by-step instructions / details.
 *
 * Screenshots live at /docs/screenshots/{slug}.png — captured via the
 * Playwright skill against the live deployment. DocImage falls back
 * gracefully when a screenshot hasn't been captured yet.
 */

export function GettingStarted() {
  return (
    <>
      <h1>Signing up & first steps</h1>
      <p className="lead">
        Five-minute walk-through from a fresh signup to your first connected
        mailbox.
      </p>

      <h2>1. Create your workspace</h2>
      <p>
        Head to <Link href="/signup">https://hireops.symprio.com/signup</Link>{" "}
        and enter your name, work email, and a company name. You&apos;ll get a
        verification email — clicking the link returns you to the app and
        kicks off the onboarding wizard.
      </p>
      <DocImage src="/docs/screenshots/signup.png" alt="Signup form" />

      <h2>2. Complete your organization profile</h2>
      <p>
        Fill the onboarding form with your industry, headquarters city,
        default work mode, and currency. These power the AI features: the
        job-description generator no longer invents &quot;San Francisco, CA&quot;
        for a Kuala Lumpur company, and outreach copy uses your real
        company name.
      </p>
      <DocImage
        src="/docs/screenshots/onboarding.png"
        alt="Organization onboarding form"
        caption="Required: industry + headquarters. Everything else is optional but improves AI quality."
      />

      <Tip kind="info">
        You can always revisit these later under{" "}
        <K>Settings → Organization Profile</K>.
      </Tip>

      <h2>3. Connect your inbox</h2>
      <p>
        Go to <K>Settings → Email Integrations</K> and pick Gmail / Outlook /
        Yahoo / iCloud. You&apos;ll need an{" "}
        <strong>app password</strong> (not your account password) — for Gmail
        that&apos;s generated under your Google account&apos;s &quot;App
        passwords&quot; section.
      </p>
      <DocImage src="/docs/screenshots/email-integrations.png" alt="Email integrations page" />
      <p>
        Once connected, the IMAP listener checks your inbox every 20 seconds.
        Job-application emails are auto-classified, CVs extracted, candidates
        created in the talent bank, and matched against your open jobs.
      </p>

      <h2>What&apos;s next?</h2>
      <ul>
        <li>
          Create your first job — see{" "}
          <Link href="/docs/jobs">Creating &amp; managing jobs</Link>.
        </li>
        <li>
          Upload past CVs in bulk — see <Link href="/docs/talent-bank">Talent Bank</Link>.
        </li>
        <li>
          Pick a pricing plan — see <Link href="/docs/billing">Billing &amp; plan</Link>.
        </li>
      </ul>
    </>
  );
}

export function Dashboard() {
  return (
    <>
      <h1>Dashboard tour</h1>
      <p className="lead">
        The home screen surfaces the four numbers HR checks most often plus a
        timeline of recent pipeline activity.
      </p>
      <DocImage src="/docs/screenshots/dashboard.png" alt="Dashboard overview" />

      <h2>Stat tiles</h2>
      <ul>
        <li>
          <strong>Open jobs</strong> — every job whose status is &quot;open&quot;.
          Clicking jumps to the Jobs list.
        </li>
        <li>
          <strong>Candidates in pipeline</strong> — applications not yet in
          &quot;shortlisted&quot; or &quot;rejected&quot; state.
        </li>
        <li>
          <strong>Interviews this week</strong> — interview links generated in
          the last 7 days regardless of stage.
        </li>
        <li>
          <strong>Shortlisted</strong> — candidates marked
          &quot;shortlisted&quot; in the last 30 days. These are who you
          actually want to focus on.
        </li>
      </ul>

      <h2>Recent activity</h2>
      <p>
        The timeline shows the last 20 events from across the tenant —
        candidate matched, interview started/completed, link sent, transcript
        received. Same source data as the bell-icon notifications.
      </p>

      <Tip kind="info">
        The bell icon in the top bar shows the same activity but stays
        accessible from any page. Click it to mark items as read.
      </Tip>
    </>
  );
}

export function Jobs() {
  return (
    <>
      <h1>Creating & managing jobs</h1>
      <p className="lead">
        The job is the unit that ties everything together — interview mode,
        question bank, pipeline template, and which candidates apply.
      </p>

      <h2>Create with AI</h2>
      <p>
        Hit <K>Jobs → New</K>, type just the title, click{" "}
        <strong>Generate with AI</strong>. The generator pulls your
        organization profile (industry, HQ, work mode) so the output uses
        your real company context. Edit anything before saving.
      </p>
      <DocImage src="/docs/screenshots/jobs-new.png" alt="New job form with AI generate" />

      <h3>Auto-generate interview questions</h3>
      <p>
        On the same form, the &quot;Auto-generate interview questions&quot;
        panel lets you dial behavioural / technical / situational / culture
        fit counts. Defaults to 3+3+2+0 = 8 questions; capped at 20 per
        job. After save, the questions are pre-filled on the job&apos;s
        Interview Questions tab — edit, reorder, or delete any of them.
      </p>

      <h2>Interview mode</h2>
      <p>Pick one of three when creating the job:</p>
      <ul>
        <li>
          <strong>AI Voice Interview</strong> — ElevenLabs runs an automated
          voice screen with face tracking. Transcript + recording delivered
          via webhook.
        </li>
        <li>
          <strong>Written Q&amp;A</strong> — three rounds (aptitude /
          reasoning / CV-based technical). LLM-graded.
        </li>
        <li>
          <strong>HR Video Interview</strong> — recruiter and candidate meet
          in an in-platform Jitsi room. You score manually after the call.
        </li>
      </ul>

      <h2>Pipeline stages</h2>
      <p>
        Each job uses the tenant&apos;s default pipeline template (7 stages
        from <em>new</em> to <em>shortlisted</em> / <em>rejected</em>). Edit
        stages under <K>Settings → Pipeline Templates</K> — changes apply to
        all jobs without breaking existing applications.
      </p>

      <h2>Matching candidates from Talent Bank</h2>
      <p>
        Each job detail page has a &quot;From your talent bank&quot; panel
        showing past candidates ranked by skill overlap. Tick the ones you
        want to reach out to and hit <strong>Reach out (N)</strong> —
        sends a templated email + WhatsApp asking if they&apos;re available
        for this role.
      </p>
      <DocImage src="/docs/screenshots/jobs-detail.png" alt="Job detail page with talent bank matches" />
    </>
  );
}

export function Candidates() {
  return (
    <>
      <h1>Candidates pipeline</h1>
      <p className="lead">
        Every candidate row in the platform — whether from inbox triage,
        manual upload, or a talent-bank match — appears here once an
        application exists.
      </p>

      <h2>List view</h2>
      <p>
        Filter by job, stage, score range, or search by name / email /
        phone / skills. The search uses the same engine as the top-bar
        live search.
      </p>
      <DocImage src="/docs/screenshots/candidates.png" alt="Candidates list" />

      <h2>Stages</h2>
      <ol>
        <li>
          <strong>New</strong> — application just created.
        </li>
        <li>
          <strong>Classified</strong> — email auto-classified as candidate
          application.
        </li>
        <li>
          <strong>Matched</strong> — resume scored against the job.
        </li>
        <li>
          <strong>Interview link sent</strong> — link generated and emailed.
        </li>
        <li>
          <strong>Screening scheduled</strong> — candidate confirmed
          availability (via WhatsApp reply or HR action).
        </li>
        <li>
          <strong>Screened</strong> — interview completed.
        </li>
        <li>
          <strong>Shortlisted</strong> / <strong>Rejected</strong> — terminal.
        </li>
      </ol>

      <h2>Detail page actions</h2>
      <p>
        Click any row to open the application detail page. From here you
        can:
      </p>
      <ul>
        <li>Re-score the resume, override the fraud block</li>
        <li>Generate / resend the interview link</li>
        <li>Watch the interview recording &amp; transcript</li>
        <li>Submit HR scores (for hr_video jobs)</li>
        <li>Send WhatsApp / call the candidate from Twilio</li>
        <li>Generate an offer once the candidate is shortlisted</li>
        <li>Send rejection email</li>
      </ul>
      <DocImage src="/docs/screenshots/candidate-detail.png" alt="Candidate detail page" />
    </>
  );
}

export function TalentBank() {
  return (
    <>
      <h1>Talent Bank</h1>
      <p className="lead">
        Every CV the platform has ever seen, tagged with skills so future
        jobs can match against them without re-running the LLM.
      </p>
      <DocImage src="/docs/screenshots/talent-bank.png" alt="Talent bank list" />

      <h2>Adding candidates</h2>
      <ol>
        <li>
          <strong>Inbox triage</strong> — any email classified as a
          candidate application gets a candidate row.
        </li>
        <li>
          <strong>Bulk upload</strong> — top-right <K>Upload CV</K> button
          accepts multiple PDF / DOCX files at once. Skills + role are
          extracted via LLM.
        </li>
        <li>
          <strong>Forwarded emails</strong> — forward CVs to your connected
          inbox; the dedup engine creates a separate row per real person
          (matched on name + email/phone).
        </li>
      </ol>

      <h2>Click a card → drawer with everything</h2>
      <p>
        Clicking a candidate name opens a slide-over with their summary,
        skills, key points, CV history (every version uploaded), resume
        text, and edit/delete actions.
      </p>
      <DocImage src="/docs/screenshots/talent-bank-drawer.png" alt="Talent bank detail drawer" />

      <h2>Availability status</h2>
      <ul>
        <li>
          <strong>Available</strong> (default) — appears in match results.
        </li>
        <li>
          <strong>Joined elsewhere</strong> — auto-set when the WhatsApp
          bot detects &quot;I joined another company&quot;.
        </li>
        <li>
          <strong>Not available</strong> — auto-set on &quot;not looking
          right now&quot;-style replies.
        </li>
        <li>
          <strong>Hired elsewhere</strong> — manual flag for HR.
        </li>
      </ul>
      <p>
        Non-available candidates are dimmed in the list and{" "}
        <strong>excluded from match results</strong> so the same person
        isn&apos;t pinged twice.
      </p>
    </>
  );
}

export function Interviews() {
  return (
    <>
      <h1>Interviews</h1>
      <p className="lead">
        Every interview link generated for this tenant — from sent through
        completed — on one page so you can chase candidates who haven&apos;t
        joined yet.
      </p>
      <DocImage src="/docs/screenshots/interviews.png" alt="Interviews queue page" />

      <h2>Filter chips</h2>
      <p>
        Defaults to <em>Pending follow-up</em> which means anything in
        <em> generated / sent / send-failed / opened</em>. Switch to{" "}
        <em>Send failed</em> to see exactly which sends bounced (and why).
      </p>

      <h2>Per-row actions</h2>
      <ul>
        <li>
          <strong>Copy link</strong> — paste it into WhatsApp / Slack /
          wherever if email is unreachable.
        </li>
        <li>
          <strong>Resend</strong> — re-fire the same email via the tenant
          mailbox SMTP path.
        </li>
        <li>
          <strong>Retry</strong> (only for <em>send_failed</em>) — same as
          resend but flagged as a retry. Shows the underlying error if it
          fails again.
        </li>
      </ul>

      <h2>Auto-reschedule</h2>
      <Tip kind="success">
        If a candidate asks to reschedule mid-interview, the system detects
        the intent, generates a fresh link, and emails it automatically
        (up to 2 times per application). You&apos;ll see an{" "}
        <em>Interview auto-rescheduled</em> banner on the candidate detail
        page — no manual click needed.
      </Tip>
    </>
  );
}

export function Outreach() {
  return (
    <>
      <h1>Outreach & WhatsApp</h1>
      <p className="lead">
        Reach candidates over email + WhatsApp from inside the candidate
        timeline, then receive their replies in the same place.
      </p>

      <h2>Bulk reach-out from a job</h2>
      <p>
        On a job&apos;s detail page, the &quot;From your talent bank&quot;
        panel shows ranked matches. Tick a few, hit{" "}
        <strong>Reach out (N)</strong>, and the system sends an &quot;Are
        you available?&quot; email AND WhatsApp to each candidate. Twilio
        is optional — if it isn&apos;t set up, WhatsApp is silently
        skipped and only email goes out.
      </p>
      <DocImage src="/docs/screenshots/outreach.png" alt="Bulk reach-out from job detail" />

      <h2>WhatsApp inbound bot</h2>
      <p>When candidates reply on WhatsApp, the bot classifies the reply:</p>
      <ul>
        <li>
          <strong>&quot;Yes / sure / works for me&quot;</strong> →
          auto-generates a fresh interview link and replies with the URL on
          the same WhatsApp thread.
        </li>
        <li>
          <strong>&quot;I joined another company&quot;</strong> → marks the
          talent-bank status, replies with a friendly congrats note.
        </li>
        <li>
          <strong>&quot;Not interested / not looking&quot;</strong> →
          marks <em>not_available</em>, says we&apos;ll keep them in mind.
        </li>
        <li>
          <strong>Anything ambiguous</strong> (&quot;but next week
          works&quot; / &quot;what&apos;s the salary?&quot;) → logged but
          no auto-reply. You handle the nuance manually from the Inbox.
        </li>
      </ul>

      <h2>Configuring WhatsApp</h2>
      <p>
        You need a Twilio account with a WhatsApp sender approved. Add the
        credentials under <K>Settings → Integrations → Twilio</K>. Twilio&apos;s
        inbound webhook URL to configure on their side:
      </p>
      <pre className="not-prose bg-slate-100 rounded-md px-3 py-2 text-xs font-mono overflow-x-auto">
        https://hireops.symprio.com/api/v1/webhook/twilio/whatsapp
      </pre>
    </>
  );
}

export function Inbox() {
  return (
    <>
      <h1>Inbox triage</h1>
      <p className="lead">
        Every email arriving at your connected mailbox shows up here, sorted
        by AI classification.
      </p>
      <DocImage src="/docs/screenshots/inbox.png" alt="Inbox page" />

      <h2>Classification</h2>
      <p>
        The email classifier sorts each message into one of:
      </p>
      <ul>
        <li>
          <strong>Candidate application</strong> — has a CV attached or a
          structured intro. Auto-creates a candidate.
        </li>
        <li>
          <strong>Interview reply</strong> — candidate responding to an
          interview link or availability check.
        </li>
        <li>
          <strong>Outbound bounce / OOO</strong> — administrative noise.
        </li>
        <li>
          <strong>Other / spam</strong> — anything that doesn&apos;t look
          recruiting-related.
        </li>
      </ul>

      <Tip>
        Misclassified? Click into the email and use{" "}
        <strong>Re-classify</strong>. The corrected label is used as
        training-style feedback the next time we re-tune the classifier.
      </Tip>
    </>
  );
}

export function SettingsOverview() {
  return (
    <>
      <h1>Settings overview</h1>
      <p className="lead">
        The settings hub groups everything under one page so you don&apos;t
        have to hunt.
      </p>
      <DocImage src="/docs/screenshots/settings.png" alt="Settings hub" />

      <h2>Tile groupings</h2>
      <ul>
        <li>
          <strong>Organization Profile</strong> — company info that grounds
          AI features (industry, HQ, currency) + email branding (logo,
          colour, signature). See{" "}
          <Link href="/docs/organization">Organization &amp; branding</Link>.
        </li>
        <li>
          <strong>Team &amp; Roles</strong> — invite recruiters, assign
          owner / member, remove members.
        </li>
        <li>
          <strong>Email Templates</strong> — customise the 11 default
          templates (interview invite, offer letter, rejection, etc.) with
          live preview.
        </li>
        <li>
          <strong>Profile &amp; Notifications</strong> — your personal
          display name, password, and notification toggles.
        </li>
        <li>
          <strong>Calendar Integration</strong> — connect Google Calendar
          so interview slot suggestions skip your busy times.
        </li>
        <li>
          <strong>Billing &amp; Plan</strong> — upgrade, manage payment,
          check AI usage against the daily LLM budget.
        </li>
        <li>
          <strong>Email Integrations, HRIS, Job Boards, Twilio</strong> —
          connect external services.
        </li>
        <li>
          <strong>Pipeline Templates, Offer Templates</strong> — customise
          stages and offer document structure.
        </li>
      </ul>
    </>
  );
}

export function Organization() {
  return (
    <>
      <h1>Organization & branding</h1>
      <p className="lead">
        Two distinct things on the same page: company facts that ground AI
        prompts, and visual branding applied to every outbound email.
      </p>
      <DocImage src="/docs/screenshots/organization.png" alt="Organization profile + branding" />

      <h2>Company facts (top half)</h2>
      <p>Fields and where they show up:</p>
      <ul>
        <li>
          <strong>Industry, Headquarters</strong> — required to dismiss the
          onboarding banner. Used by the JD generator.
        </li>
        <li>
          <strong>Default work mode</strong> — remote / hybrid / onsite.
          AI-generated jobs use this to pick a default location.
        </li>
        <li>
          <strong>Default salary currency</strong> — pre-fills offer letters.
        </li>
        <li>
          <strong>About the company</strong> — one or two sentences. Woven
          into job descriptions and outreach copy.
        </li>
      </ul>

      <h2>Email branding (bottom half)</h2>
      <ul>
        <li>
          <strong>Logo URL</strong> — direct link to a PNG or SVG. Leave
          empty to render your company name in the email header.
        </li>
        <li>
          <strong>Primary colour</strong> — hex code for buttons + header
          stripe. Defaults to #6366f1 (indigo).
        </li>
        <li>
          <strong>From-name</strong> — display name on outbound emails.
          Defaults to your company name.
        </li>
        <li>
          <strong>Signature</strong> — plain text or basic HTML appended to
          every email body.
        </li>
      </ul>

      <Tip kind="info">
        Branding wraps around every template body automatically — you only
        need to set it once. Edit individual template wording on the{" "}
        <Link href="/docs/templates">Email templates</Link> page.
      </Tip>
    </>
  );
}

export function Templates() {
  return (
    <>
      <h1>Email templates</h1>
      <p className="lead">
        Customise the subject and HTML body of every email the platform
        sends. Each template has a list of variables you can drop into the
        body.
      </p>
      <DocImage src="/docs/screenshots/templates.png" alt="Email templates list" />

      <h2>Categories included by default</h2>
      <ul>
        <li>
          <strong>Interview invitation</strong> / <strong>reschedule</strong> /{" "}
          <strong>confirmation</strong> / <strong>reminder</strong>
        </li>
        <li>
          <strong>Availability check</strong> — talent-bank bulk reach-out
        </li>
        <li>
          <strong>Shortlist congrats</strong>
        </li>
        <li>
          <strong>Offer letter</strong> — full package table
        </li>
        <li>
          <strong>Offer accepted</strong> — internal note when candidate
          signs
        </li>
        <li>
          <strong>Rejection</strong>
        </li>
        <li>
          <strong>Generic email</strong> — blank canvas for ad-hoc sends
        </li>
        <li>
          <strong>In-app notification</strong> — short copy for the bell
          feed
        </li>
      </ul>

      <h2>Editor</h2>
      <p>
        Click a template to open the editor. Left side: subject + HTML
        body. Right side: variables sidebar (click a chip to insert into
        the body) + live preview with sample data.
      </p>
      <DocImage src="/docs/screenshots/templates-editor.png" alt="Template editor with live preview" />

      <Tip>
        Use <K>{"{candidate_first_name}"}</K> for casual,{" "}
        <K>{"{candidate_name}"}</K> for the full name. The system fills
        unknown tokens as literal text so you immediately see when a typo
        slipped in.
      </Tip>
    </>
  );
}

export function Team() {
  return (
    <>
      <h1>Team & roles</h1>
      <p className="lead">Invite teammates and decide what they can do.</p>
      <DocImage src="/docs/screenshots/team.png" alt="Team & roles page" />

      <h2>Roles</h2>
      <ul>
        <li>
          <strong>Owner</strong> — full access including billing, integrations,
          and team management. Can override fraud blocks, send offers, etc.
        </li>
        <li>
          <strong>Member</strong> — everyday recruiter access. Can manage
          candidates and run interviews, but can&apos;t change billing,
          invite teammates, or edit templates.
        </li>
      </ul>

      <h2>Inviting someone</h2>
      <ol>
        <li>Click <strong>Invite member</strong>.</li>
        <li>Enter their work email and pick a role.</li>
        <li>They get an email with a single-use link valid for 7 days.</li>
        <li>
          On accept, they set their own password and land on your dashboard
          immediately.
        </li>
      </ol>
    </>
  );
}

export function Calendar() {
  return (
    <>
      <h1>Calendar integration</h1>
      <p className="lead">
        Connect Google Calendar so interview slot suggestions skip times
        you&apos;re already booked.
      </p>
      <DocImage src="/docs/screenshots/calendar.png" alt="Calendar integration page" />

      <h2>Connecting</h2>
      <ol>
        <li>
          Go to <K>Settings → Calendar Integration</K>.
        </li>
        <li>Click <strong>Connect Google Calendar</strong>.</li>
        <li>
          Sign in with your Google account and grant access. We only
          request <K>calendar.readonly</K> — we can see when you&apos;re
          busy but cannot create or move events.
        </li>
      </ol>

      <Tip kind="warning">
        Each recruiter connects their own calendar. Two people on the same
        workspace each authorise independently — we don&apos;t share calendar
        access across the team.
      </Tip>

      <h2>How slot suggestions work</h2>
      <p>
        On any candidate detail page (pre-interview), a &quot;Suggested
        interview times&quot; card pulls 8 slots over the next 5 business
        days, filtered against your real busy intervals (with a 15-minute
        buffer on either side). Each row has a <strong>Copy</strong> button
        to paste the time into a message.
      </p>
    </>
  );
}

export function Billing() {
  return (
    <>
      <h1>Billing & plan</h1>
      <p className="lead">
        Three plans available — Free, Starter, Pro. Pricing depends on
        what your platform admin has configured.
      </p>
      <DocImage src="/docs/screenshots/billing.png" alt="Billing & plan page" />

      <h2>Plan tiers</h2>
      <ul>
        <li>
          <strong>Free</strong> — 5 active jobs, 25 candidates, inbox triage
          only. Designed for trial.
        </li>
        <li>
          <strong>Starter</strong> — 25 jobs, 250 candidates, full
          auto-pipeline (classify → score → match → tag) + custom interview
          questions.
        </li>
        <li>
          <strong>Pro</strong> — unlimited jobs / candidates / interviews
          plus voice screening (ElevenLabs), Q&amp;A rounds, team seats.
        </li>
      </ul>

      <h2>AI usage</h2>
      <p>
        Every plan has a daily AI budget. Hit the cap and AI-driven
        actions return a 429 until midnight UTC. Track today&apos;s spend
        and your monthly trend under <K>Settings → Your AI Usage</K>.
      </p>

      <Tip kind="info">
        Numbers shown on the AI Usage panel are <em>billable</em> cost —
        what you&apos;ll be charged. Raw provider cost stays private.
      </Tip>
    </>
  );
}


/** Slug → content component. Used by the dynamic /docs/[slug] route. */
export const SECTIONS: Record<string, () => React.ReactNode> = {
  "getting-started": GettingStarted,
  "dashboard": Dashboard,
  "jobs": Jobs,
  "candidates": Candidates,
  "talent-bank": TalentBank,
  "interviews": Interviews,
  "outreach": Outreach,
  "inbox": Inbox,
  "settings-overview": SettingsOverview,
  "organization": Organization,
  "templates": Templates,
  "team": Team,
  "calendar": Calendar,
  "billing": Billing,
};
