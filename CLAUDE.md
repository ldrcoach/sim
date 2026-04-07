# OBLD 500 Leadership Simulation Suite - Claude Code Instructions

## Project Overview

AI-powered observation and practice simulations for OBLD 500 (Leadership in Organizations) at ERAU. 54 scenarios across 9 weeks: 27 observations (AI demonstrations) + 27 simulations (interactive with rubric scoring). 81 unique characters. Live at sim.ldrcoach.com.

## Tech Stack

- Frontend: React (Vite build), JSX
- Backend: Express API proxy + persistence endpoints
- AI: Anthropic Claude API for character conversations
- Database: PostgreSQL for student scores and transcripts
- Deployment: DigitalOcean droplet, Nginx reverse proxy

## Repository Structure

```
client/             # React frontend (Vite build)
  src/
    App.jsx         # Unified landing page + router
    suites/         # 4 suite components (simulations + observations)
server/             # Express API proxy + persistence
  index.js          # Proxies /api/chat to Anthropic, persistence endpoints
nginx/              # Reverse proxy config
setup.sh            # Droplet provisioning script
```

## Commands

```bash
# Dev
cd client && npm run dev      # Frontend dev server
cd server && node index.js    # Backend server

# Build
cd client && npm run build    # Production build

# Deploy
bash setup.sh                 # Provision droplet
```

## Cortex Integration

LDRC Cortex (MCP server) is available in all Claude Code sessions. Use it to track development context:

- **Session start:** Call `cortex_session_load(project_id="sim")` at the start of each session
- **Decisions:** Call `cortex_decide(project_id="sim", ...)` when making architecture or design decisions
- **Errors:** Errors are auto-logged via hook. For significant bugs, also call `cortex_log_error(project_id="sim", ...)`
- **Changelog:** Call `cortex_changelog_add(project_id="sim", ...)` after completing features or fixes
- **Session end:** Call `cortex_session_end(...)` with summary and outcome when wrapping up
