# LearnIndia 🇮🇳 — Mission 1–4

Complete LearnIndia website with learning, progress, favourites, QR profile sharing, and online cross-device profiles.

## Mission 4 deployment requirement
For QR sharing to work between different phones, deploy this project as a **Node.js web service over HTTPS**. Do not open `index.html` with `file://`.

The included `render.yaml` is ready for a Node web service and persistent disk. After deployment, the same HTTPS origin serves the website and `/api/profile` API, so QR links automatically point to the live server.

### Render settings
- Build: `npm install`
- Start: `npm start`
- Health check: `/api/health`
- Persistent disk mounted at `/opt/render/project/src/data`

A managed database or persistent disk is required for profiles to survive server restarts/redeploys. The included JSON store is intentionally simple and suitable for this project; for very large scale, migrate the store to a managed database.

## Cross-device acceptance test
1. Phone A opens the live HTTPS LearnIndia URL.
2. Save a profile online and receive `LI-XXXXXXXX`.
3. Generate the QR.
4. Phone B scans the QR and sees the public profile from the server.
5. Change a public field on Phone A, save, then refresh Phone B.
6. Private email/phone remain hidden unless enabled.
7. Delete the profile from Phone A; Phone B can no longer retrieve it.
8. Restart the server and confirm the profile remains when persistent storage is enabled.

## Security
- Helmet security headers
- Rate limits for general API, writes, reads, and deletes
- Owner-key verification for updates/deletes
- Timing-safe owner-key comparison
- Public API only returns explicitly public fields
- Email/phone private by default
- Public profile responses are not cached
- Website URLs are restricted to HTTP/HTTPS
