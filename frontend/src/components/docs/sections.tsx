"use client";

import { DocImage, K, Tip } from "./DocsLayout";
import Link from "next/link";

/**
 * One React component per docs slug. Each section is intentionally
 * verbose — HR reads these once to learn the surface, then comes back
 * for specific scenarios, so we cover every action / field / option.
 * Screenshots live at /docs/screenshots/{slug}.png.
 */

// ─── Getting started ─────────────────────────────────────────────────

export function GettingStarted() {
  return (
    <>
      <h1>Signing up &amp; first steps</h1>
      <p className="lead">
        Five-minute walk-through from a fresh signup to your first
        connected mailbox. The order matters — the platform expects an
        org profile + an inbox before AI features stop using placeholders.
      </p>

      <h2>1. Create your workspace</h2>
      <p>
        Visit <Link href="/signup">/signup</Link> and fill the four fields:
      </p>
      <ul>
        <li>
          <strong>Your name</strong> — appears on the candidate timeline as
          the recruiter who took an action.
        </li>
        <li>
          <strong>Company name</strong> — becomes the workspace name shown
          to your team, in email headers, and in the AI&apos;s knowledge of
          who you are.
        </li>
        <li>
          <strong>Work email</strong> — must accept incoming mail for the
          verification step. The platform rejects disposable / .test
          domains with a friendly &quot;please use a real email
          domain&quot; message.
        </li>
        <li>
          <strong>Password</strong> — at least 8 characters.
        </li>
      </ul>
      <DocImage src="/docs/screenshots/signup.png" alt="Signup form" />

      <p>
        After you submit, we send a verification email and show a
        &quot;Check your inbox&quot; screen. Click the link in the email →
        you land back in the app, fully signed in.
      </p>

      <Tip kind="info">
        Lost the verification email? Click <strong>Resend verification
        email</strong> on the same screen, or use the <strong>Need help?</strong>{" "}
        link in the top-right which works even before you&apos;re fully
        signed in.
      </Tip>

      <h2>2. Complete your organization profile</h2>
      <p>
        First-time signups are routed to <K>/onboarding</K> before the
        dashboard. The form takes about 90 seconds:
      </p>
      <DocImage
        src="/docs/screenshots/onboarding.png"
        alt="Organization onboarding form"
      />
      <p>
        <strong>Required</strong> (the persistent banner stays until these
        are filled):
      </p>
      <ul>
        <li>
          <strong>Industry</strong> — pick the closest match from the
          dropdown. Used by the JD generator to ground prompts.
        </li>
        <li>
          <strong>Headquarters</strong> — &quot;Kuala Lumpur, Malaysia&quot;
          style. Becomes the default location on AI-generated jobs.
        </li>
      </ul>
      <p><strong>Strongly recommended:</strong></p>
      <ul>
        <li><strong>Company size</strong> — employee bands. Hints to the AI at tone (startup vs enterprise).</li>
        <li><strong>Default work mode</strong> — Remote / Hybrid / Onsite.</li>
        <li><strong>Default salary currency</strong> — pre-fills offer letters.</li>
        <li><strong>Website</strong> — included in outreach copy.</li>
        <li><strong>About the company</strong> — 1-2 sentences woven into JDs.</li>
      </ul>
      <p>
        You can <strong>Skip for now</strong> and complete later under{" "}
        <K>Settings → Organization Profile</K>. The indigo banner persists
        on every dashboard page until you do.
      </p>

      <h2>3. Connect your inbox</h2>
      <p>
        Inbox connection turns the platform from a static CRM into an
        auto-triaging recruiter. Go to <K>Settings → Email Integrations</K>:
      </p>
      <DocImage src="/docs/screenshots/email-integrations.png" alt="Email integrations page" />
      <p>
        Pick your provider. All of them need an{" "}
        <strong>app password</strong> (NOT your main account password):
      </p>
      <ul>
        <li>
          <strong>Gmail / Google Workspace</strong> → Google Account →
          Security → 2-Step Verification → App passwords → generate one
          for &quot;Mail&quot;. 16 chars.
        </li>
        <li>
          <strong>Outlook / M365</strong> → admin or personal: App
          passwords (2FA must be enabled first).
        </li>
        <li>
          <strong>Yahoo Mail</strong> → Account Security → Generate app
          password.
        </li>
        <li>
          <strong>iCloud</strong> → appleid.apple.com → Sign-In and
          Security → App-Specific Passwords.
        </li>
      </ul>
      <p>
        Once connected, the IMAP listener polls every 20 seconds. New
        mail is pulled, classified, and (if it&apos;s a candidate
        application) becomes a Candidate row + Application against any
        matching open job.
      </p>

      <Tip kind="warning">
        Outbound email also goes through this same mailbox via SMTP. If
        the candidate never receives the interview email, the first thing
        to check is whether your provider&apos;s app password permits
        SMTP — most do automatically.
      </Tip>

      <h2>4. What you do next</h2>
      <ul>
        <li>
          <strong>Existing CV library</strong> → upload all of it via{" "}
          <Link href="/docs/talent-bank">Talent Bank</Link> first.
        </li>
        <li>
          <strong>Starting from scratch</strong> → create your first job
          (see <Link href="/docs/jobs">Creating &amp; managing jobs</Link>)
          and let inbox triage funnel applications in.
        </li>
        <li>
          <strong>Hiring through a job board</strong> → see{" "}
          <Link href="/docs/job-boards">Job Boards</Link>.
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
        The home screen surfaces the numbers HR checks at the start of
        every day plus a timeline of recent pipeline activity.
      </p>
      <DocImage src="/docs/screenshots/dashboard.png" alt="Dashboard" />

      <h2>Quick actions (top of page)</h2>
      <p>
        Three shortcut tiles sit directly under the header — the most
        common starting points for a recruiter&apos;s day:
      </p>
      <ul>
        <li>
          <strong>Sync inbox</strong> — jumps to the inbox page where the
          IMAP listener&apos;s last sync time and any unprocessed
          messages are visible.
        </li>
        <li>
          <strong>Create job</strong> — opens the job-creation form,
          including the &quot;already have a JD?&quot; paste/upload AI
          refiner.
        </li>
        <li>
          <strong>View candidates</strong> — list of every candidate in
          the pipeline (not just talent bank).
        </li>
      </ul>

      <h2>Onboarding checklist</h2>
      <p>
        Fresh tenants see a 6-step checklist under Quick actions: org
        profile, inbox connection, first job, first candidate, Twilio
        (optional), teammate invite. The card auto-hides once every
        step is done; the ✕ in the corner dismisses it manually
        (re-appears if any step regresses on next reload).
      </p>

      <h2>AI spend widget</h2>
      <p>
        Sits in the Row 1.5 area alongside the hiring forecast. Shows
        month-to-date billable cost (raw provider cost × plan markup),
        a 30-day sparkline, and today&apos;s number. &quot;Detailed
        report →&quot; opens Settings → Billing for the full breakdown.
      </p>

      <h2>Top stat tiles</h2>
      <ul>
        <li>
          <strong>Open jobs</strong> — count of jobs whose status is{" "}
          <em>open</em>. Clickable: takes you to the Jobs list filtered to
          open.
        </li>
        <li>
          <strong>Candidates in pipeline</strong> — applications NOT in{" "}
          <em>shortlisted</em> or <em>rejected</em>. The number you need
          to work through.
        </li>
        <li>
          <strong>Interviews this week</strong> — interview links
          generated in the last 7 days.
        </li>
        <li>
          <strong>Shortlisted</strong> — candidates marked shortlisted in
          the last 30 days.
        </li>
      </ul>

      <h2>Recent activity timeline</h2>
      <p>
        Mid-page shows the last 20 events from across the tenant. Each
        row deep-links to the candidate detail page:
      </p>
      <ul>
        <li><strong>candidate_matched</strong> — resume scored against a job</li>
        <li><strong>interview_link_generated / _emailed</strong></li>
        <li><strong>interview_started / _completed</strong></li>
        <li><strong>webhook_transcript_received</strong> — ElevenLabs delivered</li>
        <li><strong>interview_reschedule_requested / _auto_rescheduled</strong></li>
        <li><strong>candidate_shortlisted / _rejected</strong></li>
      </ul>

      <Tip kind="info">
        The bell icon in the top bar shows the same activity feed but
        stays accessible from any page. Anything older than 14 days drops
        out of the bell so the list stays actionable.
      </Tip>

      <h2>Sidebar nav (always visible)</h2>
      <p>
        Top to bottom: Dashboard, Inbox, Jobs, Candidates, Talent Bank,
        Call Queue, Interviews, Outreach, Reports, Docs, Settings.
        Bottom-left chevron collapses to icon-only. Mobile: hamburger
        opens it as an overlay.
      </p>
      <p>
        Items that depend on a plan-gated feature show a small 🔒 when
        the agent isn&apos;t enabled on your plan (Call Queue,
        Interviews, Outreach, Reports). The link still works — the page
        explains what&apos;s missing with a one-click Contact us button.
      </p>
    </>
  );
}

