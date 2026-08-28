# NTU Course Vault

A small web app for keeping every NTU course's material in one indexed place —
lecture PDFs, your own markdown notes, photos of the whiteboard, and the code
you wrote for the labs — so that revision means opening one page instead of
digging through Downloads.

Sign in with GitHub. Your files are stored in a **private repository on your own
GitHub account**, one folder per course code.

```
your-github-account/ntu-course-vault
├── courses.json            # the course index
└── courses/
    ├── CZ1003/
    │   ├── lecture-01.pdf
    │   ├── my-summary.md
    │   ├── lab1.py         # written in the browser editor
    │   └── whiteboard.jpg
    └── MH1812/
        └── tutorial-3.pdf
```

## What it does

- **Course index** — add courses by code (CZ1003, MH1812…) with title, academic
  year, semester and AUs. Grouped by year/semester, searchable.
- **Upload anything** — drag files anywhere onto a course page. Any file type
  is accepted, up to 95 MB each, and multiple files land in a single commit.
- **Write a note** — type a summary straight into a course without uploading
  anything. Hit **Write a note**, give it a title and a few words, and it is
  saved as an ordinary `.md` file in that course. Edit it later from the pencil
  on its row, or delete it exactly like any other file.
- **Write code, or paste it in** — a course is also a place to keep the code you
  wrote for it. Hit **New code file**, name it `lab1.py`, and it opens in a real
  editor with syntax highlighting, tabs and `Ctrl`/`Cmd`+`S`. Already have the
  code somewhere else? Paste it into the same panel and it is saved as that
  file. See [Editor](#editor).
- **Preview in the browser** — PDFs render inline, markdown renders as formatted
  notes (GFM tables, code, task lists), images display directly.
- **Rename, move, delete** — without leaving the page. Every change is an
  ordinary git commit, so nothing is ever silently lost.
- **Share with coursemates** — invite someone by GitHub username and they can
  read your whole vault and save copies of your notes into their own. See
  [Sharing](#sharing).
- **Group chat** — everyone in a study group can talk on the Study group page.
  See [Chat](#chat).

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

## Editor

Markdown notes are prose, so they get a plain writing box. Source files get
Monaco — the editor VS Code itself is built on — because writing Python in a
`<textarea>` is miserable.

### Getting code in

There are three ways, and they all end at the same place — an ordinary file in
`courses/<CODE>/`:

- **Write it here.** **New code file**, name it, and start typing. Languages
  where an empty file is useless (Python, Java, C, C++, HTML, shell, JSON) open
  with a few lines of scaffolding rather than a blank page.
- **Paste it.** The same panel has a box for pasting. Paste before you have
  picked a name and the language is recognised from the code itself — Python,
  Java, C, C++, C#, Go, Rust, TypeScript, JavaScript, SQL, R, HTML, JSON and a
  shebang line — so the filename is filled in with the right extension and the
  stem left selected for you to type over. A pasted Java class is named after
  the class, because Java gives you no choice. CRLF line endings and a leading
  BOM are cleaned up on the way in, so a file copied out of a Windows editor
  does not show up as noise in its first diff. Pasting is capped at 1 MB.
- **Upload it.** Drag `.py` files onto the page like any other upload — several
  at once is fine. They are recognised as code and open in the editor. Folders
  are not unpacked, so drop the files themselves.

### Editing

Click any source file in a course to open it. It behaves the way an editor
should:

- **Tabs.** Several files open at once, each keeping its own undo history,
  cursor and scroll position. A dot on the tab means unsaved changes.
- **Syntax highlighting** for Python, Java, C/C++, JavaScript, TypeScript, SQL,
  R, HTML/CSS and about forty others — the extension picks the language. A few
  formats students actually use have no grammar shipped with Monaco (MATLAB
  `.m`, LaTeX `.tex`, VHDL); those open as plain text rather than not at all.
- **Auto-indent, auto-closing brackets and completions**, in the paste box as
  well as in the editor. JavaScript, TypeScript, HTML, CSS and JSON get real
  IntelliSense; Python, Java, C and C++ have no language service to give, so
  they get their keywords, their standard library and the snippets that are
  tedious to type (`main`, `fori`, `sout`, `def`, `try`), plus every identifier
  already in the file. Indentation follows VS Code's own rules, so a
  brace-less `if` body and a lone `else:` land where you expect.
- **`Ctrl`/`Cmd`+`S` saves**, and a save is one commit to your vault repo with
  the message `Update lab1.py in CZ1003`. Nothing autosaves, so a half-finished
  edit never lands in the history.
- **Opening a PDF does not close the editor.** The preview pane covers it and
  your unsaved buffers are still there when you come back.
- **Shared vaults open read-only**, like everything else a coursemate shares.

If the same file changed on github.com while you had it open, the save is
refused rather than silently overwriting that version — close the tab, reopen
it, and you get the newer text.

One limit worth knowing: files are flat within a course, so there are no
subfolders — `courses/CZ1003/lab1.py`, not `courses/CZ1003/src/lab1.py`.

The editor's own JavaScript is served from this app rather than a CDN, so it
works offline and behind a campus proxy. `npm run dev` and `npm run build` copy
it out of `node_modules` into `public/monaco` first; that directory is
generated, and gitignored.

### Running it

**Run** (or `Ctrl`/`Cmd`+`Enter`, or `F5`) runs the file and shows what it
printed, with a box for anything it reads from input. It runs the buffer as
typed, not the last saved version, so an idea can be tried before it is
committed — which is the point of having it here rather than in a terminal.

Nothing runs in this app or in your browser. The buffer is forwarded to a
sandbox you host, and the app shows what comes back: stdout, stderr, the exit
code and how long it took. A program stopped at the time limit says so rather
than looking like a crash.

**This needs a machine with Docker — Vercel cannot do it.** Until one is
configured there is no Run button at all, and nothing else about the editor
changes. Setup, limits and the shared token are in
[`runner/README.md`](runner/README.md); the languages installed by default are
Python, Java, C, C++, JavaScript, TypeScript, Bash, SQLite and R. The Run
button only appears for languages the sandbox actually has — the app asks it
rather than assuming.

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

Copies are capped at 50 MB per file, since the bytes pass through the server —
lower than the 95 MB upload cap, where the browser talks to GitHub directly.

## Chat

Each study group has a chat room on the **Study group** page. Your own group is
everyone you share your vault with; every vault shared with you is another room,
picked from the tabs above the messages.

There is still no database. A room is one issue titled *Study group chat* in
that vault's repository, and each message is a comment on it — so the people who
can read the vault are exactly the people who can read and post in the chat, and
GitHub keeps enforcing that. Nothing extra is granted: read-only access already
allows commenting, and it still does not allow touching any file.

The conversation is a normal GitHub thread, so it can be read and replied to on
github.com as well; the app picks up those replies within a few seconds. Rooms
are created the first time someone in the group opens the chat.

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
| Editor | Monaco, self-hosted from `public/monaco`; one commit per save |
| Storage | The GitHub Contents and Git Data APIs — no database |
| Reads | Proxied through `/api/file`, because vault repos are private |
| Multi-file upload | One blob per file, then a single tree + commit |
| Sharing | GitHub repo collaborators at `pull` permission |
| Chat | One issue per vault; messages are its comments |

Every write path targets the signed-in user's own vault. The `owner` parameter
that selects whose vault to *read* is deliberately ignored by writes, so no
request can be crafted to modify someone else's files. Chat is the one
exception, and deliberately so: posting into a friend's room is the whole point,
and GitHub refuses the comment unless they have actually shared that vault.

### One deliberate trade-off

File uploads go **from your browser straight to `api.github.com`**, not through
the server. A Vercel function caps request bodies at 4.5 MB, which a single set
of lecture slides comfortably exceeds.

That means the browser holds your OAuth token while uploading. It is fetched
from `/api/upload-session` (which requires your authenticated session), kept in
memory only, and never written to `localStorage`. This is the same approach
GitHub-backed editors such as Decap CMS take. Everything else — listing,
renaming, deleting, reading — stays server-side.

Individual files are capped at 95 MB, just under the 100 MB ceiling GitHub's
blob API enforces. There is no restriction on file *type* — PDFs, slides,
archives, code, recordings and anything else are all accepted; the ones the
browser understands get an inline preview, and the rest get a download button.

## Notes

- Removing a course removes it from `courses.json` only. The files stay in the
  repo, so a mis-click costs nothing.
- Deleting a *file* really does delete it from the working tree — but it remains
  in the git history, recoverable with `git log --diff-filter=D`.
- Images referenced from a note by bare filename (`![](diagram.png)`) resolve
  against that course's folder.
- A file written in the editor is an ordinary file too: rename it, move it to
  another course, delete it, or let a coursemate **Save a copy**. Saving from
  the browser is capped at 1 MB of text; a generated file bigger than that can
  still be uploaded, it just opens as a download rather than in the editor.
- HTML and SVG files are served with a sandbox `Content-Security-Policy`, so
  previewing one — including one out of a vault someone shared with you —
  cannot run script against your session.
- A note written in the app is just a file, so everything that works on files
  works on it: rename, move to another course, delete, and — for coursemates you
  have shared the vault with — read and **Save a copy**. The title becomes the
  filename, so "Week 1 summary" is stored as `week-1-summary.md`; non-ASCII
  titles are kept as they are. Notes are capped at 100 KB of text.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # serve the production build
npx eslint src  # lint
```
