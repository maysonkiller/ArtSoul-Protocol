# Agent Operating Rules

Before changing code, read the relevant canon section and state which section the task touches.

Do not invent protocol mechanics, fees, roles, states, treasury rules, token logic, or anti-sybil details. If the canon does not specify something, stop and ask.

Do not expose secrets, private keys, service-role keys, database passwords, hidden scoring logic, or operational bypass details.

Use small branches and PRs. Do not merge into `main` without human review.

After implementation, report:

- Files changed.
- Validation run.
- Any ambiguity that needs a canon decision.