export function SearchAndNotifications() {
  return (
    <>
      <h1>Top-bar search &amp; bell</h1>
      <p className="lead">
        Two utilities pinned to the top of every page so you don&apos;t
        lose context as you navigate.
      </p>

      <h2>Command palette (⌘K / Ctrl-K)</h2>
      <p>
        Hit <K>⌘K</K> (or <K>Ctrl-K</K> on Windows / Linux) anywhere in
        the dashboard to open the command palette. Three sections,
        keyboard-only:
      </p>
      <ul>
        <li>
          <strong>Candidates</strong> — live search by name / email,
          top 5 matches.
        </li>
        <li>
          <strong>Navigate</strong> — every dashboard route (Dashboard,
          Inbox, Jobs, Talent Bank, etc.).
        </li>
        <li>
          <strong>Actions</strong> — Create job, Sync inbox, Upload CV,
          Edit email templates, Billing &amp; usage.
        </li>
      </ul>
      <p>
        <K>↑</K> / <K>↓</K> to move, <K>↵</K> to select, <K>Esc</K> to
        close. The same palette opens on mobile via the magnifying-glass
        icon in the top bar (the desktop input is hidden below md).
      </p>

      <h2>Live candidate search</h2>
      <p>
        On desktop the top bar also has a dedicated search input. Type
        two or more characters and a dropdown of the top 8 matches
        appears. The query is matched against:
      </p>
      <ul>
        <li>Full name</li>
        <li>Email (substring)</li>
        <li>
          Phone (digits only — &quot;+60 176 490 285&quot; finds rows stored as
          &quot;0176490285&quot;)
        </li>
        <li>Profile role (&quot;RPA developer&quot;)</li>
        <li>Profile summary (LLM-extracted, 1-2 sentences per candidate)</li>
        <li>Profile skills (JSON substring — &quot;kubernetes&quot;, &quot;tableau&quot;)</li>
      </ul>
      <p>
        Each result row links straight to the candidate&apos;s detail
        page (or, for talent-bank-only candidates, opens the talent-bank
        filtered to that name). Press <K>Enter</K> without picking to get
        the full-page list view.
      </p>

      <h2>Notification bell (real-time)</h2>
      <p>
        Click the bell to open a dropdown of the last 20 actionable
        events for this tenant. The feed is <strong>live</strong> — a
        Server-Sent Events stream at <code>/notifications/stream</code>
        pushes new events without a page refresh. Two sources merged
        into one feed:
      </p>
      <ul>
        <li>
          <strong>Pipeline events</strong> — interview link sent / opened
          / completed, reschedule requests, matches, shortlists,
          rejections.
        </li>
        <li>
          <strong>Inbound WhatsApp replies</strong> — surfaced even when
          no event row was logged, so HR sees candidate messages
          alongside system events.
        </li>
      </ul>
      <p>
        Each row clicks through to the relevant candidate / inbox. The
        unread dot turns off when you open the dropdown — read state
        lives in localStorage so it survives reloads without a server
        write. Bell polls every 60 seconds in the background.
      </p>

      <Tip>
        Open the bell once a morning and once an afternoon and you&apos;ll
        catch every candidate who needs a follow-up.
      </Tip>
    </>
  );
}

// ─── Recruiting ──────────────────────────────────────────────────────

export function Jobs() {
  return (
    <>
      <h1>Creating &amp; managing jobs</h1>
      <p className="lead">
        A job ties everything together — the JD, the interview mode, the
        question bank, the pipeline, and (eventually) the offer letter
        boilerplate. End-to-end creation: about three minutes.
      </p>

      <h2>The list view</h2>
      <p>
        <K>/jobs</K> shows every job for this tenant grouped by status.
        Click any row for the detail page. Filters across the top:
      </p>
      <ul>
        <li><strong>Status</strong> — Open / Paused / Closed.</li>
        <li><strong>Department</strong> — derived from the job&apos;s department field.</li>
        <li><strong>Search</strong> — title / job code / description fuzzy match.</li>
      </ul>

      <h2>Creating a new job</h2>
      <p>
        Hit <K>+ New Job</K> top-right. The form is split into sections:
      </p>
      <DocImage src="/docs/screenshots/jobs-new.png" alt="New job form" />

      <h3>Basic info</h3>
      <ul>
        <li>
          <strong>Title</strong> — only required field. Fill just this
          and hit <strong>Generate with AI</strong> to auto-fill
          everything else.
        </li>
        <li><strong>Department</strong> — auto-selected by the AI; categorises for filtering.</li>
        <li>
          <strong>Location</strong> — derived from your org HQ + work
          mode. Override per job if needed.
        </li>
        <li>
          <strong>Seniority</strong> — Junior / Mid / Senior / Lead.
          Drives question difficulty.
        </li>
      </ul>

      <h3>Already have a JD? Paste or upload it</h3>
      <p>
        If a hiring manager dropped a Word doc or pasted a long
        description in Slack, you don&apos;t need to retype anything.
        The new-job form has a collapsible <strong>&quot;Already have
        a JD?&quot;</strong> panel:
      </p>
      <ul>
        <li>
          <strong>Paste</strong> — drop the raw text into the textarea.
          Hit <strong>Refine with AI</strong> and we&apos;ll structure
          it into title, summary, responsibilities, skills,
          qualifications. The form fields populate; you can still edit.
        </li>
        <li>
          <strong>Upload</strong> — attach a <K>.pdf</K> / <K>.docx</K> /{" "}
          <K>.txt</K> file. We extract the text server-side and feed it
          through the same refiner. 15 MB cap.
        </li>
      </ul>
      <Tip>
        Refining doesn&apos;t commit anything — it just pre-fills the
        form. You still need to click <strong>Save</strong>. Run refine
        multiple times if the first pass missed nuance.
      </Tip>

      <h3>Editing an existing JD</h3>
      <p>
        On <K>/jobs/{"{id}"}/edit</K> the same paste/upload affordance is
        available, plus a <strong>✨ Polish current draft</strong>{" "}
        button. Polish reads whatever&apos;s already in the form, asks the
        LLM to tighten the language, expand bullet lists, and normalise
        capitalisation — without inventing requirements that
        weren&apos;t in your source text. You can also click any
        bullet in responsibilities/qualifications to inline-edit it.
      </p>

      <h3>Interview mode</h3>
      <p>
        Pick one — the candidate&apos;s interview page renders entirely
        differently based on this choice:
      </p>
      <ul>
        <li>
          <strong>AI Voice Interview</strong> (default) — ElevenLabs
          conversational agent. 8-10 minute call with face tracking.
          Transcript + recording delivered via webhook. Auto-evaluated
          unless the candidate asks to reschedule.
        </li>
        <li>
          <strong>Written Q&amp;A</strong> — three rounds: aptitude,
          reasoning, CV-based technical. Each round LLM-generated and
          LLM-scored. No microphone needed.
        </li>
        <li>
          <strong>HR Video Interview</strong> — recruiter joins the
          candidate in an in-platform Jitsi room. Score manually after
          the call via the form on the candidate detail page.
        </li>
      </ul>

      <h3>Auto-generate interview questions</h3>
      <p>
        Dial how many questions of each type to pre-fill on the new job:
      </p>
      <ul>
        <li><strong>Behavioural</strong> — past experience, teamwork, conflict.</li>
        <li><strong>Technical</strong> — tools, languages, problem-solving.</li>
        <li><strong>Situational</strong> — &quot;how would you handle…&quot;.</li>
        <li><strong>Culture fit</strong> — values, work style, motivation.</li>
      </ul>
      <p>
        Defaults to 3+3+2+0 = 8 questions. Hard cap of 20 per job. Each
        type is generated with its own LLM call so the variety is
        genuine. After save, the questions are pre-filled on the
        job&apos;s Interview Questions tab — edit, reorder, or delete any.
      </p>

      <h3>Skills / responsibilities / qualifications</h3>
      <p>
        Free-text comma-separated lists. The AI generator fills these
        intelligently; you can tighten or expand each one. They feed into
        the resume scorer — adding &quot;Kubernetes&quot; means K8s
        candidates score higher.
      </p>

      <h3>Threshold sliders (advanced)</h3>
      <ul>
        <li>
          <strong>Resume score min</strong> (default 80) — under this and
          the auto-pipeline rejects without sending an interview link.
        </li>
        <li>
          <strong>Interview score min</strong> (default 75) — under this
          and the candidate stays at &quot;screened&quot; instead of
          auto-shortlisting.
        </li>
        <li>
          <strong>Final reject below</strong> (default 50) — final score
          under this auto-moves to rejected stage.
        </li>
      </ul>

      <h2>The detail page</h2>
      <DocImage src="/docs/screenshots/jobs-detail.png" alt="Job detail" />
      <p>Four sections on <K>/jobs/{"{id}"}</K>:</p>
      <ol>
        <li>
          <strong>Job header</strong> — title, code, status pill, expiry
          date, edit/duplicate/close in the top-right kebab.
        </li>
        <li>
          <strong>From your talent bank</strong> — past candidates
          ranked by skill overlap with the JD. Two controls at the top
          of the list let you tune what shows up:
          <ul>
            <li>
              <strong>Min match</strong> slider (0-100, default 35) —
              hides anyone below the bar. We deliberately default low so
              you don&apos;t miss adjacent talent; ratchet up if the list
              is too noisy.
            </li>
            <li>
              <strong>Min skill overlap</strong> chip (1+ / 2+ / 3+,
              default 2+) — minimum number of JD skills that have to
              appear on the CV.
            </li>
          </ul>
          Both settings persist per browser (localStorage). When no
          candidates clear the threshold we automatically retry with
          overlap=1 and surface a &quot;weak matches&quot; chip so the
          list isn&apos;t empty. Tick a few rows and click{" "}
          <strong>Reach out (N)</strong> for bulk WhatsApp + email
          availability check.
        </li>
        <li>
          <strong>Applications</strong> — every candidate who applied to
          this job, with current stage and scores. Filter by stage.
        </li>
        <li>
          <strong>Interview Questions</strong> — the per-job bank. Add,
          edit, reorder, delete. Mark required vs optional. Weight per
          question (1-5) feeds the LLM scorer.
        </li>
      </ol>

      <h2>Closing a job</h2>
      <p>
        Top-right kebab → <strong>Close job</strong>. Sets status to
        closed and stops auto-pipeline actions. Existing applications
        stay intact; you can still move them forward manually. Reopen
        anytime.
      </p>
      <Tip kind="warning">
        Closing is reversible. Deletion is not — there&apos;s no delete
        button. If you need to genuinely remove a job, contact support.
      </Tip>
    </>
  );
}

