# PromptPre's Pilot

Use a dedicated Windows GPU host and a private Tailscale Serve endpoint. The host OS account and other processes on that host are trusted. Do not forward port 8000, use Funnel, or expose Vite. Restrict the Tailnet policy to the invited users and HTTPS on this host.

1. In a Python 3.13 virtual environment install `worker/requirements-windows.lock`. Install FFmpeg and the existing model files. In `web/`, run `npm ci` and `npm run build`.
2. Keep the allowlist outside Git, readable only by the operator. Format: `{"person@example.test":"P01"}`. Pseudonyms must be unique and stable. Set `PROMPTPRES_PILOT_ALLOWLIST` to its absolute path and `PROMPTPRES_PILOT_ORIGIN` to the exact Serve HTTPS origin. Restart after changing the allowlist.
3. From the repo root run `python pilot.py`. It uses loopback port 8000 and a separate SQLite database and storage under `data/pilot/`. Apply Windows file permissions before using real data. No existing sessions are copied.
4. On the designated host, configure private [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) to proxy `http://127.0.0.1:8000`. Confirm the two invited accounts get separate histories and cannot open each other's result or media; test with a 20-minute recording, seeking, and a cancelled upload. Confirm no direct connection to port 8000 from a separate machine.
5. OpenRouter is off by default. Before setting `PROMPTPRES_PILOT_LLM=approved`, obtain approval for the disclosure covering PDF text and transcripts, confirm the provider's data handling, and configure a dedicated key with a provider-side budget of at most USD 10/month. With it off, use manual topics; C1/C2 are unavailable without the LLM.
6. To remove a round, stop Serve and stop Pilot, then run `python pilot.py --delete-round SESSION_ID`. Apply the same retention/withdrawal policy to exports and backups. Review the queue, disk usage, and OpenRouter usage during the trial. If access or data handling fails, disable Serve and stop accepting jobs.

The app caps video at 512 MiB and 30 minutes; PDFs at 30 MiB. Keep the disk available for multipart staging, copies, and analysis artifacts. API/worker tests verify the application boundary with synthetic accounts; they do not validate the actual Tailnet configuration.
