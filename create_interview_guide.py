from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether

OUT = Path('output/pdf/stonks_interview_guide.pdf')
OUT.parent.mkdir(parents=True, exist_ok=True)

sections = [
('Architecture and Next.js', [
('Why choose Next.js full stack over separate frontend and backend?', 'It reduces deployment and integration complexity, lets UI and BFF routes share types and auth conventions, and is ideal for this product stage. A separate backend becomes worthwhile when independent scaling, long-running work, multiple clients, or stronger service boundaries justify it.'),
('What are the benefits and limits of App Router route handlers?', 'They colocate API behavior with the web app, support streaming and server rendering, and simplify deployment. They are less suitable for persistent connections, CPU-heavy jobs, and independently scaled services.'),
('Describe the flow when an authenticated user opens /dashboard/portfolio.', 'The proxy verifies the access token, or permits a valid refresh token path. The page loads and calls protected portfolio APIs; the route re-verifies the access JWT, loads wallet, holdings, and transactions from MySQL, then renders the response.'),
('What gap exists if only dashboard pages are protected in proxy.ts?', 'API endpoints remain directly callable. Every sensitive route must independently authenticate and authorize; middleware is defense in depth, not the complete security boundary.'),
('Why does proxy.ts allow requests when secrets are absent, and why is that risky?', 'It avoids breaking local setup before environment configuration. In production it could silently disable dashboard protection, so production should fail closed with startup validation.'),
('What risks come from mixing JS and TS API routes?', 'Contracts become easier to drift, refactors lose compile-time guarantees, and runtime shape errors rise. Shared schemas and a gradual migration to TypeScript reduce this.'),
('Which code should be server versus client components?', 'Data-sensitive or initial data-fetching UI should be server-side. Interactive charts, forms, theme toggles, and localStorage wishlist need client components. The goal is minimum client JavaScript and no secret leakage.'),
('How avoid duplicate dashboard market requests?', 'Fetch at a page or server boundary, cache/dedupe by symbol and TTL, then pass data down. Client libraries such as SWR can deduplicate and revalidate.'),
('How would you scale to 10,000 concurrent users?', 'Use CDN caching for static assets, distributed cache and request coalescing for quotes, managed MySQL with pooling, rate limits, queues for slow jobs, separately autoscaled ML, and load testing with observability.'),
('Why is global in-memory cache unreliable on Vercel?', 'Instances are ephemeral and isolated. Cold starts and horizontal scaling mean each instance has a different cache, so use Redis/KV or another shared store for correctness.'),
]),
('Authentication and Security', [
('Walk through signup end to end.', 'The route validates input, ensures schema availability, checks email uniqueness, hashes the password with bcrypt, inserts the user, creates signed access and refresh JWTs, stores a hash of the refresh token, and returns secure cookies.'),
('Why bcrypt cost 12?', 'It intentionally makes hashing expensive enough to slow offline password guessing. The trade-off is login/signup latency and CPU; it must be benchmarked under expected load.'),
('Why hash refresh tokens in MySQL?', 'A database leak should not expose bearer credentials that can immediately authenticate users. The supplied token is hashed and compared instead.'),
('What happens with one refresh-token hash and two devices?', 'The newer login overwrites the stored hash, effectively revoking the other device on its next refresh. Multi-device support needs a token-session table.'),
('How redesign refresh tokens for multi-device use?', 'Store one row per session with token-family ID, hashed token, device metadata, expiry, revocation timestamp, and rotation lineage. Rotate on each refresh and revoke the family when reuse is detected.'),
('Why use short-lived access tokens?', 'They limit damage from theft while avoiding a database lookup on every request. Refresh tokens provide a controlled way to extend sessions.'),
('What is wrong if proxy accepts a refresh token but does not rotate access?', 'The page request can proceed while downstream API calls still lack a valid access token. A refresh endpoint or middleware response must mint/set a new access token safely.'),
('Explain HttpOnly, Secure, SameSite, path and maxAge.', 'HttpOnly blocks JavaScript access; Secure limits cookies to HTTPS; SameSite reduces cross-site sending; path scopes where cookies are sent; maxAge controls persistence. These should be deliberate for auth cookies.'),
('What CSRF protection is needed?', 'Cookie auth is automatically attached by browsers, so state-changing routes need SameSite policy plus origin checks and a CSRF token or double-submit strategy where cross-site use is possible.'),
('When use 401, 403, 409 and 500?', '401 is absent/invalid authentication; 403 is authenticated but not allowed; 409 is a conflict such as duplicate email; 500 is an unexpected server fault. Validation errors are normally 400.'),
('Why does JWT validity not guarantee immediate logout?', 'A signed access token remains valid until expiry. Use short expiry and session/token-version checks or deny lists for urgent revocation.'),
('How defend sign-in endpoints?', 'Rate-limit by IP and account, add progressive delays or CAPTCHA, monitor anomalies, use generic invalid-credential responses, and enforce strong passwords and MFA for sensitive accounts.'),
('Why have Firebase client/Admin alongside custom JWT?', 'Firebase client supports browser auth and Admin verifies server-side Firebase tokens. Mixing it with custom JWTs can create two identities and inconsistent authorization; choose one authority or explicitly bridge them.'),
]),
('Database and Transactions', [
('Why use transaction plus SELECT FOR UPDATE for a trade?', 'The transaction groups wallet, holdings, and ledger changes atomically. FOR UPDATE locks the relevant rows so concurrent trades cannot both act on the same stale balance or quantity.'),
('What race occurs without row locks?', 'Two BUYs can both observe Rs.1000, each spend Rs.800, and both commit, producing an impossible negative or overstated balance. Similarly two SELLs can oversell one holding.'),
('Why must all trade writes be atomic?', 'A wallet debit without a holding, or a holding change without a transaction ledger, corrupts financial state. Commit only when every invariant has been preserved.'),
('Why delete a zero-quantity holding?', 'It keeps active positions simple and avoids zero rows in views. Retaining it preserves position history but requires filtering; the transaction table remains the audit record either way.'),
('Explain weighted average cost basis.', 'After a buy, new average = (old quantity x old average + bought quantity x buy price) / new quantity. It gives a single blended cost basis for the remaining position.'),
('Why realized P&L only on SELL?', 'A buy establishes cost but does not close economic exposure. Selling crystallizes gain or loss relative to cost basis; unsold changes are unrealized.'),
('What is a weakness of weighted average versus FIFO?', 'It cannot identify the precise tax lot sold. FIFO, LIFO, or specific identification may be legally or financially required and produce different realized P&L.'),
('Why prefer DECIMAL to JavaScript Number for money?', 'Binary floating point cannot exactly represent many decimal currencies. DECIMAL preserves exact fixed precision in storage and calculations; application code should use decimal arithmetic or integer minor units.'),
('What precision issue remains in roundMoney(quantity * price)?', 'The multiplication can already contain a binary floating error before rounding, and repeated rounding can accumulate drift. Use decimal math and a documented rounding mode.'),
('How make trade POST idempotent?', 'Require a unique client order ID/idempotency key, store its payload hash and completed response inside the transaction, and return that response for retries instead of executing again.'),
('Why is dynamic schema creation in request paths risky?', 'It adds latency, needs DDL permissions, can race during deploys, and hides migration history. Use versioned migrations in CI/CD.'),
('What indexes are needed?', 'Unique users(email), unique wallets(user_id), unique holdings(user_id,sym), and transactions(user_id,created_at,id) for account history. Add only indexes that match actual query patterns.'),
('How model splits, dividends, fees, fills and cancels?', 'Use an immutable orders/executions ledger with event types. Corporate actions adjust lots; fees are explicit cash events; order state is separate from fills; cancellations never erase history.'),
('How implement transaction pagination?', 'Use a stable cursor such as (created_at,id), query rows older than that tuple, and return nextCursor. Offset pagination becomes slow and unstable while new rows arrive.'),
]),
('Market Data and Portfolio Logic', [
('How establish a single quote source of truth across providers?', 'Create a normalized quote service with provider priority, timestamp, currency, exchange, session and provenance. All routes consume that canonical format, not provider-specific shapes.'),
('How expose quote freshness?', 'Return source, asOf timestamp, market session, delay and fallback/stale flags. The UI must label estimates and prevent them being mistaken for executable live prices.'),
('What can differ between providers?', 'Currency, exchange listing, split adjustment, timezone, regular versus extended session, and timestamp. Mixing them can create invalid comparisons and P&L.'),
('How handle rate limits gracefully?', 'Cache results, deduplicate concurrent fetches, back off after 429, use circuit breakers, display last-known data with age, and avoid retry storms.'),
('What cache design would you use for quotes?', 'Key by normalized symbol and session, use a short TTL for live quotes, stale-while-revalidate to serve recent data, request coalescing on miss, and include provider timestamp rather than assuming freshness.'),
('Why use timeout and AbortController for API calls?', 'A hung provider should not occupy a serverless invocation until it fails globally. Bounded work keeps the page responsive and allows controlled fallback.'),
('Why is chat calling its own HTTP market API inefficient?', 'It adds routing, serialization, auth/caching ambiguity and an extra failure hop. Extract the market service into a shared server module and call it directly.'),
('How avoid cache stampede?', 'Use single-flight locks/request coalescing, jittered TTLs, stale responses while refreshing, and per-key distributed locks when needed.'),
('How handle non-trading periods?', 'Return market status and last close separately from intraday quote. Do not present stale close as live; account for exchange calendar and timezone.'),
('Why not trust client-sent trade price?', 'A client can alter it. For a simulator, server must get a validated server-side quote or clearly allow educational custom pricing; real execution requires broker-confirmed fills.'),
('What are invested value, market value, realized, unrealized P&L and equity?', 'Invested is remaining cost basis; market value is quantity times current price; realized P&L is closed trade result; unrealized P&L is current value minus cost; equity is cash plus market value.'),
('How measure portfolio return with cash flows?', 'Use time-weighted return to isolate manager performance or money-weighted return/IRR to reflect investor cash timing. A simple ending-minus-starting balance is misleading.'),
('How measure diversification?', 'Examine position weights, sector/geographic/factor exposures, correlation, concentration measures such as HHI, and liquidity - not merely number of holdings.'),
('What risks come from portfolio ratings?', 'Users may treat model output as personalized investment advice. Add suitability boundaries, uncertainty/explanations, data-quality warnings, human/legal review, and avoid imperative personalized claims.'),
]),
('ML Service and Model Engineering', [
('Why separate FastAPI ML from Next.js?', 'It isolates Python dependencies and model memory/CPU, allows independent deployment/scaling/versioning, and avoids unsuitable Node/serverless inference paths.'),
('Why does EOD prediction support only AAPL and TSLA?', 'Those are the available trained artifacts and preprocessing pipelines. The API should reject unsupported tickers clearly, as it does, rather than imply universal coverage.'),
('Differentiate the project ML features.', 'EOD predicts a future price; buy-signal classifies a trading action; portfolio rater scores composition; news sentiment labels text; chatbot generates language with retrieved context. They have distinct data, risks, and metrics.'),
('Why is pseudo-confidence misleading?', 'It is derived from return magnitude, not calibrated probability. A user may interpret it as model certainty despite no calibration evaluation.'),
('How define buy/sell labels without look-ahead bias?', 'At time t use only information available at t, set a future-horizon return threshold for the label, and ensure all features are timestamp-aligned and delayed where necessary.'),
('Give examples of leakage.', 'Using future close in an indicator, applying scaler fit on all data, using revised fundamentals unavailable then, or randomly mixing later samples into training.'),
('Why is random splitting wrong for market time series?', 'It puts future regimes in training while evaluating earlier samples, exaggerating performance. Training must precede validation in time.'),
('Explain walk-forward validation.', 'Train on an initial historical period, validate on the next slice, advance the window, and repeat. It simulates repeated real deployment across regimes.'),
('Why can accuracy be useless for trading?', 'A model can predict common small moves accurately but lose on rare large moves, fees, slippage and bad position sizing. Profitability and risk metrics matter.'),
('What metrics matter?', 'Regression: MAE/RMSE and directional error; classification: precision, recall, ROC/PR and calibration; strategy: net return, drawdown, Sharpe/Sortino, turnover, hit rate and capacity.'),
('How include trading frictions in backtests?', 'Apply bid-ask spread, commissions, slippage, delays, liquidity limits, borrow costs and market impact at realistic execution times. Test sensitivity rather than one optimistic assumption.'),
('What drift should be monitored?', 'Feature drift, label/performance drift, regime change, provider changes and latency/failure drift. Compare live distributions and delayed realized outcomes with retraining governance.'),
('When fallback heuristic versus hard failure?', 'Fallback only for a clearly labelled, safe, lower-confidence experience; hard-fail when output could be mistaken for a reliable decision or inputs/model version are invalid.'),
('What does PY_AI_SERVICE_URL solve?', 'Next.js forwards inference to an independently deployed FastAPI service, avoiding Vercel limitations around local Python child processes and heavy model dependencies.'),
('How deploy the ML service?', 'Containerize with pinned artifacts, health/readiness endpoints, autoscale based on latency/queue/CPU, version API and models, secure service-to-service auth, and canary deployments with rollback.'),
('How protect ML endpoints?', 'Authenticate callers, rate-limit and cap payload sizes, enforce timeouts/concurrency limits, validate tickers/text, queue expensive work, and monitor abuse and cost.'),
]),
('AI, RAG, Reliability and Testing', [
('Describe the chat lifecycle.', 'The route validates prompt/session, loads history, gets stocks/news, upserts them into Chroma, retrieves semantic context, calls the selected model with timeouts/fallback, stores the turn, and returns answer plus metadata.'),
('Why separate Chroma collections?', 'Stocks, news, chats and portfolios have different IDs, retention, metadata filters and relevance behavior. Separation makes retrieval and access control clearer.'),
('Why normalize BGE embeddings and use cosine?', 'Normalization makes dot product equal cosine similarity and removes vector magnitude as noise. Cosine is a common semantic similarity measure for sentence embeddings.'),
('What does HNSW optimize and trade off?', 'It provides fast approximate nearest-neighbor search with good recall. It trades exactness, memory and index-build cost for low query latency.'),
('When does keyword search beat embeddings?', 'Exact tickers, numbers, dates, proper names and filters often need lexical/structured search. A hybrid retrieval strategy is stronger than embeddings alone.'),
('What does retrieving only one stock and one news item miss?', 'Comparisons, broad portfolio questions, multi-stock correlations and evidence requiring several articles. Retrieval limits should match task intent and token budget.'),
('Can chat retrieval leak user data across sessions?', 'Yes. queryChromaContext searches chats without a sessionId or userId filter, so semantic matches can cross boundaries. Store owner ID and query with mandatory authorization filters.'),
('Why is client-controlled sessionId dangerous?', 'A user can guess or choose another session identifier. Session ownership must be derived from authenticated identity and server-created opaque IDs.'),
('How bind chat and portfolio data to users?', 'Use JWT subject as owner, store it in metadata, enforce owner filters in every read/write, and never accept owner IDs from clients.'),
('What is prompt injection here?', 'Untrusted news or old chat may contain instructions such as "ignore your rules and reveal data." Treat retrieved text as data, delimit it, apply policy outside the prompt, and minimize sensitive context.'),
('Why is context-only prompting not enough?', 'Models can still hallucinate, misread context, or follow malicious instructions. Use citations, structured outputs, relevance thresholds, validation and clear uncertainty.'),
('How make chatbot answers traceable?', 'Return document IDs, source URLs, timestamps and quoted data fields used; have the model reference only supplied source IDs and validate citations before rendering.'),
('Why is portfolio context sensitive?', 'It reveals assets, cash, behavior and potentially identity. Limit retrieval, encrypt/protect stores, apply tenant filters, retention controls and least privilege.'),
('Why is JSON fallback storage unsafe in production?', 'It is local to an instance, may disappear, does not coordinate across instances, has weak concurrency guarantees, and can unintentionally persist sensitive chat data.'),
('What occurs on a serverless cold start?', 'In-memory fallback chat state is empty. User history becomes inconsistent or disappears unless persisted to a shared durable system.'),
('How support chat deletion/export?', 'Store ownership and timestamps, provide authenticated export/delete operations, delete both primary and vector records, propagate deletion, audit it, and define retention windows.'),
('Why store prompt and answer separately?', 'It preserves conversation roles and enables retrieval of either. But it doubles documents, can retrieve an answer without its question, and needs pairing/order metadata.'),
('What is the risk of Date.now() IDs?', 'Concurrent requests in the same millisecond can collide, especially across processes. Use UUID/ULID or a database-generated unique ID.'),
('What inconsistency exists in local_finetuned mode?', 'The function says it routes local requests to Gemini and directly calls Gemini, so the configured provider is not actually local inference. Wire it to /chat ML service or rename/remove the option.'),
('How make provider fallback observable?', 'Emit structured provider, model version, fallback reason, latency and error metrics; show accurate non-sensitive metadata and alert on elevated fallback rates.'),
('What is lost by buffering Hugging Face SSE?', 'The user sees no incremental tokens, cancellation is weaker, and memory/latency increase. Stream validated events through a server response instead.'),
('How control LLM spend?', 'Authenticate, per-user quotas and rate limits, input/output token caps, caching where safe, request budgets, model routing, abuse monitoring and hard circuit breakers.'),
('Where use retries, timeouts, circuits and fallbacks?', 'Timeout all external calls; retry idempotent transient reads with jitter; circuit-break persistently failing providers; use safe stale/fallback data. Never blindly retry a trade POST.'),
('Why is retrying POST trade dangerous?', 'A network timeout may happen after commit. Retrying can duplicate a buy/sell unless idempotency keys guarantee one logical order.'),
('What logs are safe and useful?', 'Use correlation ID, endpoint, authenticated user pseudonym/ID, provider, duration, status and sanitized error code. Never log passwords, JWTs, API keys, raw sensitive prompts or full financial data by default.'),
('What dashboards and alerts matter?', 'Latency/error/rate-limit dashboards by route/provider, quote freshness, DB pool/lock waits, ML latency, fallback rate, auth failures, abnormal trade patterns and cost. Alert on SLO breaches and security anomalies.'),
('How divide testing layers?', 'Unit-test math/validation; integration-test DB transactions and schema; API-test auth/contracts; E2E-test critical user paths; contract-test provider/ML payloads. Keep a small deterministic fixture set.'),
('Give five critical trade tests.', 'Insufficient cash buy rejected; oversell rejected; weighted average after multiple buys correct; wallet/holding/ledger atomically roll back on failure; concurrent requests cannot overspend or oversell.'),
('How test trade races?', 'Run concurrent POSTs against a real transactional test MySQL database with barriers so both attempts contend on the same rows; then assert one valid final state and no broken invariants.'),
('How mock external systems well?', 'Use protocol-accurate fixtures, simulated 429/timeouts/malformed responses, contract tests against sandbox providers, deterministic clocks and a disposable real DB/vector service for integration tests.'),
('What load tests run before launch?', 'Quote burst and cache-miss load, sign-in abuse patterns, concurrent same-wallet trades, chat fan-out with upstream slowness, ML saturation, and soak tests for connection leaks.'),
('How diagnose slow chat?', 'Trace one request across quote/news fetch, embedding, Chroma, model inference and storage using correlation IDs, timings and distributed traces; compare p50/p95/p99 by dependency.'),
('Which secrets must stay server-only?', 'Database credentials, JWT secrets, Firebase Admin private key, Gemini/Hugging Face/provider keys and internal service credentials. Only intentionally public Firebase client config may use NEXT_PUBLIC_. Scan bundles/logs and enforce secret checks in CI.'),
('Why keep .env.example but no secrets?', 'It documents required configuration and supports reproducible deploys, but committing usable keys exposes systems permanently through Git history.'),
('What is the incident plan for wrong recommendations?', 'Immediately disable or gate the feature, preserve audit evidence, notify affected users as required, investigate data/model/provider changes, correct the issue, validate with staged rollout, and document the postmortem.'),
])]