export function Candidates() {
  return (
    <>
      <h1>Candidates pipeline</h1>
      <p className="lead">
        Every candidate row in the system — whether from inbox triage,
        manual upload, or a talent-bank match — appears in <K>/candidates</K>{" "}
        once an application exists. The list view is for triage; the
        detail page is where you act.
      </p>

      <h2>The list</h2>
      <DocImage src="/docs/screenshots/candidates.png" alt="Candidates list" />
      <p>Filter bar:</p>
      <ul>
        <li><strong>Job</strong> — narrow to applications against one role.</li>
        <li><strong>Stage</strong> — every stage from new to shortlisted to rejected.</li>
        <li><strong>Score range</strong> — Min/Max on resume score.</li>
        <li>
          <strong>Search</strong> — name / email / phone / role / skills,
          same engine as the global search.
        </li>
      </ul>

      <h2>Missing fields, not fake fields</h2>
      <p>
        When a CV came in without a clear email, phone, or name we now
        flag the row instead of fabricating placeholders like{" "}
        <K>candidate@uploaded.local</K>. Aggregated missing fields
        surface as amber chips on the row and in the detail header.
        Outreach buttons that require the missing value (Send email,
        Send WhatsApp) auto-disable with a tooltip explaining why. Fix
        by inline-editing the contact block, or hit{" "}
        <strong>Re-extract</strong> on the CV history block to run the
        LLM profile extractor again — most missed fields are recovered
        on the second pass.
      </p>

      <h2>If the URL points to a candidate with no application</h2>
      <p>
        Older links and bookmarks may target a candidate that no longer
        has an active application. The detail page now falls back to a
        candidate-only view (CV history, profile, notes, edit) instead
        of throwing &quot;Application not found.&quot; You can still
        create a new application from the action column.
      </p>

      <h2>Job descriptions uploaded by mistake</h2>
      <p>
        We detect when an uploaded file is really a job description
        (Responsibilities/Qualifications/Salary/Apply Now patterns) and
        reject it at the upload boundary rather than letting it land in
        the talent bank as a candidate. The error message tells you
        what was detected and where to upload JDs instead.
      </p>

      <h2>Pipeline stages</h2>
      <ol>
        <li><strong>New</strong> — application created. Resume not yet scored.</li>
        <li><strong>Classified</strong> — email classifier confirmed this is a candidate application.</li>
        <li><strong>Matched</strong> — resume scored against the job. Has a resume_score (0-100) and ai_snippets.</li>
        <li><strong>Interview link sent</strong> — link generated and emailed.</li>
        <li><strong>Screening scheduled</strong> — candidate booked a slot.</li>
        <li><strong>Screened</strong> — interview completed. Has an interview_score and recommendation.</li>
        <li><strong>Shortlisted</strong> — terminal positive. Unlocks Generate offer.</li>
        <li><strong>Rejected</strong> — terminal negative. Sends rejection email if configured.</li>
      </ol>
      <p>
        Special stage <strong>reschedule_requested</strong> sits between
        Interview link sent and Screened — auto-rescheduler creates a
        fresh link and parks the application here.
      </p>

      <h2>The detail page</h2>
      <DocImage src="/docs/screenshots/candidate-detail.png" alt="Candidate detail" />
      <p>
        Three-column layout. Top header: name + email + phone + tags +
        stage pill.
      </p>

      <h3>Centre — scores &amp; signals</h3>
      <ul>
        <li>
          <strong>Score gauges</strong> — Resume / Interview / Final, with
          their pass thresholds. Red / amber / green based on threshold.
        </li>
        <li>
          <strong>Hiring report</strong> — LLM-generated executive summary
          with hire / hold / reject recommendation and confidence %.
          Generated on demand the first time you scroll.
        </li>
        <li>
          <strong>AI Insights</strong> — Why shortlisted, Key strengths,
          Main gaps, Interview focus.
        </li>
        <li>
          <strong>Resume Score</strong> — evidence + gaps + risks +
          screening questions + summary. Has a Re-score button for a
          fresh pass.
        </li>
        <li>
          <strong>Interview Score</strong> — score + decision + strengths
          + concerns + ratings + summary + email draft.
        </li>
        <li>
          <strong>Interview Recording</strong> — HTML5 audio player
          streaming from ElevenLabs.
        </li>
        <li>
          <strong>Transcript</strong> — collapsible, with timestamps.
        </li>
        <li>
          <strong>Reschedule banners</strong> — emerald (auto-rescheduled),
          amber (auto-send failed), rose (cap reached).
        </li>
        <li>
          <strong>Fraud Highlights</strong> — when the resume tripped
          adversarial-content detection, page-by-page render with
          coloured rectangles on every flagged region. Owner-only
          Override and score button.
        </li>
      </ul>

      <h3>Right column — actions</h3>
      <ul>
        <li><strong>Stage selector</strong> — drag the application to any stage.</li>
        <li>
          <strong>Send interview link</strong> — generates link + fires
          the interview_invite template through your SMTP.
        </li>
        <li>
          <strong>Send WhatsApp</strong> — when Twilio is configured and
          the candidate has a phone.
        </li>
        <li>
          <strong>Phone queue</strong> — schedule an outbound call. See{" "}
          <Link href="/docs/calls">Call Queue</Link>.
        </li>
        <li>
          <strong>Offer card</strong> — disabled until stage = shortlisted.
        </li>
        <li><strong>Send rejection email</strong> — uses the rejection template.</li>
        <li>
          <strong>CV History</strong> — every version uploaded, with
          source label.
        </li>
      </ul>
    </>
  );
}

