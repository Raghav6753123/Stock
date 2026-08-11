from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether

OUT = Path('output/pdf/stonks_conceptual_interview_guide.pdf')
OUT.parent.mkdir(parents=True, exist_ok=True)

S = [
('1. Project Overview and Architecture', [
('What problem does Stonks solve?', 'Stonks is a stock-dashboard and portfolio-simulation application. It helps users view market data, track virtual holdings and cash, receive AI-assisted insights, read news, and explore ML-based predictions in one place.'),
('Explain the project in one minute to an interviewer.', 'The frontend is built with Next.js and React. Next.js route handlers provide APIs for authentication, market data, portfolios, news, and AI chat. MySQL stores users and portfolio data; a FastAPI service handles Python ML models; Chroma supports semantic retrieval for the AI chatbot.'),
('Why did you use Next.js?', 'It lets us build the UI and backend-for-frontend in the same project. It supports React-based pages, server APIs, routing, and production deployment without managing a separate Node backend at the beginning.'),
('What are the main modules of the project?', 'The main modules are authentication, dashboard, market/stocks, portfolio and wallet, transactions, news, AI chat, buy-signal prediction, end-of-day prediction, and portfolio rating.'),
('How do frontend and backend communicate?', 'React pages call Next.js API routes using HTTP. The routes validate requests, call the database or external providers/ML service, and return JSON used by the UI.'),
('Why is the ML part separated into FastAPI?', 'The trained models and their Python libraries are easier to run in Python. Keeping them separate also prevents heavy model loading from slowing or complicating the Next.js server.'),
('What would you improve if the app gets many users?', 'I would introduce shared caching for market data, rate limits, managed database connection pooling, queues for slow work, monitoring, and independently scale the ML service.'),
('What is the role of environment variables?', 'They keep database credentials, JWT secrets, and provider keys out of source code. Different environments can use different values without code changes.'),
('Why are API routes useful instead of calling providers directly from the browser?', 'They hide API keys, centralize validation and error handling, apply caching and rate limits, and allow us to normalize data from different providers before the UI sees it.'),
('If an interviewer asks about limitations, what would you say?', 'It is an educational/simulation-focused application. Market-data quality depends on providers, models cover limited tickers, and AI output is informative rather than financial advice.'),
]),
('2. UI, Dashboard and State', [
('What does the dashboard show?', 'It acts as the user’s home screen for important information such as market movements, portfolio summary, quick navigation, and AI-driven features.'),
('Why do some React components need to be client components?', 'Interactive features such as buttons, forms, charts, theme switching, and browser localStorage need client-side JavaScript. Non-interactive data rendering can stay server-side.'),
('How is the wishlist handled?', 'The wishlist hook stores selected ticker symbols in browser localStorage. This is simple and fast for a personal UI preference, but it does not synchronize across devices.'),
('What would you do if users request wishlist sync across devices?', 'Move it from localStorage to a user-owned database table, secure it with authentication, and load/save it through an API.'),
('How would you handle a slow dashboard?', 'Load important summary data first, show loading/skeleton states, cache market data, avoid duplicate requests, and lazy-load less important charts or sections.'),
('Why are loading and error states important?', 'External APIs and models can fail or be slow. Clear loading/error states prevent users from seeing a blank or misleading screen and tell them whether data is unavailable or simply delayed.'),
('How would you make the interface accessible?', 'Use semantic HTML, labels for inputs, keyboard navigation, visible focus states, sufficient contrast, meaningful chart alternatives, and screen-reader-friendly error messages.'),
('What if a user refreshes a page while submitting a trade?', 'The backend should protect against duplicate trade execution using an idempotency key or stored request ID. The UI alone cannot guarantee this.'),
('How do you keep API response shapes consistent?', 'Define clear JSON contracts, validate inputs and outputs, centralize shared types/schemas where possible, and add tests for important API responses.'),
('How would you explain dark mode/theme support?', 'A theme provider manages the selected theme and applies the appropriate CSS class. The preference can be stored so the experience remains consistent after reload.'),
]),
('3. Authentication and User Security', [
('How does a new user create an account?', 'The signup API validates name, email, and password; checks that email is not already used; hashes the password; creates the user; then issues authentication cookies.'),
('Why should passwords never be stored directly?', 'If the database is exposed, plain passwords immediately compromise every account. Password hashes are one-way values, so the server compares a login password to the hash instead.'),
('What is bcrypt doing in this project?', 'bcrypt hashes passwords using a deliberately expensive algorithm. This slows attackers trying large numbers of guessed passwords after a data leak.'),
('What are access and refresh tokens?', 'The access token is short-lived and used to prove identity for normal requests. The refresh token lasts longer and is used to create a new access token without asking the user to sign in again.'),
('Why use cookies for tokens?', 'HttpOnly cookies reduce the chance that browser JavaScript can steal tokens through XSS. They are sent automatically with requests, so the server can authenticate the user.'),
('What happens during login?', 'The server finds the user by email, compares the supplied password using bcrypt, creates signed tokens, stores a hash of the refresh token, and sends auth cookies back to the browser.'),
('How does the dashboard know a user is logged in?', 'The proxy checks authentication cookies before dashboard routes are served. Protected API routes also verify the access token before returning private data.'),
('What if the user gives a wrong password?', 'The app returns a generic invalid-email-or-password response. This is safer than revealing whether the email exists.'),
('What if a token expires while the user is active?', 'A refresh flow should verify the refresh token and issue a new access token. If refresh is invalid or expired, the user is sent to login.'),
('How would you make login more secure later?', 'Add rate limiting, password rules, email verification, MFA, device/session management, audit logs, and immediate token revocation for suspicious activity.'),
]),
('4. Database, Wallet and Portfolio', [
('What does MySQL store in Stonks?', 'It stores durable user information, password/refresh-token data, wallet balances, portfolio holdings, and transaction history.'),
('What is the difference between wallet, holdings, and transactions?', 'Wallet is unused virtual cash. Holdings are current positions such as quantity and average price. Transactions are the historical BUY and SELL records that explain how the portfolio changed.'),
('Explain a BUY transaction flow.', 'The API authenticates the user, validates symbol, quantity, and price, checks the wallet balance, subtracts the trade cost, creates or updates the holding, records the transaction, and commits all changes together.'),
('Explain a SELL transaction flow.', 'The API confirms the user owns enough quantity, reduces or removes the holding, adds sale value to wallet cash, calculates realized P&L using average cost, records the sale, and commits it.'),
('Why is a database transaction used?', 'A trade changes several records. A transaction ensures they all succeed together or all roll back, so balance, holdings, and history cannot disagree.'),
('Why do we lock wallet and holding rows during trading?', 'A lock prevents two requests from reading the same balance or quantity at the same time. Without it, simultaneous requests could spend the same cash twice or sell more shares than held.'),
('What is average buy price?', 'It is the weighted average amount paid per share for a holding. Buying more shares at another price changes the average based on both quantities and costs.'),
('What is realized P&L?', 'It is the profit or loss that becomes final when shares are sold. For a sale, it is approximately sale price minus average cost, multiplied by sold quantity.'),
('What is unrealized P&L?', 'It is the current paper gain or loss on shares still held, based on their latest market value compared with their cost basis.'),
('What would you add for a real brokerage product?', 'Broker order integration, server-side executable quotes, order states, partial fills, fees, settlements, compliance controls, audits, stronger decimal accounting, and regulatory requirements.'),
]),
('5. Market Data and News', [
('Where does stock data come from?', 'The project integrates market-data providers such as Finnhub and Twelve Data through server-side helper modules and normalizes data for the rest of the app.'),
('Why use more than one market-data provider?', 'Providers can have different coverage, quotas, latency, or outages. Multiple providers allow fallback, but the app must clearly identify data source and freshness.'),
('What does real-time data mean in this project?', 'It means the app attempts to request current quotes. The exact delay depends on the provider plan and market conditions, so the UI should not claim instant exchange-level execution data unless guaranteed.'),
('What should happen if a market provider is unavailable?', 'The route should fail gracefully: use recent cached data when safe, show its timestamp, use a backup provider if configured, and avoid displaying invented prices.'),
('Why should the app show data freshness?', 'A price from several minutes ago may be useful for learning but risky for decisions. A timestamp and live/stale label let the user judge reliability.'),
('What is API rate limiting?', 'External providers restrict how many requests can be made in a time window. The app should cache and share results to avoid hitting limits for every individual user request.'),
('How can caching help market data?', 'A short-lived cache can serve the same quote to many users, reduce latency and provider cost, and refresh in the background when it becomes stale.'),
('How is news useful in a stock dashboard?', 'News provides context for price moves and lets users explore company and market events. Sentiment is an additional signal, not proof that a stock will rise or fall.'),
('What does news sentiment mean?', 'It estimates whether wording is positive, negative, or neutral. It captures text tone, but it can miss nuance, sarcasm, relevance, and the difference between sentiment and market impact.'),
('What if news has misleading information?', 'The app should show source and URL, avoid treating any article as fact, add clear disclaimers, and ensure the AI does not overstate claims from a single item.'),
]),
('6. AI Chatbot and Chroma', [
('What is the purpose of the AI chatbot?', 'It lets users ask natural-language questions about available stock data, news, and previous conversation context, making the dashboard easier to explore.'),
('What is RAG in simple terms?', 'Retrieval-Augmented Generation means the app first finds relevant stored information, then gives that information to the language model so its answer is grounded in current project data.'),
('What is Chroma used for?', 'Chroma is the vector database used to store and search semantic representations of stocks, news, chat turns, and portfolio snapshots.'),
('Why not send every stock and news article to the AI model?', 'It would be slow, costly, and may exceed the model context limit. Retrieval chooses a smaller set of information that is likely relevant to the question.'),
('What are embeddings?', 'Embeddings are numeric representations of text meaning. Similar meanings tend to have nearby vectors, allowing the app to retrieve related text even when wording differs.'),
('How does the chatbot answer a question?', 'It validates the prompt, retrieves market/news/chat context, sends a structured prompt with that context to the configured model, stores the conversation turn, and returns the answer and metadata.'),
('Why is chat history stored?', 'It allows continuity, so follow-up questions can use relevant earlier conversation. History needs limits, privacy controls, and a clear retention policy.'),
('What if Chroma is unavailable?', 'The project has a fallback path. In production, a shared durable vector store is preferable because local or in-memory fallback data can disappear or differ between servers.'),
('Why should the chatbot not give guaranteed investment advice?', 'Language models can be wrong, incomplete, or influenced by unreliable context. The chatbot should explain uncertainty, cite available sources, and present educational information rather than promises.'),
('What is prompt injection, and how would you reduce it?', 'It is when untrusted content tries to manipulate model instructions, for example a news item saying “ignore rules.” Treat retrieved content as data, limit sensitive context, and enforce important rules in application code.'),
]),
('7. Machine Learning Features', [
('What ML features are included?', 'The project includes end-of-day price prediction, a buy-signal predictor, portfolio rating, news sentiment analysis, and support for a chatbot model/provider.'),
('What is the end-of-day predictor?', 'It estimates a future end-of-day price for supported tickers. It is a model-based estimate, not a guaranteed future price.'),
('Why are only AAPL and TSLA supported for EOD prediction?', 'The deployed model artifacts and preprocessing pipelines were trained for those tickers. Limiting the API prevents the system from pretending it can accurately predict unsupported stocks.'),
('What is a buy-signal predictor?', 'It turns trained-model output into a BUY or SELL-style signal with supporting predicted values. It should be treated as a research/learning indicator, not a command to trade.'),
('How is a prediction different from a recommendation?', 'A prediction is an uncertain estimate from historical patterns. A recommendation includes suitability, risk, objectives, regulation, and accountability; this application should not imply that level of personalized advice.'),
('What data can influence stock models?', 'Typical features include past prices, volume, technical indicators, and sometimes news-related signals. Only data available at the prediction time should be used.'),
('Why does model accuracy not guarantee profit?', 'Markets change, incorrect predictions can be costly, and fees, slippage, position size, and risk management affect actual returns. A model can have decent accuracy but poor trading results.'),
('What is overfitting?', 'Overfitting occurs when a model memorizes historical noise rather than learning patterns that generalize. It can look strong in training but perform poorly on unseen future data.'),
('Why is a separate ML service useful operationally?', 'It allows Python packages and models to be deployed, monitored, restarted, and scaled independently from the web application.'),
('What should happen if ML inference fails?', 'Return a clear unavailable/error state or a clearly labelled simple fallback where appropriate. Never silently present a fallback as if it were the trained-model result.'),
]),
('8. Scenarios and Problem Solving', [
('Scenario: two BUY clicks happen quickly. What concern do you raise?', 'The trade might be duplicated. Disable repeated UI submission, but more importantly enforce an idempotency key and transaction-safe backend logic.'),
('Scenario: a user has Rs.1,000 and sends two Rs.800 buy requests. How is this prevented?', 'The database transaction locks the wallet row. The first request updates it; the second waits, sees the new balance, and is rejected for insufficient funds.'),
('Scenario: the quote API starts returning old prices. What do you do?', 'Compare provider timestamps, mark the result stale, show the last-known time, stop calling it live data, and use cache/backup provider only if it meets a defined freshness rule.'),
('Scenario: Gemini is down during chat.', 'Catch the failure with a timeout, optionally try a configured provider fallback, show a friendly retry message if both fail, and log the provider failure for monitoring.'),
('Scenario: the user asks the chatbot, “Should I invest my savings in one stock?”', 'The assistant should avoid personalized financial advice, explain concentration risk generally, encourage diversification and independent research, and state the answer is educational.'),
('Scenario: a user says they saw a different price on another website.', 'Explain that quotes may differ by provider, exchange, currency, delay, and regular versus after-hours session. Show source and as-of time so the discrepancy can be investigated.'),
('Scenario: users complain chat answers are slow.', 'Measure each stage: market/news fetch, embedding generation, Chroma retrieval, model inference, and storage. Then cache, reduce retrieval/context, stream output, or improve provider capacity based on evidence.'),
('Scenario: one user accesses another user’s chat session ID.', 'That is an authorization flaw. The backend must derive ownership from the verified user token and filter all chat data by owner, not trust a session ID from the browser.'),
('Scenario: database write succeeds but browser loses connection.', 'The user may retry even though the trade already happened. An idempotency key lets the server return the earlier result instead of processing a second order.'),
('Scenario: the app is deployed to Vercel but Python models do not work.', 'Run FastAPI as a separate deployed service, expose a protected internal URL such as PY_AI_SERVICE_URL, add health checks, and let Next.js forward prediction requests to it.'),
]),
('9. Testing, Deployment and Reliability', [
('What would you unit test first?', 'Input validation, weighted-average price logic, P&L calculations, token helpers, data normalization, and error-handling helpers because they are deterministic and high impact.'),
('What integration tests are important?', 'Test signup/login against a test database, authenticated portfolio fetches, trade commits/rollbacks, and API interaction with a test ML service or realistic mock.'),
('How would you test a BUY transaction?', 'Start with a known wallet balance, submit a valid trade, then verify the wallet decreased correctly, holding quantity/average price are correct, and a transaction row exists.'),
('How would you test failure of a trade?', 'Try insufficient funds, invalid quantity, invalid price, overselling, and forced database failure. Verify no partial wallet or holding changes remain.'),
('Why test external API failures?', 'Provider outages, rate limits, malformed responses, and slow calls are normal production situations. Testing them ensures the UI shows an honest fallback rather than crashing.'),
('What is a health endpoint?', 'It is a small endpoint, such as FastAPI /health, that infrastructure can call to check whether a service is alive and ready to receive requests.'),
('How would you deploy this project?', 'Deploy the Next.js app to a web platform such as Vercel, provision MySQL and Chroma/shared services, deploy FastAPI separately, and configure production environment variables securely.'),
('What should be monitored?', 'Error rate, request latency, provider failures, quote freshness, login failures, database connection/lock issues, chat fallback rate, ML latency, and unusual transaction activity.'),
('Why should logs avoid sensitive values?', 'Logs are widely accessible during support and may be retained. Do not log passwords, tokens, secret keys, or unnecessary personal and portfolio details.'),
('What is graceful degradation?', 'When a non-critical dependency fails, the product remains useful with an honest reduced experience, for example cached quote data marked with its time instead of a broken dashboard.'),
]),
('10. Deep Dive and Reflection', [
('What is the strongest technical part of this project?', 'It combines a realistic end-to-end product flow: secure user accounts, transactional portfolio simulation, external market/news data, Python ML, and AI retrieval in one coherent application.'),
('What was the most challenging integration?', 'The AI and market-data path is challenging because it combines several unreliable external dependencies, timeouts, retrieval, model providers, and user-facing latency expectations.'),
('How do you explain data flow for a chat answer?', 'User question goes to the Next.js chat API; it obtains relevant stock/news/history context from provider APIs and Chroma; the model produces an answer; the system stores the new turn and returns it to the UI.'),
('How do you explain data flow for a trade?', 'User submits a trade form; the portfolio API verifies identity and input; MySQL transaction checks and locks current balance/holding; it updates wallet and position, writes history, commits, and returns the new result.'),
('What security concern would you improve first?', 'Ensure every private route is consistently authenticated and authorized, especially user-owned chat/portfolio resources; then add rate limits and robust refresh-token session management.'),
('What performance improvement would you make first?', 'Create a shared cached market-data service to avoid repeated provider calls. This directly improves dashboard and chatbot latency while reducing quota usage.'),
('What AI improvement would you make first?', 'Add user-scoped retrieval filters and answer citations. That improves privacy, traceability, and user trust before adding more model complexity.'),
('What database improvement would you make first?', 'Replace request-time schema setup with versioned migrations and confirm the most important unique/index constraints. This makes deployments predictable and protects data integrity.'),
('How would you answer “what did you learn?”', 'I learned that building AI and ML features is not only about models; reliable product behavior needs security, clean data flow, database correctness, provider failure handling, clear UX, and honest communication of uncertainty.'),
('How would you close a project interview discussion?', 'I would explain that Stonks demonstrates a full-stack approach to a financial-learning product, while being clear about its current boundaries and the practical next steps needed for production-grade scale and financial safety.'),
])]

