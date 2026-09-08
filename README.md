# Stonks

Stonks is an AI-powered stock research and paper-trading platform. It combines live market data, historical charts, financial news, portfolio tracking, price alerts, and a context-aware AI assistant in one dashboard.

The project is designed for learning and experimentation. Trades made through Stonks are virtual and do not involve real money.

## Features

- Live stock prices and market movements
- Historical price charts and technical-analysis views
- Stock search, filtering, comparison, and wishlists
- Virtual wallet and paper-trading portfolio
- Portfolio holdings and transaction history
- Real-time financial news
- Custom price alerts with email and browser notifications
- AI-powered market and stock explanations
- Context-aware AI chat using market data, news, portfolio data, and conversation memory
- AI-created alerts and market observations
- Confirmation-gated AI paper trades
- Secure authentication using JWT access and refresh tokens
- Responsive dark-themed interface

## AI Safety

The AI assistant does not execute paper trades immediately.

When a user requests a trade:

1. The assistant prepares the proposed order.
2. Stonks retrieves the latest available market price.
3. A confirmation link is sent to the account email.
4. The link expires after 15 minutes.
5. The order is executed only after the user approves it.

This keeps the AI useful while ensuring that the user remains in control of every action.

## Tech Stack

### Frontend

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Radix UI
- Recharts
- Framer Motion
- Lucide React

### Backend

- Next.js API routes
- Express
- Socket.IO
- MySQL
- JWT authentication
- Zod validation

### AI and Search

- Google Gemini
- LangChain
- Optional locally fine-tuned Qwen model
- Chroma vector database
- BAAI BGE embeddings
- Retrieval-augmented generation

### External Services

- Finnhub
- Twelve Data
- NewsAPI
- Hugging Face
- SendGrid
- Railway
- Vercel Analytics

## Architecture

```text
Browser
   │
   ▼
Next.js application
   ├── Authentication APIs
   ├── Market-data APIs
   ├── News APIs
   ├── Portfolio and wallet APIs
   ├── Alert and observation APIs
   └── AI assistant APIs
          │
          ├── Gemini or local fine-tuned model
          ├── Chroma semantic memory
          ├── Live stock and news context
          └── Confirmation-gated actions
   │
   ├── MySQL database
   ├── Finnhub / Twelve Data / NewsAPI
   ├── SendGrid
   └── Socket.IO notifications
```

## Project Structure

```text
app/
├── api/                         Backend API routes
├── agent/confirm/               Paper-trade confirmation page
├── dashboard/
│   ├── ai/                      AI market assistant
│   ├── alerts/                  Price alerts
│   ├── compare/                 Stock comparison
│   ├── news/                    Financial news
│   ├── observations/            Time-based market observations
│   ├── portfolio/               Holdings and portfolio analytics
│   ├── stocks/                  Stock discovery and detail pages
│   └── transactions/            Paper-trade history
├── login/                       User login
└── signup/                      Account registration

components/                      Shared React components
hooks/                           Custom React hooks
public/                          Static assets
scripts/                         Database and integration utilities
ml_service/                      Optional local AI model service
server.js                        Express and Socket.IO server
```

## Prerequisites

Before running the project, install:

- Node.js 20 or later
- npm or pnpm
- MySQL 8 or later
- Python 3.10 or later, only if using the local AI model
- Chroma, only if semantic vector memory is required

You will also need API credentials for the external services you want to enable.

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Raghav6753123/Stock.git
cd Stock
```

### 2. Install dependencies

Using npm:

```bash
npm install
```

Or using pnpm:

```bash
pnpm install
```

### 3. Configure the environment

Create a local environment file from the example:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Update the values in `.env` with your database credentials, authentication secrets, and provider API keys.

Never commit your real secrets to Git.

### 4. Configure MySQL

Create a database named `stonks`, or provide the name of an existing database through the environment variables.

For local development, automatic table creation can be enabled temporarily:

```env
AUTO_MIGRATE_DB=1
AUTO_MIGRATE_AUTH=1
```

After the required tables have been created, disable automatic migrations in production:

```env
AUTO_MIGRATE_DB=0
AUTO_MIGRATE_AUTH=0
```

### 5. Start the application

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Environment Variables

Use `.env.example` as the source of truth.

### Database

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASS=
DB_NAME=stonks
```

A Railway MySQL connection URL can also be used when configured by the application.

### Authentication

Generate two different long, random secrets:

```env
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
```

### Market and News Providers

```env
FINNHUB_API_KEY=
TWELVE_DATA_API_KEY=
NEWS_API_KEY=
```

### AI Provider

```env
GEMINI_API_KEY=
CHAT_MODEL_PROVIDER=gemini
CHAT_MODEL_ENABLE_FALLBACK=true
```

### Semantic Search

```env
HF_TOKEN=
CHROMA_URL=
BGE_MODEL=BAAI/bge-small-en-v1.5
```