export function TalentBank() {
  return (
    <>
      <h1>Talent Bank</h1>
      <p className="lead">
        Every CV the platform has ever seen, regardless of whether
        they&apos;re currently applying. The match engine surfaces them
        when you create new jobs — your past pipeline becomes a free
        recruiting channel for every future role.
      </p>
      <DocImage src="/docs/screenshots/talent-bank.png" alt="Talent bank list" />

      <h2>Ways candidates get here</h2>
      <ol>
        <li>
          <strong>Inbox triage</strong> — any email auto-classified as a
          candidate application becomes a row, with the CV parsed and
          profile_skills / profile_role / profile_seniority extracted.
        </li>
        <li>
          <strong>Bulk upload</strong> — top-right <K>Upload CV</K> opens
          a drag-and-drop dialog. Drop 100 PDFs at once; each is parsed
          inline and tagged before the dialog closes.
        </li>
        <li>
          <strong>Forwarded emails</strong> — forward candidate emails to
          your inbox. The dedup engine recognises real people (name +
          email or phone match) and creates a separate row per
          individual.
        </li>
        <li>
          <strong>Manual entry</strong> — <strong>Add candidate</strong>{" "}
          on <K>/candidates</K> for pasting from elsewhere.
        </li>
      </ol>

      <h2>List filters</h2>
      <ul>
        <li><strong>Search</strong> — same engine as the global search.</li>
        <li>
          <strong>Unassigned only</strong> — candidates without any
          application. The pure talent bank.
        </li>
        <li>
          <strong>Tags</strong> — your custom HR tags (cold / warm / hot,
          domain expertise, geographic preferences).
        </li>
      </ul>

      <h2>Views &amp; pagination</h2>
      <p>
        Top-right of the list:
      </p>
      <ul>
        <li>
          <strong>View toggle</strong> — switch between dense{" "}
          <strong>list</strong> rows (default, table-style) and{" "}
          <strong>tiles</strong> (card grid with avatar + skill chips).
          Tiles are nicer for skimming when you have a few hundred
          candidates; list is better for power triage.
        </li>
        <li>
          <strong>Page size</strong> — 25 / 50 / 100 per page. The
          server-side cursor paginates so even 10k-row tenants render
          instantly. Your last view + page size choice persist per
          browser.
        </li>
      </ul>

      <h2>Missing-field flags</h2>
      <p>
        When a CV came in without a clear email, phone, or name, we
        flag the row with an amber chip instead of inventing a
        placeholder. Examples:
      </p>
      <ul>
        <li><strong>Email missing</strong> — outreach via email disabled until you add one.</li>
        <li><strong>Phone missing</strong> — WhatsApp/SMS outreach disabled.</li>
        <li><strong>Name missing</strong> — usually means the resume was image-only or very unusual; re-extraction often fixes it.</li>
      </ul>
      <p>
        Click the row → drawer → pencil-edit the field directly. Or
        click <strong>Re-extract</strong> in the CV history block to run
        the LLM profile extractor again — useful for resumes that
        previously failed parsing.
      </p>

      <h2>CV download &amp; view</h2>
      <p>
        On every row and in the drawer:
      </p>
      <ul>
        <li>
          <strong>Download CV</strong> — original PDF/DOCX exactly as
          uploaded. Persisted per-tenant on disk (max 10 versions
          retained per candidate; older ones are pruned). Every
          download is audit-logged with the user, candidate, and
          timestamp.
        </li>
        <li>
          <strong>View resume text</strong> — opens a modal with the
          extracted plain text, scrollable. Use this to spot-check
          parser output before believing the profile fields.
        </li>
        <li>
          <strong>Re-extract</strong> — visible when extraction failed
          (empty skills / role). Runs the LLM profile extractor and
          contact parser fresh.
        </li>
      </ul>

      <h2>The detail drawer</h2>
      <DocImage src="/docs/screenshots/talent-bank-drawer.png" alt="Candidate drawer" />
      <p>Clicking any candidate&apos;s name opens a right-side slide-over:</p>
      <ul>
        <li><strong>Contact</strong> — name + email + phone, inline edit via pencil.</li>
        <li><strong>Summary</strong> — LLM-generated 1-2 sentence pitch.</li>
        <li><strong>Skills</strong> — power the match engine.</li>
        <li><strong>Highlights</strong> — bullet points the LLM thought notable.</li>
        <li><strong>CV history</strong> — every version with source label.</li>
        <li><strong>Resume text</strong> — first 8k characters, scrollable.</li>
        <li>
          <strong>Availability</strong> — Available / Joined elsewhere /
          Not available / Hired elsewhere.
        </li>
        <li><strong>Notes</strong> — free-form recruiter notes.</li>
        <li>
          <strong>Footer</strong> — Delete candidate (refuses if
          applications attached), Open application (when one exists).
        </li>
      </ul>

      <h2>Availability flags</h2>
      <Tip kind="info">
        The WhatsApp inbound bot auto-sets these when a candidate replies
        to a reach-out. &quot;I joined another company&quot; → Joined
        elsewhere. &quot;Not looking right now&quot; → Not available.
      </Tip>
      <p>
        Non-available candidates are <strong>dimmed</strong> in the list
        and <strong>excluded from match results</strong>. Not deleted —
        HR can still browse them and re-engage manually.
      </p>

      <h2>Smart dedup</h2>
      <p>
        When the same CV comes in twice, the platform versions it onto
        the existing candidate (cv_version bumps) only when{" "}
        <strong>name + (email OR phone)</strong> match. Three different
        candidates&apos; CVs forwarded to your own inbox create three
        separate rows even though they share your email as sender.
      </p>
    </>
  );
}

export function Interviews() {
  return (
    <>
      <h1>Interviews</h1>
      <p className="lead">
        Every interview link generated for this tenant, in one queue,
        with the actions you need most: copy link, resend, retry failed
        sends.
      </p>
      <DocImage src="/docs/screenshots/interviews.png" alt="Interviews queue" />

      <h2>Filter chips</h2>
      <ul>
        <li><strong>All</strong> — every link including completed and expired.</li>
        <li>
          <strong>Pending follow-up</strong> (default) — links in
          generated / sent / send_failed / opened. The ones to chase.
        </li>
        <li><strong>Sent</strong> — email delivered, candidate hasn&apos;t opened yet.</li>
        <li>
          <strong>Send failed</strong> — email bounced. Check the
          underlying error.
        </li>
        <li><strong>Opened</strong> — link clicked, interview not started.</li>
        <li><strong>In progress</strong> — interview started, no transcript yet.</li>
        <li><strong>Completed</strong> — transcript + score generated.</li>
        <li>
          <strong>Expired</strong> — 72-hour window passed without a
          completed interview.
        </li>
      </ul>

      <h2>Per-row actions</h2>
      <ul>
        <li>
          <strong>Copy link</strong> — pastes URL to clipboard. Use when
          the candidate confirms via a non-auto channel.
        </li>
        <li>
          <strong>Resend</strong> — re-fires the interview_invite email
          through your tenant SMTP.
        </li>
        <li>
          <strong>Retry</strong> — only shown for send_failed rows.
          Identical mechanics, honest UI.
        </li>
      </ul>

      <h2>Three modes recap</h2>
      <p>The mode is set on the JOB, not the interview link:</p>
      <ul>
        <li>
          <strong>AI Voice</strong> — ElevenLabs runs the interview. Face
          tracking, transcript via webhook, auto-evaluation. Reschedule
          intent detected automatically.
        </li>
        <li>
          <strong>Written Q&amp;A</strong> — three LLM-generated rounds.
          LLM-graded per round.
        </li>
        <li>
          <strong>HR Video</strong> — Jitsi room. Both candidate and
          recruiter land in the same room. HR scores manually.
        </li>
      </ul>

      <h2>Auto-reschedule</h2>
      <Tip kind="success">
        When the AI voice screen detects a candidate asking to do this
        later (early in the call), the system skips evaluation, generates
        a fresh link, and emails it — up to 2 times per application. The
        3rd reschedule escalates to HR via a rose banner on the candidate
        page.
      </Tip>

      <h2>Candidate experience (AI Voice)</h2>
      <p>
        The interview page itself ships with a number of trust-and-fraud
        features that you should know about, because candidates ask:
      </p>
      <ul>
        <li>
          <strong>Mic pre-flight</strong> — before connecting, we show a
          live mic-level meter. Candidates can speak into their mic and
          see a green bar move; if it doesn&apos;t, they fix the device
          or grant permission. Eliminates the &quot;the AI didn&apos;t
          hear me&quot; class of bug.
        </li>
        <li>
          <strong>Auto-reconnect</strong> — if the WebSocket to
          ElevenLabs drops mid-interview, we transparently retry up to 3
          times with exponential backoff. An overlay tells the candidate
          we&apos;re reconnecting; the session resumes without losing
          context.
        </li>
        <li>
          <strong>Recording banner</strong> — a pulsing red &quot;
          Recording — please don&apos;t refresh&quot; bar sits at the
          top during the call. Plus a <K>beforeunload</K> &quot;Are you
          sure?&quot; prompt to stop accidental tab closes.
        </li>
        <li>
          <strong>End-of-call summary</strong> — instead of dropping
          candidates onto a blank thank-you, they see a 3-step
          &quot;what happens next&quot; explanation: we&apos;re scoring
          the interview, you&apos;ll hear back via email, here&apos;s
          our HR contact if you need it.
        </li>
        <li>
          <strong>Mobile responsive</strong> — the page collapses to a
          single column on phones. All buttons and the mic meter are
          tap-sized; padding adjusts at sm: breakpoints. Candidates can
          legitimately interview from their phone.
        </li>
      </ul>

      <h2>Fraud signals (AI Voice)</h2>
      <p>
        Throughout the interview the candidate&apos;s camera (with their
        consent) feeds MediaPipe FaceDetector. We log:
      </p>
      <ul>
        <li>
          <strong>Focus loss</strong> — tab switches away from the
          interview window.
        </li>
        <li>
          <strong>Paste detection</strong> — any paste event inside the
          page.
        </li>
        <li>
          <strong>Face absence</strong> — % of snapshots with no face
          detected.
        </li>
        <li>
          <strong>Average attention</strong> — derived from gaze /
          face-pose stability over the call.
        </li>
        <li>
          <strong>Multi-face detection</strong> <em>(heaviest signal)</em>{" "}
          — if a second person appears in frame, we count snapshots and
          % of the call duration with &gt;1 face. A multi-face warning
          banner pops up live on the candidate&apos;s screen (&quot;Only
          one person should be on camera&quot;). Heavily weighted in the
          fraud risk score on the candidate detail page.
        </li>
      </ul>
      <p>
        All of these roll up into the <strong>fraud risk %</strong> on
        the Interview Score panel. Owner accounts can override the
        score if context warrants (paste was a calculator, second face
        was a toddler walking past, etc.).
      </p>

      <h2>When sending fails</h2>
      <ul>
        <li>
          <strong>SMTP auth rejected</strong> → app password may need
          regenerating (Google rotates them when you change account
          password). Re-paste under <K>Settings → Email Integrations</K>.
        </li>
        <li>
          <strong>No connected mailbox</strong> → connect one. No default
          sender fallback.
        </li>
        <li>
          <strong>Candidate mailbox bounces</strong> → typo in their
          address. Edit on the candidate detail page and resend.
        </li>
      </ul>
    </>
  );
}

