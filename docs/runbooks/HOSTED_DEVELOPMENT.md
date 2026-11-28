# Develop ArtSoul with Astra through the API

The hosted developer runs in the OpenAI project selected by the local API key.
A submitted assignment continues after the terminal closes. Each assignment
finishes with a patch and a test report. The cloud session has no GitHub token,
wallet, database credentials, or outbound network access.

For the pre-mainnet review and first-visit guide, use the dedicated sessions:

```powershell
Set-Location -LiteralPath C:\Projects\ArtSoul
node scripts/develop-with-astra.mjs audit
node scripts/develop-with-astra.mjs pilot-guide
```

Each command creates its assignment once. Repeating it with the same local
state prints the existing ID, including after updating the repository.
Append `-status` to either command to see provider usage and state, then
`-collect` to download the completed patch and report. These jobs use
`gpt-6.2-astra` at `max` reasoning effort. Both receive the committed source,
the installed Atlas and the reviewed project handoff. The audit also covers
contract inventory, indexer, data access and operating readiness. Record any
scope limitations before using the findings in a release decision.

New named sessions start with a lifetime limit of 600 USD cents each. An
operator can set an explicit limit on the existing session with `audit-limit
<cents>` or `pilot-guide-limit <cents>`. The provider counts amounts already
used in that session toward the limit. Before increasing it, compare all
session limits with the organization's available grant and any voice reserve.
Project budget alerts do not partition the organization's credit balance.

To continue development after reviewing the guide, use its existing session:

```powershell
git fetch origin main
node scripts/develop-with-astra.mjs pilot-guide-sync
node scripts/develop-with-astra.mjs pilot-guide-next "Check the published guide against the current Phase C backlog. Fix one confirmed usability regression and run the relevant offline tests."
```

The same suffixes work for the audit session. Synchronization must succeed
before assigning work on a newly published revision.

From the project directory, inspect the current assignment and collect its files:

```powershell
node scripts/develop-with-astra.mjs status
node scripts/develop-with-astra.mjs collect
```

The files live under `artifacts/astra-development/<turn ID>/`. Use
`collect <turn ID>` to download a previous completed assignment. Review the
diff, run the affected tests against the target revision, and use the ordinary
repository release process. A sandbox commit has no effect on the public site.

For an existing idle session, fetch the latest published revision and refresh
the cloud context before assigning a batch of up to two backlog fixes:

```powershell
git fetch origin main
node scripts/develop-with-astra.mjs sync
node scripts/develop-with-astra.mjs work
```

Use `next "your task"` in place of `work` for a specific assignment. The
session retains the conversation between turns. Synchronization sends a
versioned archive of selected committed code, tests, roadmap documents and the
owner's local ArtSoul Atlas. It excludes the local working tree, private
operating notes and chat history. Provide relevant new decisions in the task.
To share a longer decision summary, save it in the ignored local file
`artifacts/astra-development/owner-handoff.md`, review its contents, and run
`node scripts/develop-with-astra.mjs handoff` between turns. This uploads only
the specified summary and tells the agent where to read it.

On first setup, run `check` for an offline input check, then `start` to open one
session and submit the voice startup task. Use the existing project key in
`.env.local` and the installed ArtSoul Atlas. Session state is in the Git-ignored
`.artsoul-hosted/`, outside the compiler's output directory. Retain these records when switching
tasks. If a creation request is interrupted before its ID is saved, check the
project's Agents dashboard before starting another billable session.

The session spending limit is 1,500 US cents across its turns. Status shows the
provider's recorded consumption, which can lag. The organization billing
dashboard shows which credits paid for usage. Each new batch is submitted
explicitly. Use `followup` to register one extra offline readiness assignment
for 45 minutes later in the same capped session. Repeating the command with the
same state file returns the original schedule. The project owner can manage the
schedule in the OpenAI Agents dashboard. Recheck promotional coverage before
starting later batches.
