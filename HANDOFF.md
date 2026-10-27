# Part 3 hand-off — Frontend, browser tests and documentation

For: Amartya (`Amartyasinha07`) · Repository: https://github.com/AdityaCSanikop/blood-donation-matcher (private)

## What you are submitting

`part3-frontend.patch` adds Part 3 of the Blood Donation Matcher on top of Parts 1 and 2, which are already on `main`. It contains **45 new files and changes no existing file**:

- `src/app/(staff)/`, `src/app/(donor)/`, `src/app/(public)/`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/favicon.ico` — the 12 pages (sign-in, registration, dashboard, donors, recipients, requests, donations, hospitals, activity log, donor profile)
- `src/components/`, `src/lib/client.ts`, `src/lib/hooks.ts` — UI components and browser-side helpers
- `e2e/`, `playwright.config.ts` — browser tests
- `docs/TESTING.md`, `docs/DEMO.md`, `docs/ci-workflow.yml`, `docs/evidence/test_*.txt`, `docs/screenshots/` (14 images)

The full list is in `part3-files.txt`. After this, `main` contains the complete application.

**Who did what.** The code in this patch was developed and tested by Aditya. Your part is to apply it to your own branch, check it with Git, commit it under your own Git identity, push the branch and open the pull request. Git will record you as author and committer of your commit, so the commit message and the pull request below say where the code came from. Keep that wording; do not describe the code as written by you.

You only need **Git** (with Git Bash) and access to the repository. You do **not** need Node.js, MySQL or MongoDB, and you do not need to run the app or the tests.

## Package contents

| File | Purpose |
|---|---|
| `HANDOFF.md` | These instructions |
| `part3-frontend.patch` | The change to apply (SHA-256 `9e5184319ef05f790fcab665509faecc6637fde610044c98594d33407a0e0fe4`, about 3 MB because it contains the screenshots) |
| `part3-files.txt` | The 45 files the patch adds |
| `test-results.txt` | Results of the checks Aditya ran on his machine |

## Base commit

Apply the patch on **`3f2b00a`** (`3f2b00a20f1a862e15ac8aa928e3384f8a5a3536`), "Merge pull request #1 from AdityaCSanikop/part-2-backend" — the latest commit on `main`.

## Steps

Run these in **Git Bash**. Put the four package files in one folder **outside** the repository, for example `~/Downloads/handoff-part3`. The commands below assume that folder.

### 1. Check the patch file

```bash
cd ~/Downloads/handoff-part3
sha256sum part3-frontend.patch
```

The output must start with `9e5184319ef05f790fcab665509faecc6637fde610044c98594d33407a0e0fe4`. If it does not, stop and ask Aditya for a new copy.

### 2. Clone the repository

```bash
cd ~
git clone https://github.com/AdityaCSanikop/blood-donation-matcher.git
cd blood-donation-matcher
git log --oneline -3 origin/main
```

The log must show:

```
3f2b00a Merge pull request #1 from AdityaCSanikop/part-2-backend
1edc20a Submit Part 2 backend implementation
e8c4bc0 Upgrade Next.js to 16.4.3 and Zod to 4.6.7 (security fixes)
```

### 3. Set your own Git identity (this repository only)

Use the name and the email of **your** GitHub account:

```bash
git config user.name "Your Name"
git config user.email "your-github-email@example.com"
git config user.name
git config user.email
```

### 4. Create your branch on the base commit

```bash
git switch -c part-3-frontend 3f2b00a
git status
```

`git status` must say `On branch part-3-frontend` and `nothing to commit, working tree clean`.

### 5. Check, then apply the patch

```bash
git apply --check ~/Downloads/handoff-part3/part3-frontend.patch
git apply ~/Downloads/handoff-part3/part3-frontend.patch
git status --short
```

- `git apply --check` and `git apply` must both print **nothing**. If either prints an error or a warning, stop and tell Aditya.
- `git status --short` must show only new files (`??`) under `docs/`, `e2e/`, `src/` and `playwright.config.ts` — no `M` (modified) lines.

### 6. Stage exactly the 45 files

Do not use `git add .` or `git add -A`. Keep the quotes around the folder names with brackets.

```bash
git add -- docs/DEMO.md docs/TESTING.md docs/ci-workflow.yml docs/evidence/test_api.txt docs/evidence/test_db_services.txt docs/evidence/test_e2e.txt docs/screenshots e2e playwright.config.ts "src/app/(donor)" "src/app/(public)" "src/app/(staff)" src/app/favicon.ico src/app/globals.css src/app/layout.tsx src/components src/lib/client.ts src/lib/hooks.ts
git diff --cached --name-only | wc -l
git diff --cached --name-only | diff --strip-trailing-cr - ~/Downloads/handoff-part3/part3-files.txt && echo "OK: matches part3-files.txt"
git diff --cached --check && echo "OK: no whitespace errors"
git status --short
```

Expected: `45`, then `OK: matches part3-files.txt`, then `OK: no whitespace errors`, and `git status --short` shows only `A` lines.

### 7. Commit

```bash
git commit -F - <<'EOF'
Add Part 3: frontend pages, browser tests and documentation