export function Calls() {
  return (
    <>
      <h1>Call Queue</h1>
      <p className="lead">
        Outbound calls via Twilio. Used for &quot;quick sync&quot;
        touchpoints that don&apos;t warrant a full interview — checking
        interest, asking a clarifying question, scheduling.
      </p>

      <h2>Scheduling a call</h2>
      <p>
        On any candidate&apos;s detail page, the <strong>Phone queue</strong>{" "}
        card has a Schedule call button. Pick date+time + purpose:
      </p>
      <ul>
        <li><strong>Initial outreach</strong></li>
        <li><strong>Availability check</strong></li>
        <li><strong>Reference check</strong></li>
        <li><strong>Offer discussion</strong></li>
        <li><strong>Other</strong> — free-text reason</li>
      </ul>

      <h2>How the queue runs</h2>
      <p>
        The dispatcher checks every 30 seconds for any call due now and
        dials out via Twilio. The system records:
      </p>
      <ul>
        <li>Connection status (initiated / ringing / answered / completed / failed)</li>
        <li>Duration in seconds</li>
        <li>Twilio outcome (busy / no-answer / answered-by-machine)</li>
        <li>Your manual outcome note</li>
      </ul>

      <h2>Reschedule outcome</h2>
      <p>
        When you mark a call&apos;s outcome as <em>reschedule</em>, the
        original row is marked rescheduled and a new pending row is
        enqueued. The chain links via <code>rescheduled_to_id</code>.
      </p>

      <h2>Configuring Twilio</h2>
      <p>
        Without Twilio credentials the dispatcher just logs intent. Add
        credentials under <K>Settings → Integrations → Twilio</K>:
      </p>
      <ul>
        <li><strong>Account SID</strong></li>
        <li><strong>Auth token</strong></li>
        <li><strong>Voice sender</strong> — Twilio-provisioned voice-enabled number</li>
        <li><strong>WhatsApp sender</strong> (optional, for the inbound bot)</li>
      </ul>
    </>
  );
}

// ─── Communication ────────────────────────────────────────────────────

export function Inbox() {
  return (
    <>
      <h1>Inbox triage</h1>
      <p className="lead">
        Every email arriving at your connected mailbox lands here once
        the IMAP listener has pulled and classified it (within ~20
        seconds of receipt).
      </p>
      <DocImage src="/docs/screenshots/inbox.png" alt="Inbox" />

      <h2>Filters &amp; columns</h2>
      <ul>
        <li>
          <strong>Classification</strong> — All / Candidate application /
          Interview reply / Auto-reply / Spam / Other.
        </li>
        <li>
          <strong>Processed</strong> — show only messages the workflow
          has fully processed.
        </li>
        <li>
          <strong>Date range</strong> — Today / 7 days / 30 days.
        </li>
      </ul>
      <p>Each row: from, subject, classification badge, confidence %, received time, attachment indicator.</p>

      <h2>Detail pane</h2>
      <ul>
        <li><strong>Body</strong> — full HTML + text rendered.</li>
        <li><strong>Attachments</strong> — filename + size, click to download.</li>
        <li>
          <strong>Re-classify</strong> — fix the label. Corrected label
          becomes training-style feedback at the next classifier tune.
        </li>
        <li><strong>Link to candidate</strong> — manually associate with an existing candidate.</li>
        <li><strong>Mark as ignored</strong> — non-recruiting noise.</li>
      </ul>

      <h2>Auto-pipeline trigger</h2>
      <p>
        When an email is classified as <em>candidate application</em>{" "}
        the full workflow now fires automatically — you no longer need
        to click <strong>Create candidate</strong> on the email row.
        The steps:
      </p>
      <ol>
        <li>CV extracted from PDF/DOCX attachment(s).</li>
        <li>Candidate row created (or versioned via dedup).</li>
        <li>Candidate matched against open jobs.</li>
        <li>Resume scored against the best match.</li>
        <li>
          If resume_score &gt;= job.resume_threshold_min, an interview
          link is auto-generated (but NOT sent — you confirm by clicking
          Send).
        </li>
      </ol>
      <p>
        <strong>Multi-resume emails:</strong> a forwarder pasting
        &quot;here are 5 profiles for the SDE role&quot; with five
        attachments used to get classified as <em>general</em>. We now
        local-override the classifier when an email has 2+
        resume-shaped attachments and force <em>candidate_application</em>{" "}
        — each attachment becomes its own candidate row via dedup.
        Attachment filenames are also passed to the classifier so
        &quot;resume_jane_doe.pdf&quot; is a positive signal.
      </p>

      <h2>Quick actions toolbar</h2>
      <p>
        Two manual triggers sit above the email list. Useful when you
        want to re-run the pipeline against the current backlog without
        waiting for the next mailbox poll:
      </p>
      <ul>
        <li>
          <strong>Classify emails</strong> — re-runs the email classifier
          across any messages that don&apos;t have a classification yet.
        </li>
        <li>
          <strong>Run auto-workflow</strong> — for every classified
          candidate-application email that doesn&apos;t yet have a
          Candidate row, runs the full intake pipeline (CV extract →
          dedup → match → score).
        </li>
      </ul>

      <Tip kind="info">
        Sample-data loading has been removed — the inbox is now driven
        entirely by your real connected mailbox. Use the trial signup
        flow if you want a clean tenant to experiment in.
      </Tip>
    </>
  );
}

export function Outreach() {
  return (
    <>
      <h1>Outreach sequences</h1>
      <p className="lead">
        Multi-touch email + WhatsApp campaigns. Use when a single
        availability check isn&apos;t enough — a 3-step warm-up for cold
        candidates, or a re-engagement loop for past applicants.
      </p>
      <DocImage src="/docs/screenshots/outreach.png" alt="Outreach UI" />

      <h2>Building a sequence</h2>
      <p>Click <K>+ New sequence</K>. Each sequence has:</p>
      <ul>
        <li><strong>Name</strong> — internal label.</li>
        <li>
          <strong>Steps</strong> — ordered list. Each step:
          <ul>
            <li><strong>Channel</strong> — Email, WhatsApp, or SMS.</li>
            <li><strong>Delay</strong> — days after the previous step (or after enrollment for step 1).</li>
            <li>
              <strong>Body</strong> — supports{" "}
              <K>{"{candidate_first_name}"}</K> / <K>{"{job_title}"}</K> /{" "}
              <K>{"{company_name}"}</K> tokens.
            </li>
            <li>
              <strong>Stop on reply</strong> — sequence cancels for that
              candidate the moment they reply to any step.
            </li>
          </ul>
        </li>
      </ul>

      <h2>Enrolling candidates</h2>
      <ul>
        <li><strong>From talent bank</strong> — bulk-select + Enroll in sequence.</li>
        <li><strong>From the sequence page</strong> — pick candidates from a dropdown.</li>
      </ul>
      <p>
        Each enrollment is tracked individually. The worker wakes up
        every 60 seconds, finds steps due now, and sends them through
        the tenant&apos;s SMTP / Twilio.
      </p>

      <h2>Reply detection</h2>
      <p>
        When a candidate replies on email (IMAP listener) or WhatsApp
        (Twilio webhook), the worker marks the enrollment as{" "}
        <em>stopped_by_reply</em>. The candidate doesn&apos;t receive
        further steps. The reply surfaces in bell notifications.
      </p>

      <Tip kind="warning">
        Don&apos;t over-send. Three steps over two weeks beats six steps
        over five days — both for response rate and for staying out of
        spam filters. The worker enforces a soft cap of one outbound per
        candidate per 24 hours.
      </Tip>
    </>
  );
}

export function WhatsAppBot() {
  return (
    <>
      <h1>WhatsApp bot</h1>
      <p className="lead">
        Twilio&apos;s WhatsApp Business API delivers your messages and
        relays replies back via webhook. The platform classifies each
        reply and auto-acts when it&apos;s clear-cut.
      </p>

      <h2>Setup</h2>
      <ol>
        <li>
          Get a Twilio account with a WhatsApp sender approved (sandbox
          works for testing; production sender needed for real candidates).
        </li>
        <li>
          Under <K>Settings → Integrations → Twilio</K>, paste your
          Account SID, Auth Token, and the approved <K>whatsapp_from</K>{" "}
          number.
        </li>
        <li>
          In the Twilio Console, point the inbound webhook URL at:
          <pre className="not-prose bg-slate-100 rounded-md px-3 py-2 text-xs font-mono overflow-x-auto mt-2">
            POST https://hireops.symprio.com/api/v1/webhook/twilio/whatsapp
          </pre>
        </li>
      </ol>

      <h2>Intent classification</h2>
      <p>Keyword-based with priority ordering:</p>
      <ol>
        <li>
          <strong>decline_joined_another</strong> — &quot;I joined&quot;,
          &quot;already accepted&quot;, &quot;started a new role&quot;,
          &quot;signed an offer&quot; → talent_bank_status =
          <em>joined_another</em> + friendly congrats reply.
        </li>
        <li>
          <strong>unclear</strong> (checked before generic confirm) —
          phrases like &quot;but next week works&quot;, &quot;before I
          decide&quot;, &quot;what&apos;s the salary&quot;. Logged with no
          auto-reply.
        </li>
        <li>
          <strong>decline_not_available</strong> — &quot;not
          available&quot;, &quot;not looking&quot;, &quot;unsubscribe&quot;
          → talent_bank_status = <em>not_available</em> + polite
          acknowledgement.
        </li>
        <li>
          <strong>confirm</strong> — &quot;yes&quot;, &quot;sure&quot;,
          &quot;works for me&quot;, &quot;interested&quot; → generates a
          fresh InterviewLink + replies with the URL.
        </li>
      </ol>

      <p>
        Order matters. &quot;Yes, I joined another company&quot; should
        NOT become an auto-link send — the joined-another match fires
        first.
      </p>

      <Tip kind="info">
        Every inbound message is logged to the candidate timeline,
        regardless of intent. The bell-icon feed surfaces every reply so
        HR sees nuanced cases that needed manual handling.
      </Tip>
    </>
  );
}

