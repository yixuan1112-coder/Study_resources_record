# The code runner

The vault's editor has a **Run** button. This folder is what answers it.

Nothing is executed by the app itself, and nothing is executed in the browser.
The editor posts the current buffer to `/api/run`, which forwards it to a
[Piston](https://github.com/engineer-man/piston) sandbox that you host. Piston
puts every program in its own throwaway container with no network and hard
CPU, memory, process and wall-clock limits, then hands back stdout, stderr and
the exit code.

**The Run button only appears for languages the sandbox actually has.** The app
asks it on load rather than assuming, so a runner with only Python installed
shows no Run button on a `.java` file, and a site with no runner at all shows
none at all — nothing else about the editor changes.

## 1. Start the sandbox

On a machine with Docker — not Vercel, which cannot run containers:

```sh
git clone https://github.com/yixuan1112-coder/Study_resources_record
cd Study_resources_record/runner
docker compose up -d
./install-packages.sh        # a few minutes; downloads each language
curl -s localhost:2000/api/v2/runtimes   # what it ended up with
```

`install-packages.sh` installs Python, Java, C/C++, Node, TypeScript, Bash,
SQLite and R. Add a line to widen it; `curl -s localhost:2000/api/v2/packages`
lists the 114 packages available.

Budget roughly 3 GB of disk and 1 GB of RAM for the set above.

## 2. Put it behind a token

Piston has no authentication of its own. Published as-is it is free compute for
anyone who finds it, so the compose file binds it to `127.0.0.1` and a reverse
proxy in front checks a shared secret.

Generate one:

```sh
openssl rand -hex 24
```

Then, in your Caddyfile:

```
run.example.com {
	# Piston has no auth; this header is the whole gate. Without it the
	# sandbox is an open code-execution endpoint.
	@authorized header X-Runner-Token "PASTE_THE_TOKEN_HERE"

	handle @authorized {
		reverse_proxy 127.0.0.1:2000
	}

	handle {
		respond "forbidden" 403
	}
}
```

Point `run.example.com` at the machine with a plain **A record, proxy off** —
behind Cloudflare's orange cloud the certificate handshake is with Cloudflare
rather than with your box, and Caddy cannot issue one.

## 3. Tell the app about it

Two environment variables, on the app (in the Vercel project settings, or in
`.env.local` for development):

```
RUNNER_URL=https://run.example.com
RUNNER_TOKEN=the-same-token
```

Neither is a `NEXT_PUBLIC_` variable: they are read in `/api/run` on the
server, so the sandbox's address and token never reach the browser and the
sandbox is not something a reader of the page source can drive directly.

Redeploy — Vercel does not apply new environment variables to an existing
deployment.

## What the limits are

Set in `src/app/api/run/route.ts`, and enforced by the sandbox rather than by
the app:

| | |
|---|---|
| Compile | 10 s |
| Run | 6 s |
| Memory | 256 MB |
| Source | 128 KB |
| Input (stdin) | 64 KB |
| Output shown | 100 000 characters |

A program stopped at the time limit is reported as such rather than as a
crash — usually an infinite loop, or one waiting on input that was never
typed into the box on the left.

## Checking it by hand

```sh
curl -s https://run.example.com/api/v2/execute \
  -H "X-Runner-Token: $RUNNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"language":"python","version":"3.12.0",
       "files":[{"name":"a.py","content":"print(input())"}],
       "stdin":"hello"}'
```

Without the header the same request must return 403. If it does not, the
sandbox is open to the internet.