Chroma is optional. When it is configured, Stonks stores and retrieves relevant stock, news, portfolio, and chat context using BGE embeddings.

### Email Confirmation

```env
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
APP_URL=http://localhost:3000
```

These variables are required for confirmation-gated AI paper trades and email alerts.

### Alert Monitoring

```env
ALERT_MONITOR_SECRET=
```

Use a strong secret to protect the alert-monitoring endpoint.

## AI Model Options

### Gemini

Gemini is the simplest provider to run:

```env
CHAT_MODEL_PROVIDER=gemini
GEMINI_API_KEY=your_key
```

### Local Fine-Tuned Model

Stonks can use a local LoRA adapter based on Qwen.

Place the model files in:

```text
models/chatbot/stock-chat-qwen3-lora-final/
```

Required files include:

```text
adapter_config.json
adapter_model.safetensors
tokenizer.json
tokenizer_config.json
```

Configure the provider:

```env
CHAT_MODEL_PROVIDER=local_finetuned
CHAT_MODEL_FALLBACK_PROVIDER=gemini
CHAT_MODEL_ENABLE_FALLBACK=true
LOCAL_CHAT_BASE_MODEL=unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit
LOCAL_CHAT_ADAPTER_PATH=models/chatbot/stock-chat-qwen3-lora-final
ML_SERVICE_URL=http://localhost:8001
```

Install and start the Python service:

```bash
cd ml_service
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

The rest of the application remains available if the local model is disabled.

## Available Scripts

```bash
npm run dev
```

Starts the development server.

```bash
npm run build
```

Creates a production build.

```bash
npm run start
```

Starts the production server.

```bash
npm run lint
```

Runs ESLint.

```bash
npm run db:view-all
```

Displays application database records for local debugging.

```bash
npm run db:delete-users
```

Deletes users from the configured development database. Use this command carefully.

## Main API Routes

| Route | Purpose |
|---|---|
| `/api/signup` | Create an account |
| `/api/signin` | Authenticate a user |
| `/api/auth/refresh` | Refresh authentication |
| `/api/auth/logout` | Sign out |
| `/api/market/stocks` | Retrieve available stocks |
| `/api/market/realtime` | Retrieve real-time prices |
| `/api/market/history` | Retrieve historical prices |
| `/api/market/compare` | Compare stocks |
| `/api/news/realtime` | Retrieve financial news |
| `/api/wallet` | Manage the virtual wallet |
| `/api/portfolio` | Manage holdings and paper trades |
| `/api/alerts` | Manage price alerts |
| `/api/observations` | Manage market observations |
| `/api/ai/chat` | Communicate with the AI assistant |
| `/api/ai/action` | Prepare AI-requested actions |
| `/api/ai/trade-confirm` | Confirm or reject an AI paper trade |
| `/api/alerts/monitor` | Check pending price alerts |

## Deployment

### Vercel

1. Push the repository to GitHub.
2. Import it into Vercel.
3. Select the Next.js framework preset.
4. Add the variables from `.env.example`.
5. Connect a production MySQL database.
6. Deploy the project.

Verify the following routes after deployment:

```text
/dashboard
/dashboard/stocks
/api/market/stocks
/api/news/realtime
```

### Railway

Railway can be used for:

- MySQL hosting
- The Next.js application
- The optional Python ML service
- Chroma or another supporting service

Set `APP_URL` to the public application URL so email confirmation links point to the deployed website.

## Troubleshooting

### Authentication APIs return errors

Check:

- MySQL connectivity
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- Authentication database tables

### Market prices or charts are empty

Check:

- `FINNHUB_API_KEY`
- `TWELVE_DATA_API_KEY`
- Provider request limits
- Supported stock symbols

### News is unavailable

Check `NEWS_API_KEY` and the provider’s usage limits.

### AI chat is unavailable

Check:

- `GEMINI_API_KEY`
- `CHAT_MODEL_PROVIDER`
- `ML_SERVICE_URL` when using the local model
- `HF_TOKEN` when using hosted embeddings
- `CHROMA_URL` when semantic memory is enabled

### Confirmation emails are not arriving

Check:

- `SENDGRID_API_KEY`
- `SENDGRID_FROM_EMAIL`
- SendGrid sender verification
- Spam or junk folders
- The production value of `APP_URL`

## Security Notes

- Store secrets only in local environment files or deployment secrets.
- Use different access-token and refresh-token secrets.
- Disable automatic database migrations after production setup.
- Protect the alert monitor with `ALERT_MONITOR_SECRET`.
- Rotate any credential that has been exposed.
- Do not use production credentials in test environments.

## Disclaimer

Stonks is an educational market-research and paper-trading project. It does not provide financial advice, execute real brokerage orders, or guarantee the accuracy of market data, news, or AI-generated content.

Always verify financial information independently before making investment decisions.

## Repository

[github.com/Raghav6753123/Stock](https://github.com/Raghav6753123/Stock)
