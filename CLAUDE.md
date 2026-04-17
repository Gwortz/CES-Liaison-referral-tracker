# Project Rules

## Owner
GitHub username: Gwortz

## Deployment Stack
- Frontend: Vite + React
- Styling: Tailwind CSS
- Package manager: npm
- Deployment target: Vercel

## GitHub Rules
- Always initialize a git repository at the start of every project
- Connect to GitHub via HTTPS using personal access token
- Remote URL format: https://github.com/Gwortz/[project-name].git
- After every significant feature or work session, commit and push to GitHub
- Write clear, descriptive commit messages explaining what was built or changed
- Always push to the main branch unless told otherwise

## Vercel Rules
- Always create a vercel.json file in the project root for SPA routing:
  {
    "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
  }
- Never hardcode API keys or secrets — always use environment variables
- All environment variables must use process.env.VARIABLE_NAME
- List all required env vars in a .env.example file with placeholder values
- Never commit .env files — always add to .gitignore
- For Vite projects, prefix client-side env vars with VITE_
- Build command: npm run build
- Output directory: dist (Vite) or .next (Next.js)

## File Structure
- All source code goes in /src
- Public assets go in /public
- Keep .env in .gitignore from the very start

## Code Rules
- Functional React components only, no class components
- Use async/await, not .then() chains
- No console.log statements in production code
- All API calls go in a separate /src/api folder

## Never Do This
- Don't hardcode API keys anywhere in the code
- Don't use the filesystem (fs) in frontend code
- Don't add long-running processes or WebSocket servers
- Don't use app.listen() or custom ports
- Don't install packages globally

## Start of Every New Project Checklist
1. Initialize git repository
2. Create .gitignore (include node_modules, .env, dist)
3. Create .env.example with placeholder values
4. Create vercel.json with SPA rewrite rule
5. Create this CLAUDE.md file
6. Do initial commit and push to GitHub
7. Remind me to connect the repo to Vercel dashboard

## This Project: CES Liaison Referral Tracker

### Architecture
- Frontend: Vite + React + Tailwind (in `/src`)
- Backend: Express app in `/server`, exposed via `/api/index.js` as a single Vercel serverless function
- Storage: JSON file (`server/data/users.json`). On Vercel, seeded into `/tmp` per cold start (ephemeral)
- Auth: bcryptjs password hashes + JWT tokens
- PDF: pdfkit
- Excel: xlsx (SheetJS)

### Default admin
- Username `admin`, password `admin123`, forced to change on first login

### Dev commands
- `npm run dev` — runs Vite (5173) and Express (3001) concurrently; Vite proxies `/api` to 3001
- `npm run build` — builds Vite frontend into `dist`
- `npm run preview` — preview the built frontend

### Key data rules
- Two markets analyzed independently: Lexington, Louisville
- Exclude blank provider names and any containing "No Referring Phys"
- Normalize provider names via title-case + whitespace trim
- Minimum threshold: ≥ 6 eyes across ≥ 3 months
- No patient data stored — only provider names and referral counts

### Vercel deployment note
- The Express app is invoked per-request via `/api/index.js`
- `users.json` persistence on Vercel is limited to `/tmp` (resets between cold starts).
  For real production use, swap `server/lib/storage.js` to a durable store (Vercel KV, Postgres, etc.)