Applies the Part 3 hand-off patch on top of 3f2b00a: the 12 pages,
UI components, browser-side helpers, Playwright browser tests,
testing and demo documentation and screenshots (45 new files).

Code developed and tested by Aditya C Sanikop; submitted by Amartya.

Co-authored-by: AdityaCSanikop <acsanikop01@gmail.com>
EOF
git log --format='%h %an <%ae>%n%B' -1
git show --stat --format= HEAD | tail -1
```

The log must show **your** name and email. The last line must say `45 files changed`.

### 8. Push your branch

```bash
git push -u origin part-3-frontend
```

Push only `part-3-frontend`. Never push to `main` and never use `--force`.

### 9. Open the pull request

On GitHub, open the repository → **Compare & pull request** (or **Pull requests → New pull request**), set **base: `main`** ← **compare: `part-3-frontend`**, title:

```
Part 3: Frontend pages, browser tests and documentation
```

Description:

```
Adds Part 3 of the Blood Donation Matcher on top of 3f2b00a (45 new files, no existing files changed):
the 12 frontend pages, UI components, Playwright browser tests, testing/demo documentation and screenshots.

The code was developed and tested by Aditya C Sanikop; I applied the hand-off patch, checked it with Git and am submitting it.
Verification was performed by Aditya on his machine (results in test-results.txt of the hand-off):
104/104 database and service tests, 38/38 API tests, 10/10 browser tests, build, typecheck and lint passing, 0 npm audit vulnerabilities.
```

Click **Create pull request**. Do not merge it; Aditya reviews and merges it.

## Test results (run by Aditya on his machine, not by you)

Run on 2026-10-26 by Aditya, on Windows with MySQL 8.0.46, MongoDB 8.2.1, Node 24 and Google Chrome, on a fresh clone of `3f2b00a` with exactly these 45 files added. Full output is in `test-results.txt`.

| Check | Result |
|---|---|
| `npm ci` / `npm audit` | 522 packages / 0 vulnerabilities |
| `npm run lint`, `npm run typecheck` | passed |
| `npm run build` | passed — 12 pages and 24 API routes |
| `npm test` (database + service tests) | 6 files, **104 passed** |
| `npm run test:api` (build + HTTP API tests) | 1 file, **38 passed** |
| `npm run test:e2e` (browser tests) | **10 passed** |

Not verified: Linux, macOS, and the GitHub Actions workflow (`docs/ci-workflow.yml` is stored under `docs/` and does not run).

## If something goes wrong

| Problem | What to do |
|---|---|
| `sha256sum` result is different | Do not apply it; ask Aditya for a new copy. |
| `git clone` asks for a login or says "not found" | Accept the repository invitation; sign in to GitHub as `Amartyasinha07`. |
| `git log` does not show `3f2b00a` on top | Run `git fetch origin` and check again; if still different, ask Aditya. |
| `git apply --check` prints "already exists" | The patch was applied already, or you are not on a clean `part-3-frontend` from `3f2b00a`. Run `git status`; ask Aditya if unsure. |
| `pathspec ... did not match` in step 6 | The quotes around `"src/app/(donor)"` etc. are missing; copy the command exactly. |
| Step 6 count is not 45 or `diff` prints lines | Run `git reset` (unstages only) and repeat step 6. |
| The commit shows the wrong name/email | Fix step 3, then `git commit --amend --reset-author --no-edit` (before pushing). |
| `git push` is rejected | Do not force-push; ask Aditya. |
| `LF will be replaced by CRLF` warnings | Harmless on Windows. |
