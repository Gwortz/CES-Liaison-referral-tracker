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
