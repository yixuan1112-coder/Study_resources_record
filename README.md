# NTU Course Vault

A small web app for keeping every NTU course's material in one indexed place —
lecture PDFs, your own markdown notes, and photos of the whiteboard — so that
revision means opening one page instead of digging through Downloads.

Sign in with GitHub. Your files are stored in a **private repository on your own
GitHub account**, one folder per course code.

```
your-github-account/ntu-course-vault
├── courses.json            # the course index
└── courses/
    ├── CZ1003/
    │   ├── lecture-01.pdf
    │   ├── my-summary.md
    │   └── whiteboard.jpg
    └── MH1812/
        └── tutorial-3.pdf
```

## What it does

- **Course index** — add courses by code (CZ1003, MH1812…) with title, academic
  year, semester and AUs. Grouped by year/semester, searchable.
- **Upload anything** — drag files anywhere onto a course page. Multiple files
  land in a single commit.
- **Preview in the browser** — PDFs render inline, markdown renders as formatted
  notes (GFM tables, code, task lists), images display directly.
- **Rename, move, delete** — without leaving the page. Every change is an
  ordinary git commit, so nothing is ever silently lost.

Because the storage is just a git repo, you can also clone it, edit notes in
your own editor, and push — the app picks the changes up on the next load.

## Setup

### 1. Create a GitHub OAuth App

Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**:

| Field | Value |
| --- | --- |
| Application name | NTU Course Vault |
| Homepage URL | `http://localhost:3000` |
| Authorization callback URL | `http://localhost:3000/api/auth/callback/github` |

Generate a client secret and keep both values.

> The app requests the `repo` scope. It needs this to create your private vault
> repository and write files into it. Nothing is written until you upload
> something.

### 2. Configure and run

```bash
cp .env.example .env.local
npx auth secret          # writes AUTH_SECRET into .env.local
# then fill in AUTH_GITHUB_ID and AUTH_GITHUB_SECRET

npm install
npm run dev
```

Open http://localhost:3000.

## Deploying to Vercel

1. Push this repo to GitHub (already done if you are reading it there).
2. On [vercel.com/new](https://vercel.com/new), import the repository. Vercel
   detects Next.js on its own — no build settings to change.
3. Add these **Environment Variables** in the Vercel project settings:

   | Name | Value |
   | --- | --- |
   | `AUTH_SECRET` | output of `npx auth secret` |
   | `AUTH_GITHUB_ID` | your OAuth app's client ID |
   | `AUTH_GITHUB_SECRET` | your OAuth app's client secret |

   `AUTH_TRUST_HOST` is *not* needed on Vercel — it detects its own host.

4. Deploy, then go back to your GitHub OAuth App and update the two URLs to your
   real domain:

   - Homepage URL → `https://your-app.vercel.app`
   - Callback URL → `https://your-app.vercel.app/api/auth/callback/github`

   The callback URL must match exactly or GitHub will refuse to sign you in.

Anyone you share the link with signs in with their own GitHub account and gets
their own private vault — they never see your files, and you never see theirs.

## How it works

| Concern | Approach |
| --- | --- |
| Auth | Auth.js (NextAuth v5), GitHub OAuth with PKCE, JWT session cookie |
| Storage | The GitHub Contents and Git Data APIs — no database |
| Reads | Proxied through `/api/file`, because the vault repo is private |
| Multi-file upload | One blob per file, then a single tree + commit |

### One deliberate trade-off

File uploads go **from your browser straight to `api.github.com`**, not through
the server. A Vercel function caps request bodies at 4.5 MB, which a single set
of lecture slides comfortably exceeds.

That means the browser holds your OAuth token while uploading. It is fetched
from `/api/upload-session` (which requires your authenticated session), kept in
memory only, and never written to `localStorage`. This is the same approach
GitHub-backed editors such as Decap CMS take. Everything else — listing,
renaming, deleting, reading — stays server-side.

Individual files are capped at 45 MB, below GitHub's blob API limit.

## Notes

- Removing a course removes it from `courses.json` only. The files stay in the
  repo, so a mis-click costs nothing.
- Deleting a *file* really does delete it from the working tree — but it remains
  in the git history, recoverable with `git log --diff-filter=D`.
- Images referenced from a note by bare filename (`![](diagram.png)`) resolve
  against that course's folder.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # serve the production build
npx eslint src  # lint
```
