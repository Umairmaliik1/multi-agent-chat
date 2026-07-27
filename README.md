# Run and deploy Multi Agent Chat

This contains everything you need to run your app locally.

## Run Locally

Prerequisites:
- Node.js 18+
- PostgreSQL 13+

1. Install dependencies:
   `npm install`
2. Configure environment variables:
   - Backend (server): create `.env` with
     - `DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/multi_agent_chat`
     - `PORT=4000` (optional)
     - `GEMINI_API_KEY=your_gemini_key` (optional, for Gemini models)
     - `OPENAI_API_KEY=your_openai_key` (optional, for OpenAI models)
     - `ANTHROPIC_API_KEY=your_anthropic_key` (optional, for Anthropic models)
   - Frontend (Vite): create `.env.local` with
     - `VITE_API_BASE=http://localhost:4000`
3. Start the backend API server:
   `npm run server`
4. In a separate terminal, run the frontend:
   `npm run dev`
5. Open the app at the URL Vite prints (typically http://localhost:5173). The app will now load agents and chats from the backend instead of browser localStorage.

### API Endpoints (JWT protected)
- POST   /api/auth/login            (no auth) → { token, user }
- GET    /api/auth/me               (auth)
- GET    /api/agents                (auth)
- POST   /api/agents                (auth)
- PUT    /api/agents/:id            (auth)
- DELETE /api/agents/:id            (auth)
- POST   /api/agents/:id/duplicate  (auth)
- GET    /api/agents/:agentId/conversations          (auth)
- PUT    /api/agents/:agentId/conversations          (auth, replace all for agent)
- POST   /api/agents/:agentId/conversations          (auth, create one)
- POST   /api/chat/stream           (auth) unified server-side streaming proxy; selects provider/model per agent; streams NDJSON lines with `{ "text": "..." }` and a final `{ "done": true }`
  - Attachments: You can attach up to 10 files per message. Max size per file is 50 MB. The endpoint accepts either `application/json` or `multipart/form-data`:
    - JSON body: `{ agent, messages }` (text-only)
    - Multipart body: fields `agent` (JSON string), `messages` (JSON string), and one or more `files` parts
    - Provider support: Gemini supports images and many file types via inline data; Anthropic supports images in this mode. Non-image files sent to Anthropic will be noted in the conversation but not analyzed.


## Run with Docker Compose

Prerequisites:
- Docker 24+
- Docker Compose v2

Services:
- frontend: built with Vite and served by Nginx on http://localhost:8080
- backend: Express API on http://localhost:4000
- db: PostgreSQL 16 with persisted volume

Quick start:
1. Build and start all services:
   docker compose up --build -d
2. Open the app:
   http://localhost:8080
3. API is available at:
   http://localhost:4000

Stopping and cleanup:
- Stop services:
  docker compose down
- Stop and remove database volume (erases all data):
  docker compose down -v

Configuration notes:
- Docker Compose reads variables from the project .env file. You can customize ports and credentials there without editing docker-compose.yml.
- Default values in .env (you can change them):
  - DATABASE_USER=postgres
  - DATABASE_PASS=postgres
  - DATABASE_NAME=multi_agent_chat
  - DATABASE_HOST_PORT=5433   # host port exposed
  - DATABASE_INTERNAL_PORT=5432 # container port and backend connection port
  - SERVER_PORT=4000
  - NODE_ENV=production
  - FRONTEND_PORT=8080
  - VITE_API_BASE=http://localhost:4000
- Backend connection inside Compose targets the db service and uses the internal port; no hardcoded values remain in docker-compose.yml.
- Streaming features and model providers:
  - Set the relevant API keys for the backend: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. In Docker Compose, these are read from your project `.env` and passed to the backend service.
  - The frontend never needs provider API keys; it calls the unified backend streaming proxy at `/api/chat/stream`, and the backend uses the agent's selected model to choose the provider.