def footer(canvas, doc):
    canvas.saveState(); canvas.setStrokeColor(colors.HexColor('#1D4ED8')); canvas.line(18*mm,15*mm,192*mm,15*mm)
    canvas.setFont('Helvetica',8); canvas.setFillColor(colors.HexColor('#64748B'))
    canvas.drawString(18*mm,9*mm,'Stonks - Conceptual Interview Guide'); canvas.drawRightString(192*mm,9*mm,f'Page {doc.page}'); canvas.restoreState()

styles = getSampleStyleSheet()
title = ParagraphStyle('title', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=24, leading=29, alignment=TA_CENTER, textColor=colors.HexColor('#0F172A'))
sub = ParagraphStyle('sub', parent=styles['BodyText'], fontSize=11, leading=16, alignment=TA_CENTER, textColor=colors.HexColor('#475569'))
sec = ParagraphStyle('sec', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=15, leading=19, textColor=colors.HexColor('#1D4ED8'), spaceBefore=8, spaceAfter=9)
qst = ParagraphStyle('qst', parent=styles['BodyText'], fontName='Helvetica-Bold', fontSize=10, leading=13.5, textColor=colors.HexColor('#0F172A'), spaceAfter=2)
ans = ParagraphStyle('ans', parent=styles['BodyText'], fontSize=9.2, leading=12.5, textColor=colors.HexColor('#334155'), leftIndent=4*mm, spaceAfter=8)
note = ParagraphStyle('note', parent=styles['BodyText'], fontSize=10, leading=15, alignment=TA_CENTER, textColor=colors.HexColor('#334155'))

story = [Spacer(1,37*mm), Paragraph('Stonks', title), Paragraph('Conceptual Interview Guide', title), Spacer(1,6*mm), Paragraph('100 practical questions and interview-ready answers', sub), Spacer(1,16*mm), Paragraph('Designed for explaining the project clearly: how it works, why each technology is used, and how you would respond to common product and technical scenarios.', note), PageBreak()]
n=0
for name, rows in S:
    story.append(Paragraph(name,sec))
    for q,a in rows:
        n += 1
        story.append(KeepTogether([Paragraph(f'{n}. {q}',qst), Paragraph(f'<b>Answer:</b> {a}',ans)]))

doc=SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=18*mm,rightMargin=18*mm,topMargin=19*mm,bottomMargin=20*mm,title='Stonks Conceptual Interview Guide',author='Codex')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
print(OUT.resolve(), 'questions=',n)
