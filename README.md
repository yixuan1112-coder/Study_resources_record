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
- **Share with coursemates** — invite someone by GitHub username and they can
  read your whole vault and save copies of your notes into their own. See
  [Sharing](#sharing).

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

## Sharing

Open **Study group** in the header and invite someone by GitHub username.

Under the hood this adds them to your vault repo as a GitHub collaborator with
`pull` permission — **read-only**. There is no app-level permission table:
GitHub decides what each token can see, so the app cannot get it wrong.

- They get a GitHub notification and accept it in the app (or on GitHub).
- Once accepted, their courses appear under *Shared with you* on your dashboard,
  and yours under theirs.
- **They cannot change anything.** No uploads, renames or deletes on your vault.
- They can hit **Save a copy** on any file to pull it into one of their own
  courses. It becomes their file; later edits on either side are independent.
- **Revoke any time** from Study group. Access stops immediately — though
  anything they already copied stays in their vault, as with any real file.

Copies are capped at 25 MB per file, since the bytes pass through the server.

## Troubleshooting

**"There is a problem with the server configuration"** — Auth.js could not start.
The landing page now lists exactly which variables are missing. The usual causes:

- One of `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` is not set.
- They *are* set, but you added them after deploying. **Vercel does not apply
  environment variables to an existing deployment** — go to Deployments, open
  the latest, and use *Redeploy*.
- The callback URL on the OAuth App does not match the site exactly.

**GitHub says "redirect_uri is not associated with this application"** — the
callback the app sent does not match the one registered on the OAuth App.

Open `/api/health` on the deployed site **in the browser you sign in from**. It
reports `callbackUrlToRegister`, computed from the host actually serving you —
paste that value verbatim into the OAuth App's *Authorization callback URL*.

The usual cause is arriving on the wrong hostname. A Vercel project answers on
its stable domain *and* on a different per-deployment URL for every build, and
the callback is built from whichever one you opened. Fix it permanently by
setting `AUTH_URL` to the stable origin (no trailing slash):

```
AUTH_URL=https://your-app.vercel.app
```

With that set, the callback stays the same no matter which hostname you arrive
on. Remember to redeploy after adding it.

**A shared vault shows "No access"** — the invite has not been accepted yet, or
it was revoked. Check Study group.

## How it works

| Concern | Approach |
| --- | --- |
| Auth | Auth.js (NextAuth v5), GitHub OAuth with PKCE, JWT session cookie |
| Storage | The GitHub Contents and Git Data APIs — no database |
| Reads | Proxied through `/api/file`, because vault repos are private |
| Multi-file upload | One blob per file, then a single tree + commit |
| Sharing | GitHub repo collaborators at `pull` permission |

Every write path targets the signed-in user's own vault. The `owner` parameter
that selects whose vault to *read* is deliberately ignored by writes, so no
request can be crafted to modify someone else's files.

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