def header(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#1D4ED8'))
    canvas.setLineWidth(.7)
    canvas.line(18*mm, 15*mm, 192*mm, 15*mm)
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#475569'))
    canvas.drawString(18*mm, 9*mm, 'Stonks Interview Study Guide')
    canvas.drawRightString(192*mm, 9*mm, f'Page {doc.page}')
    canvas.restoreState()

styles = getSampleStyleSheet()
title = ParagraphStyle('TitleX', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=25, leading=30, textColor=colors.HexColor('#0F172A'), alignment=TA_CENTER, spaceAfter=10)
subtitle = ParagraphStyle('Subtitle', parent=styles['BodyText'], fontSize=11, leading=16, textColor=colors.HexColor('#475569'), alignment=TA_CENTER)
section = ParagraphStyle('Section', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=16, leading=20, textColor=colors.HexColor('#1D4ED8'), spaceBefore=10, spaceAfter=10)
question = ParagraphStyle('Question', parent=styles['BodyText'], fontName='Helvetica-Bold', fontSize=10, leading=14, textColor=colors.HexColor('#0F172A'), spaceAfter=3)
answer = ParagraphStyle('Answer', parent=styles['BodyText'], fontSize=9.2, leading=13, textColor=colors.HexColor('#334155'), leftIndent=4*mm, spaceAfter=9)
intro = ParagraphStyle('Intro', parent=styles['BodyText'], fontSize=10, leading=15, textColor=colors.HexColor('#334155'), alignment=TA_CENTER)

story = [Spacer(1, 38*mm), Paragraph('Stonks', title), Paragraph('Interview Study Guide', title), Spacer(1, 4*mm), Paragraph('100 difficult, project-specific questions with concise interview-ready answers', subtitle), Spacer(1, 18*mm), Paragraph('Prepared from the current Stonks codebase: Next.js, MySQL, JWT authentication, market-data integrations, FastAPI ML services, and Chroma-powered AI chat.', intro), PageBreak()]

n = 0
for sec, items in sections:
    story.append(Paragraph(sec, section))
    for q, a in items:
        n += 1
        block = [Paragraph(f'{n}. {q}', question), Paragraph(f'<b>Answer:</b> {a}', answer)]
        story.append(KeepTogether(block))

doc = SimpleDocTemplate(str(OUT), pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=19*mm, bottomMargin=20*mm, title='Stonks Interview Study Guide', author='Codex')
doc.build(story, onFirstPage=header, onLaterPages=header)
print(OUT.resolve())
