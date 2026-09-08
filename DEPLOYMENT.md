# Deployment

The frontend is a static Vite build hosted on Vercel, published from `main`.

## Why `vercel.json` looks the way it does

The rewrite sends every path to `index.html`. The app routes on the client,
so without it, opening or refreshing a URL like `/project/123` asks the host
for a file that does not exist and returns 404.

`/api/` is excluded from the rewrite so a missing endpoint fails visibly
rather than quietly returning the HTML page.

Note that `vercel.json` is JSON, which has no comment syntax, and Vercel
rejects unknown properties -- explanations belong here, not in the file.

## Required environment variables

Set these in Vercel under Settings -> Environment Variables:

    VITE_SUPABASE_URL                 https://<project-ref>.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY     sb_publishable_...

The publishable key is meant to ship in the browser bundle; it grants nothing
on its own, because every table is protected by row level security. The
`service_role` key must never be set here.

## What is not hosted

`server.ts` exists only to send invitation emails through Resend. It is not
deployed, so invitation emails are not sent -- the admin screen still shows
the invitation link to copy, which is what actually grants access.

## Package manager

This project uses npm. It previously also carried a `bun.lock` left over from
AI Studio, which had drifted badly out of date; Vercel detected it, installed
with Bun, and resolved the wrong dependency set. If a lockfile for another
package manager reappears, delete it rather than trying to keep both current.