// ─── Reports ──────────────────────────────────────────────────────────

export function Reports() {
  return (
    <>
      <h1>Reports &amp; funnel</h1>
      <p className="lead">
        The numbers that matter at month-end: where candidates dropped
        off, who&apos;s top of the bench, how recruiters compare.
      </p>

      <h2>Main report (<K>/reports</K>)</h2>
      <ul>
        <li>
          <strong>Top stats</strong> — total jobs, total candidates, total
          applications, active screenings, average resume score,
          shortlisted count, rejected count.
        </li>
        <li>
          <strong>Stage distribution</strong> — funnel visualisation
          showing what % of candidates make it from each stage to the
          next. Click any band to drill into that stage&apos;s
          candidates.
        </li>
        <li>
          <strong>Top candidates</strong> — current leaderboard ranked by
          combined score (resume + interview).
        </li>
      </ul>

      <h2>Per-recruiter report (<K>/reports/recruiters</K>)</h2>
      <p>
        Owner-only sub-report. Breakdown by recruiter: candidates
        sourced, interviews run, shortlists generated, offers extended,
        signed. Use for compensation reviews and to identify training
        opportunities.
      </p>
    </>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────

export function SettingsOverview() {
  return (
    <>
      <h1>Settings overview</h1>
      <p className="lead">
        Everything tenant-level lives under <K>/settings</K>. The hub
        groups tiles by the kind of work they support.
      </p>
      <DocImage src="/docs/screenshots/settings.png" alt="Settings hub" />

      <h2>Workspace fundamentals</h2>
      <ul>
        <li><Link href="/docs/organization">Organization Profile</Link> — company info + email branding.</li>
        <li><Link href="/docs/team">Team &amp; Roles</Link> — invite recruiters.</li>
        <li><Link href="/docs/profile">Profile &amp; Notifications</Link> — your personal settings.</li>
      </ul>

      <h2>Communication setup</h2>
      <ul>
        <li><Link href="/docs/email-integrations">Email Integrations</Link> — Gmail / Outlook / Yahoo / iCloud.</li>
        <li><Link href="/docs/templates">Email Templates</Link> — customise 11 default templates.</li>
        <li><Link href="/docs/calendar">Calendar Integration</Link> — Google busy/free.</li>
      </ul>

      <h2>Recruiting workflow</h2>
      <ul>
        <li><Link href="/docs/pipeline-templates">Pipeline Templates</Link> — custom stages.</li>
        <li><Link href="/docs/offer-templates">Offer Templates</Link> — salary / equity boilerplate.</li>
        <li><Link href="/docs/job-boards">Job Boards</Link> — LinkedIn, Indeed, etc.</li>
        <li><Link href="/docs/hris-integrations">HRIS / ATS Integrations</Link> — Greenhouse, Lever, Workday.</li>
      </ul>

      <h2>Plan &amp; usage</h2>
      <ul>
        <li><Link href="/docs/billing">Billing &amp; Plan</Link> — upgrade tier, payment, AI usage panel.</li>
      </ul>
    </>
  );
}

export function Organization() {
  return (
    <>
      <h1>Organization &amp; branding</h1>
      <p className="lead">
        Two things on the same page: company facts that ground AI
        prompts, and visual branding applied to every outbound email.
      </p>
      <DocImage src="/docs/screenshots/organization.png" alt="Organization profile" />

      <h2>Company facts</h2>
      <p>Feed directly into the JD generator&apos;s system prompt:</p>
      <ul>
        <li>
          <strong>Company name</strong> — appears verbatim in emails and
          AI-generated content. Match your legal entity for offer-letter
          consistency.
        </li>
        <li><strong>Industry</strong> — picks the closest match. Informs vocabulary.</li>
        <li><strong>Headquarters</strong> — &quot;City, Country&quot;. Default job location.</li>
        <li>
          <strong>Company size</strong> — employee band. Affects tone
          (startup vs enterprise).
        </li>
        <li>
          <strong>Default work mode</strong> — Remote / Hybrid / Onsite.
          Combined with HQ produces job locations.
        </li>
        <li>
          <strong>Default salary currency</strong> — pre-fills offer
          letters. ISO 4217.
        </li>
        <li><strong>Website</strong> — included in outreach signature.</li>
        <li>
          <strong>About the company</strong> — 1-3 sentences woven into
          job descriptions and outreach.
        </li>
      </ul>

      <h2>Email branding</h2>
      <ul>
        <li>
          <strong>Logo URL</strong> — direct link to a PNG/SVG. Rendered
          at 48px height in email headers. Empty → company name as text.
        </li>
        <li>
          <strong>Primary colour</strong> — hex code. Header + button
          background in every email. Defaults to <K>#6366f1</K>.
        </li>
        <li>
          <strong>From-name</strong> — display name on outbound emails.
          Defaults to company name.
        </li>
        <li>
          <strong>Signature</strong> — plain text or basic HTML at the
          bottom of every email.
        </li>
      </ul>

      <Tip kind="info">
        Branding wraps automatically around every template body — set it
        once. Customise individual email wording on the{" "}
        <Link href="/docs/templates">Email Templates</Link> page.
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
        sends. Eleven default templates ship pre-filled.
      </p>
      <DocImage src="/docs/screenshots/templates.png" alt="Templates list" />

      <h2>Full catalogue</h2>
      <table>
        <thead>
          <tr><th>Template</th><th>When it fires</th></tr>
        </thead>
        <tbody>
          <tr><td>Interview invitation</td><td>HR clicks Send interview link</td></tr>
          <tr><td>Interview rescheduled</td><td>Auto-reschedule path picks a new slot</td></tr>
          <tr><td>Interview confirmed</td><td>Candidate booked a slot (with cal invite)</td></tr>
          <tr><td>Interview reminder</td><td>24h before scheduled interview</td></tr>
          <tr><td>Availability check</td><td>Bulk reach-out from talent bank</td></tr>
          <tr><td>Shortlist congrats</td><td>Candidate moved to shortlisted</td></tr>
          <tr><td>Offer letter</td><td>HR clicks Generate offer</td></tr>
          <tr><td>Offer accepted (internal)</td><td>Candidate signs the offer</td></tr>
          <tr><td>Rejection</td><td>HR clicks Send rejection email</td></tr>
          <tr><td>Generic email</td><td>Ad-hoc send from candidate timeline</td></tr>
          <tr><td>In-app notification</td><td>Short copy for the bell feed</td></tr>
        </tbody>
      </table>

      <h2>Editor</h2>
      <DocImage src="/docs/screenshots/templates-editor.png" alt="Template editor" />
      <p>Left: subject + body. Right: variables + live preview.</p>

      <h3>Subject line</h3>
      <p>
        Single line. Variables work like in the body. Keep under 80
        characters — most clients truncate beyond that.
      </p>

      <h3>HTML body</h3>
      <p>
        Plain HTML. <strong>Don&apos;t add your own logo or signature</strong>{" "}
        — the branding shell wraps your content automatically. Use
        semantic HTML; the rendered email shows in real time in the
        preview pane.
      </p>

      <h3>Variables sidebar</h3>
      <p>
        Each template lists its supported variables. Click a chip to
        append to the body. Unknown tokens stay as literal text — typos
        like <K>{"{candidate_naem}"}</K> show up obviously.
      </p>

      <h3>Live preview</h3>
      <p>
        Debounced 600ms. Renders actual email HTML inside a sandbox
        iframe. Shows from-name, subject, full branded shell. Variables
        get sample values per category.
      </p>

      <h2>Reset to default</h2>
      <p>
        Editing any template shows a Custom badge. <strong>Reset to
        default</strong> deletes your override and falls back to the
        platform-shipped template. Custom badge flips back to Default.
      </p>
    </>
  );
}

export function PipelineTemplates() {
  return (
    <>
      <h1>Pipeline templates</h1>
      <p className="lead">
        Define your own hiring stages between New and Hired / Rejected.
        Each job uses one pipeline template — change once, every job&apos;s
        candidates remap automatically.
      </p>

      <h2>The default template</h2>
      <p>Every tenant ships with a 7-stage default:</p>
      <ol>
        <li>New</li>
        <li>Classified</li>
        <li>Matched</li>
        <li>Screening scheduled</li>
        <li>Screened</li>
        <li>Shortlisted (terminal: hired)</li>
        <li>Rejected (terminal: rejected)</li>
      </ol>

      <h2>Editing</h2>
      <p>From <K>/settings/pipeline-templates</K> click any template:</p>
      <ul>
        <li>
          <strong>Stage key</strong> — stable string ID (e.g.
          <K>screening_scheduled</K>). Don&apos;t change this on
          in-use stages.
        </li>
        <li><strong>Display name</strong> — what HR sees.</li>
        <li><strong>Colour</strong> — for the stage pill.</li>
        <li>
          <strong>Terminal flag</strong> — marks Hired / Rejected. Auto-
          pipeline won&apos;t move out of terminal stages.
        </li>
        <li><strong>Terminal outcome</strong> — &quot;hired&quot; or &quot;rejected&quot;. Drives reporting.</li>
      </ul>

      <p>
        Drag rows to reorder. <strong>+ Stage</strong> to add. Trash
        icon to remove (fails if any current application is in that
        stage).
      </p>

      <Tip kind="warning">
        Keep the four stable keys the auto-pipeline expects:{" "}
        <K>matched</K>, <K>screening_scheduled</K>, <K>screened</K>,{" "}
        <K>shortlisted</K>. The system looks these up by name when
        deciding what to do next — renaming breaks auto-progress.
      </Tip>

      <h2>Cloning a template</h2>
      <p>
        <strong>Duplicate</strong> creates a copy you can edit
        independently. Useful for one pipeline for engineering, another
        for sales.
      </p>
    </>
  );
}

export function OfferTemplates() {
  return (
    <>
      <h1>Offer templates</h1>
      <p className="lead">
        Salary / equity / benefits boilerplate for the offer-letter
        generator. Define once per role family; the offer wizard picks
        the right one based on the job&apos;s department.
      </p>

      <h2>Fields per template</h2>
      <ul>
        <li><strong>Name</strong> — internal label.</li>
        <li><strong>Default base salary</strong> — low / mid / high band.</li>
        <li><strong>Default bonus</strong> — free text.</li>
        <li><strong>Equity description</strong> — free text.</li>
        <li><strong>Employment type</strong> — Full-time / Part-time / Contractor.</li>
        <li><strong>Default benefits list</strong> — bullet points.</li>
        <li><strong>Department match</strong> — comma-separated departments. Drives auto-select.</li>
      </ul>

      <h2>Using a template</h2>
      <ol>
        <li>Click <strong>Generate offer</strong> on a shortlisted candidate.</li>
        <li>The wizard picks a template based on the job&apos;s department.</li>
        <li>Pre-fills salary / bonus / equity from the template defaults.</li>
        <li>Tweak anything candidate-specific.</li>
        <li>Generates a Stripe-signed e-signature link.</li>
      </ol>

      <Tip>
        Wording of the offer email is on the{" "}
        <Link href="/docs/templates">Email Templates → Offer letter</Link>{" "}
        page. Offer templates control numbers; email templates control
        prose.
      </Tip>
    </>
  );
}

export function Team() {
  return (
    <>
      <h1>Team &amp; roles</h1>
      <p className="lead">
        Invite teammates and decide what they can do.
      </p>
      <DocImage src="/docs/screenshots/team.png" alt="Team & roles" />

      <h2>Roles</h2>
      <ul>
        <li>
          <strong>Owner</strong> — full access. Billing, integrations,
          templates, team management. Can override fraud blocks, send
          offers, delete candidates. At least one owner required.
        </li>
        <li>
          <strong>Member</strong> — everyday recruiter. Manages candidates
          and runs interviews. Can&apos;t change billing, invite
          teammates, or edit templates.
        </li>
      </ul>

      <h2>Inviting</h2>
      <ol>
        <li>Click <strong>Invite member</strong>.</li>
        <li>Enter work email and pick a role.</li>
        <li>They get an email with a single-use link valid for 7 days.</li>
        <li>On accept, they set their own password and land on the dashboard.</li>
      </ol>

      <h2>Pending invites</h2>
      <p>
        The list also shows pending invites with expiry. You can{" "}
        <strong>Resend</strong> or <strong>Revoke</strong> before
        acceptance.
      </p>

      <h2>Changing a role</h2>
      <p>
        The role dropdown on any member row flips member ↔ owner.
        Demoting yourself requires another owner to exist.
      </p>

      <h2>Removing a member</h2>
      <p>
        Trash icon disables the user&apos;s login immediately. Historical
        actions stay attributed. Re-invite the same email later and
        history is preserved.
      </p>
    </>
  );
}

export function Calendar() {
  return (
    <>
      <h1>Calendar integration</h1>
      <p className="lead">
        Connect Google Calendar so interview slot suggestions skip times
        you&apos;re already booked. Per-recruiter — each member
        authorises their own calendar.
      </p>
      <DocImage src="/docs/screenshots/calendar.png" alt="Calendar integration" />

      <h2>Connecting</h2>
      <ol>
        <li>Open <K>Settings → Calendar Integration</K>.</li>
        <li>Click <strong>Connect Google Calendar</strong>.</li>
        <li>
          Authorise on Google&apos;s consent screen. We request only{" "}
          <K>calendar.readonly</K> — we see busy intervals but cannot
          create, edit, or delete events.
        </li>
        <li>
          Redirected back with an emerald &quot;Calendar connected&quot;
          banner.
        </li>
      </ol>

      <Tip kind="info">
        Calendar is per-user, not per-tenant. Two recruiters on the same
        workspace each authorise separately.
      </Tip>

      <h2>How slot suggestions work</h2>
      <p>
        On any candidate&apos;s detail page (pre-interview), a
        &quot;Suggested interview times&quot; card pulls slots:
      </p>
      <ul>
        <li>30-minute increments by default</li>
        <li>9am-5pm local working hours</li>
        <li>Next 5 business days</li>
        <li>
          Skipping any window overlapping a Google busy interval (with
          15-min buffer on either side)
        </li>
        <li>Up to 8 suggestions</li>
      </ul>
      <p>
        Each row has <strong>Copy</strong> to paste into a message. The
        card has a Refresh button if you just accepted a new meeting.
      </p>

      <h2>Disconnecting</h2>
      <p>
        <strong>Disconnect</strong> removes your token. Slot suggestions
        fall back to plain business-hour windows until you reconnect.
      </p>

      <Tip kind="warning">
        Revoking on Google&apos;s side (myaccount.google.com →
        Permissions) takes 30-60 minutes to propagate. Use our{" "}
        <strong>Disconnect</strong> for immediate effect.
      </Tip>
    </>
  );
}

export function EmailIntegrations() {
  return (
    <>
      <h1>Email integrations</h1>
      <p className="lead">
        Connect any mailbox for inbox triage (inbound) and templated
        outbound sends. Multiple mailboxes per tenant supported.
      </p>
      <DocImage src="/docs/screenshots/email-integrations.png" alt="Email integrations" />

      <h2>Supported providers</h2>
      <ul>
        <li><strong>Gmail / Google Workspace</strong> (imap.gmail.com:993)</li>
        <li><strong>Outlook / M365 / Hotmail</strong> (outlook.office365.com:993)</li>
        <li><strong>Yahoo Mail</strong> (imap.mail.yahoo.com:993)</li>
        <li><strong>iCloud Mail</strong> (imap.mail.me.com:993)</li>
        <li><strong>Aol Mail</strong></li>
        <li><strong>Custom IMAP</strong> — any RFC-compliant server</li>
        <li><strong>POP3</strong> (legacy)</li>
      </ul>

      <h2>App passwords</h2>
      <p>
        Every provider with 2FA needs an <strong>app password</strong>,
        not your account password. Generate one in your security
        settings — provider-specific links shown inline.
      </p>

      <h2>What gets connected</h2>
      <p>Both inbound (IMAP) and outbound (SMTP) use the same credentials:</p>
      <ul>
        <li>
          <strong>Inbound</strong> — listener polls every 20 seconds.
          Auto-classifies and funnels into the pipeline.
        </li>
        <li>
          <strong>Outbound</strong> — every platform email (invites,
          reschedules, rejections, offers) sends through this same
          mailbox. Candidates see emails from <em>you</em>, not from a
          generic HireOps address.
        </li>
      </ul>

      <h2>Pausing</h2>
      <p>
        Toggle off to pause IMAP polling without disconnecting. Outbound
        still works.
      </p>

      <h2>Multiple mailboxes</h2>
      <p>
        Add another via <K>Add another mailbox</K>. Mail across all
        mailboxes surfaces in the same inbox view. Outbound uses the
        most recently active mailbox.
      </p>
    </>
  );
}

export function HrisIntegrations() {
  return (
    <>
      <h1>HRIS / ATS integrations</h1>
      <p className="lead">
        Sync hires back to your HRIS so the rest of the company sees new
        starters automatically.
      </p>

      <h2>Supported providers</h2>
      <ul>
        <li>Greenhouse</li>
        <li>Lever</li>
        <li>Workday</li>
        <li>BambooHR</li>
        <li>SAP SuccessFactors</li>
        <li>ADP Workforce Now</li>
        <li>Personio</li>
        <li>Rippling</li>
      </ul>
      <p>
        OAuth where the provider supports it; otherwise API key + tenant
        URL. Sync once an hour by default — trigger on-demand from the
        integration row.
      </p>

      <h2>What syncs each direction</h2>
      <p><strong>HireOps → HRIS:</strong></p>
      <ul>
        <li>New hire records on Shortlisted + Offer Accepted</li>
        <li>Candidate contact info + resume</li>
        <li>Offer letter PDF</li>
      </ul>
      <p><strong>HRIS → HireOps:</strong></p>
      <ul>
        <li>Open requisitions (auto-creates draft jobs you review + publish)</li>
        <li>Department + cost-centre structure</li>
        <li>Hiring manager assignments</li>
      </ul>

      <Tip kind="info">
        Each sync logs to integration_sync_logs. If something looks
        wrong, hit <strong>View sync history</strong> for the per-attempt
        log with timestamps and errors.
      </Tip>
    </>
  );
}

export function JobBoards() {
  return (
    <>
      <h1>Job boards</h1>
      <p className="lead">
        Publish open roles to external boards from inside the platform.
        One job, multiple boards, single source of truth.
      </p>

      <h2>Supported boards</h2>
      <ul>
        <li><strong>LinkedIn Recruiter / Jobs</strong> — OAuth via Recruiter seat or company page.</li>
        <li><strong>Indeed</strong> — XML feed (platform hosts the URL).</li>
        <li><strong>Facebook Jobs</strong> — Pages API.</li>
        <li><strong>MyFutureJobs</strong> (Malaysia) — direct API.</li>
      </ul>

      <h2>Connecting</h2>
      <p>
        Click any board tile under <K>Settings → Job Boards</K>. Each
        takes you through OAuth or asks for an API key. Once connected:
      </p>
      <ul>
        <li>The tile shows a connected badge with the account email.</li>
        <li>
          On any job&apos;s detail page, <strong>Publish</strong> becomes
          available for that board.
        </li>
      </ul>

      <h2>Publishing</h2>
      <ol>
        <li>Open the job detail page.</li>
        <li>
          Scroll to <strong>Job board publishing</strong>. Lists every
          connected board with a Publish toggle.
        </li>
        <li>
          Toggle each board. The system queues the post and shows the
          external URL once accepted (usually minutes; LinkedIn can take
          an hour).
        </li>
      </ol>

      <h2>Unpublishing</h2>
      <p>
        Closing the job auto-delists from all boards. You can also
        manually unpublish via the same card.
      </p>

      <Tip kind="warning">
        Some boards charge per post (LinkedIn PAYG, Indeed sponsored).
        The platform doesn&apos;t enforce caps — manage budgets on each
        board&apos;s side.
      </Tip>
    </>
  );
}

export function Billing() {
  return (
    <>
      <h1>Billing &amp; plan</h1>
      <p className="lead">
        Two plans — <strong>Trial</strong> and{" "}
        <strong>Business</strong>. Trial is self-serve; Business is
        sales-led. Pricing is bespoke per tenant.
      </p>
      <DocImage src="/docs/screenshots/billing.png" alt="Billing page" />

      <h2>Plan tiers</h2>
      <ul>
        <li>
          <strong>Trial</strong> — 5 jobs, 25 candidates, inbox triage
          only. Other AI features locked. Good for kicking the tires
          and seeing if the platform fits your hiring workflow.
        </li>
        <li>
          <strong>Business</strong> — unlimited jobs / candidates /
          interviews, voice screening (ElevenLabs), Q&amp;A rounds,
          team seats, fraud detection, outreach campaigns. Enabled per
          tenant after a sales conversation; we tune the markup and
          quotas to your volume.
        </li>
      </ul>

      <h2>Upgrading (Trial → Business)</h2>
      <p>
        The Business plan card shows <strong>Contact us</strong>{" "}
        instead of a self-serve Upgrade button. Clicking it opens a
        prefilled email to{" "}
        <K>contact@symprio.com</K> — give us a sense of headcount,
        roles, and current ATS and we&apos;ll come back with a quote
        within one business day.
      </p>
      <Tip kind="info">
        We deliberately don&apos;t do self-serve credit-card upgrades
        right now. Sales-led keeps the markup conversation honest and
        means every Business tenant gets onboarding help.
      </Tip>

      <h2>Feature locks while on Trial</h2>
      <p>
        Premium features are <strong>visible</strong> in the UI but
        locked: sidebar items show a 🔒 lock badge, and any action
        button (e.g. &quot;Send WhatsApp&quot;, &quot;Run resume
        scorer&quot;) renders as a greyed button with a popover
        offering <strong>Contact us to enable</strong>. The popover&apos;s
        mailto is prefilled with the feature name so we know what you
        want unlocked.
      </p>

      <h2>AI usage</h2>
      <p>The Your AI Usage panel below the plan cards shows:</p>
      <ul>
        <li>
          <strong>Today&apos;s spend</strong> vs daily budget. At the cap
          → 429 until midnight UTC.
        </li>
        <li><strong>Window selector</strong> — 24h / 7d / 30d.</li>
        <li><strong>Total calls, tokens, billable cost</strong>.</li>
        <li><strong>Per-agent breakdown</strong>.</li>
      </ul>

      <Tip kind="info">
        Cost shown is <strong>billable</strong> (what you&apos;d be
        charged), not raw provider cost. Markup is configured per plan
        by your platform admin.
      </Tip>
    </>
  );
}

// ─── Account ──────────────────────────────────────────────────────────

export function Profile() {
  return (
    <>
      <h1>Your profile</h1>
      <p className="lead">
        Personal settings that only affect you, not other recruiters.
      </p>

      <h2>Identity</h2>
      <ul>
        <li>
          <strong>Display name</strong> — appears on candidate timeline
          events and the recruiter sidebar.
        </li>
        <li>
          <strong>Email</strong> — your sign-in address. Read-only;
          changing requires a re-verify flow (coming).
        </li>
      </ul>

      <h2>Password</h2>
      <ul>
        <li><strong>Current password</strong> — verified before saving.</li>
        <li><strong>New password</strong> — ≥8 characters, must differ from current.</li>
        <li><strong>Confirm</strong> — must match.</li>
      </ul>
      <p>
        Your existing browser session stays signed in. Sessions on other
        devices may keep working until the JWT expires (default 30 days).
      </p>

      <h2>Notification preferences</h2>
      <p>
        Toggles for what shows in the bell-icon dropdown. Stored in your
        browser&apos;s localStorage — cross-device sync coming.
      </p>
      <ul>
        <li><strong>Interview events</strong> — generated / opened / completed, reschedules.</li>
        <li><strong>WhatsApp replies</strong> — inbound messages.</li>
        <li><strong>Pipeline changes</strong> — match / score / shortlist / reject.</li>
      </ul>
    </>
  );
}

export function Support() {
  return (
    <>
      <h1>Getting help</h1>
      <p className="lead">
        Three ways to find an answer or get a human involved.
      </p>

      <h2>1. Contextual help drawer</h2>
      <p>Every page in the app has a contextual help button. Two equivalent triggers:</p>
      <ul>
        <li>Top-right <strong>?</strong> icon in the top bar.</li>
        <li>
          Bottom-right floating <strong>Need help?</strong> button (pulse
          animation on first visit).
        </li>
      </ul>
      <p>
        Both open a slide-over with content specific to the current
        page: what it is, how to use it, how to configure it. Click{" "}
        <strong>Open docs</strong> at the bottom of any help drawer to
        jump to the matching full docs page.
      </p>

      <h2>2. Full docs</h2>
      <p>
        You&apos;re reading them. Sidebar organises 25+ topics across
        Getting Started, Recruiting, Communication, Reports, Settings,
        and Account.
      </p>

      <h2>3. Support tickets</h2>
      <p>
        For anything not covered, open a ticket at <K>/support</K>:
      </p>
      <ul>
        <li><strong>Subject</strong> — 80-char summary.</li>
        <li>
          <strong>Category</strong> — Bug / Feature request / Billing /
          Integration / Other. Routes internally.
        </li>
        <li>
          <strong>Priority</strong> — Low / Normal / High / Urgent. High
          and Urgent trigger Slack alerts to on-call.
        </li>
        <li>
          <strong>Description</strong> — full detail with steps to
          reproduce. Up to 8000 chars; markdown allowed.
        </li>
      </ul>

      <h2>Ticket replies</h2>
      <p>
        Admin replies arrive in your ticket detail page and via email.
        History shows the full back-and-forth with timestamps. Mark{" "}
        <strong>Resolved</strong> when the issue is addressed; you can
        always reopen.
      </p>

      <h2>Feedback</h2>
      <p>
        For non-urgent product feedback that isn&apos;t a bug or feature
        request, use the Feedback tab on the same page. Goes to the
        product team rather than support engineering.
      </p>

      <Tip kind="info">
        Pre-filled tickets: clicking &quot;Want this prioritized?&quot; on
        a coming-soon integration opens the support composer with
        subject + category + initial message pre-filled.
      </Tip>
    </>
  );
}


/** Slug → section component. Used by the dynamic /docs/[slug] route. */
export const SECTIONS: Record<string, () => React.ReactNode> = {
  "getting-started": GettingStarted,
  "dashboard": Dashboard,
  "search-and-notifications": SearchAndNotifications,
  "jobs": Jobs,
  "candidates": Candidates,
  "talent-bank": TalentBank,
  "interviews": Interviews,
  "calls": Calls,
  "inbox": Inbox,
  "outreach": Outreach,
  "whatsapp": WhatsAppBot,
  "reports": Reports,
  "settings-overview": SettingsOverview,
  "organization": Organization,
  "templates": Templates,
  "pipeline-templates": PipelineTemplates,
  "offer-templates": OfferTemplates,
  "team": Team,
  "calendar": Calendar,
  "email-integrations": EmailIntegrations,
  "hris-integrations": HrisIntegrations,
  "job-boards": JobBoards,
  "billing": Billing,
  "profile": Profile,
  "support": Support,
};
