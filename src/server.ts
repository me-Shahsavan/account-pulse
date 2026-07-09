import express from "express";
import { config } from "./config.js";
import { NylasClient } from "./nylas/client.js";
import { buildAuthUrl, exchangeCodeForGrant, getGrant } from "./nylas/auth.js";
import { saveGrant, loadGrant } from "./store.js";
import { sendMessage } from "./nylas/send.js";
import { runPulseAuto } from "./agent/run.js";

// Server-rendered UI, no frontend framework. Three concerns:
//   /auth + /auth/callback  -> Nylas Hosted Auth round-trip
//   /  + /pulse             -> pulse form + rendered report
//   /send                   -> explicit human confirmation, then Nylas send

const app = express();
app.use(express.urlencoded({ extended: false }));

const nylas = new NylasClient({ apiKey: config.nylasApiKey, apiUri: config.nylasApiUri });

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const STYLES = `
  :root {
    --bg: #0c0f14; --panel: #141a22; --panel-2: #1a212c; --line: #232c39;
    --text: #e8edf4; --muted: #8b98a9; --accent: #34d399; --accent-dim: #10b98122;
    --warn: #fbbf24; --danger: #f87171; --mono: ui-monospace, "Cascadia Code", Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 16px/1.6 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
    min-height: 100vh;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .nav {
    display: flex; align-items: center; gap: 14px;
    padding: 14px 28px; border-bottom: 1px solid var(--line);
    background: rgba(12,15,20,.85); position: sticky; top: 0; backdrop-filter: blur(8px);
  }
  .logo { font-weight: 800; letter-spacing: .3px; font-size: 17px; }
  .logo .dot { color: var(--accent); }
  .tag {
    font: 11px/1 var(--mono); color: var(--muted); border: 1px solid var(--line);
    padding: 4px 8px; border-radius: 99px; text-transform: uppercase; letter-spacing: 1px;
  }
  .spacer { flex: 1; }
  .who { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
  .pulse-dot {
    width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
    box-shadow: 0 0 0 0 rgba(52,211,153,.6); animation: beat 2s infinite;
  }
  @keyframes beat { 0% {box-shadow:0 0 0 0 rgba(52,211,153,.5);} 70% {box-shadow:0 0 0 9px rgba(52,211,153,0);} 100% {box-shadow:0 0 0 0 rgba(52,211,153,0);} }
  .wrap { max-width: 880px; margin: 0 auto; padding: 40px 24px 80px; }
  .hero { text-align: center; padding: 48px 0 8px; }
  .hero h1 { font-size: 40px; line-height: 1.15; margin: 0 0 10px; letter-spacing: -.5px; }
  .hero h1 em { font-style: normal; color: var(--accent); }
  .hero p { color: var(--muted); max-width: 560px; margin: 0 auto 34px; }
  .searchbar {
    display: flex; gap: 10px; max-width: 560px; margin: 0 auto;
    background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 8px;
  }
  .searchbar:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
  .searchbar input {
    flex: 1; background: transparent; border: 0; outline: 0; color: var(--text);
    font-size: 16px; padding: 10px 12px;
  }
  .btn {
    background: var(--accent); color: #04120c; font-weight: 700; border: 0;
    padding: 12px 22px; border-radius: 10px; font-size: 15px; cursor: pointer;
    transition: transform .06s ease, filter .15s ease;
  }
  .btn:hover { filter: brightness(1.08); }
  .btn:active { transform: scale(.98); }
  .btn.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
  .btn.danger-outline { background: transparent; color: var(--danger); border: 1px solid var(--danger); }
  .steps { display: flex; gap: 14px; justify-content: center; margin-top: 44px; flex-wrap: wrap; }
  .step {
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 14px 18px; font-size: 13px; color: var(--muted); max-width: 200px; text-align: left;
  }
  .step b { display: block; color: var(--text); margin-bottom: 4px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px; }
  .card {
    background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 20px 22px;
  }
  .card.full { grid-column: 1 / -1; }
  .card h3 {
    margin: 0 0 10px; font: 700 11px/1 var(--mono); letter-spacing: 1.6px;
    text-transform: uppercase; color: var(--muted);
  }
  .card h3::before { content: "▸ "; color: var(--accent); }
  .card p, .card li { color: var(--text); font-size: 15px; margin: 0; }
  .card ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip {
    font: 13px/1 var(--mono); background: var(--panel-2); border: 1px solid var(--line);
    color: var(--text); padding: 8px 12px; border-radius: 99px;
  }
  .chip::before { content: "◷ "; color: var(--accent); }
  .email-preview { background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .email-head { padding: 12px 16px; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--muted); display: grid; gap: 4px; }
  .email-head b { color: var(--text); font-weight: 600; }
  .email-preview input, .email-preview textarea {
    width: 100%; background: transparent; border: 0; outline: 0; color: var(--text);
    font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; resize: vertical;
  }
  .email-preview textarea { padding: 14px 16px; min-height: 220px; }
  .email-preview input { font-weight: 600; }
  .send-row { display: flex; align-items: center; gap: 14px; margin-top: 14px; flex-wrap: wrap; }
  .note { font-size: 13px; color: var(--muted); }
  .note b { color: var(--warn); }
  .mono { font-family: var(--mono); font-size: 13px; color: var(--accent); word-break: break-all; }
  .banner { border: 1px solid var(--line); border-left: 3px solid var(--accent); background: var(--panel); border-radius: 10px; padding: 14px 18px; margin-bottom: 18px; font-size: 14px; color: var(--muted); }
  .banner.err { border-left-color: var(--danger); }
  .center { text-align: center; padding: 60px 0; }
  .big-check { font-size: 52px; }
  pre.raw { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px; white-space: pre-wrap; font-size: 14px; }
  /* loading overlay */
  #loading {
    display: none; position: fixed; inset: 0; background: rgba(12,15,20,.92);
    z-index: 50; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
  }
  #loading.on { display: flex; }
  .spinner { width: 42px; height: 42px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--accent); animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #loading .phase { color: var(--muted); font: 14px var(--mono); }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } .hero h1 { font-size: 30px; } }
`;

const LOADING_JS = `
  const phases = [
    "connecting to Nylas…",
    "pulling email threads…",
    "reading the ones that matter…",
    "checking real calendar availability…",
    "agent is thinking (Claude tool use)…",
    "drafting the follow-up…",
  ];
  function showLoading() {
    const el = document.getElementById("loading");
    el.classList.add("on");
    let i = 0;
    const phase = el.querySelector(".phase");
    phase.textContent = phases[0];
    setInterval(() => { i = Math.min(i + 1, phases.length - 1); phase.textContent = phases[i]; }, 2600);
    return true;
  }
`;

function layout(body: string, grantEmail?: string | null): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Account Pulse</title>
<style>${STYLES}</style>
</head><body>
<nav class="nav">
  <span class="logo"><span class="dot">●</span> Account&nbsp;Pulse</span>
  <span class="tag">Nylas v3 · Claude tool use</span>
  <span class="spacer"></span>
  ${
    grantEmail
      ? `<span class="who"><span class="pulse-dot"></span>${esc(grantEmail)}</span>`
      : `<a class="who" href="/auth">connect account →</a>`
  }
</nav>
<div id="loading"><div class="spinner"></div><div class="phase"></div></div>
<main class="wrap">${body}</main>
<script>${LOADING_JS}</script>
</body></html>`;
}

// The agent's report follows a fixed section structure; parse it into
// cards. Falls back to a raw <pre> if the structure isn't recognized.
function parseReport(report: string): Map<string, string> | null {
  const names = ["SUMMARY", "LAST TOUCH", "OPEN ITEMS", "PROPOSED SLOTS", "DRAFT"];
  const pattern = new RegExp(
    `(?:^|\\n)\\s*\\*{0,2}(${names.join("|")})\\*{0,2}\\s*\\n`,
    "g",
  );
  const hits = [...report.matchAll(pattern)];
  if (hits.length < 3) return null;

  const sections = new Map<string, string>();
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index! + hits[i][0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index! : report.length;
    const text = report
      .slice(start, end)
      .replace(/^-{3,}\s*$/gm, "")
      .replace(/\*\*/g, "")
      .trim();
    sections.set(hits[i][1], text);
  }
  return sections;
}

function renderList(text: string): string {
  const items = text
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

app.get("/auth", (_req, res) => {
  res.redirect(
    buildAuthUrl({
      apiUri: config.nylasApiUri,
      clientId: config.nylasClientId,
      redirectUri: config.callbackUri,
    }),
  );
});

app.get("/auth/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  if (!code) {
    res.status(400).send(layout(`<div class="banner err">Missing ?code in callback.</div>`));
    return;
  }
  try {
    const token = await exchangeCodeForGrant(nylas, {
      clientId: config.nylasClientId,
      apiKey: config.nylasApiKey,
      redirectUri: config.callbackUri,
      code,
    });
    const grant = await getGrant(nylas, token.grantId);
    saveGrant({
      grantId: token.grantId,
      email: token.email || grant.email,
      connectedAt: new Date().toISOString(),
    });
    res.send(
      layout(
        `<div class="center">
          <div class="big-check">✅</div>
          <h1>Account connected</h1>
          <p class="note">Grant <span class="mono">${esc(token.grantId)}</span><br>
          for <b>${esc(grant.email)}</b> · status: ${esc(grant.grant_status)}</p>
          <p><a class="btn" href="/">Run a pulse →</a></p>
        </div>`,
        grant.email,
      ),
    );
  } catch (err) {
    res.status(500).send(layout(`<div class="banner err">Auth failed: ${esc(String(err))}</div>`));
  }
});

app.get("/", (_req, res) => {
  const grant = loadGrant();
  res.send(
    layout(
      `<div class="hero">
        <h1>How is your relationship<br>with <em>that contact</em> doing?</h1>
        <p>A grounded answer from your real email threads and real calendar availability —
        Nylas v3 primitives underneath, a Claude tool-use agent on top.</p>
        ${
          grant
            ? `<form class="searchbar" method="post" action="/pulse" onsubmit="return showLoading()">
                 <input type="email" name="contact" placeholder="contact@example.com" required autofocus>
                 <button class="btn" type="submit">Get pulse</button>
               </form>`
            : `<a class="btn" href="/auth">Connect your account via Nylas Hosted Auth</a>`
        }
        <div class="steps">
          <div class="step"><b>1 · Read</b>Threads with the contact + open calendar slots, via Nylas.</div>
          <div class="step"><b>2 · Reason</b>The agent summarizes, finds open items, drafts a follow-up.</div>
          <div class="step"><b>3 · You decide</b>Nothing is sent until you review and confirm.</div>
        </div>
      </div>`,
      grant?.email,
    ),
  );
});

app.post("/pulse", async (req, res) => {
  const grant = loadGrant();
  if (!grant) {
    res.redirect("/auth");
    return;
  }
  const contact = String(req.body.contact ?? "").trim();
  try {
    const result = await runPulseAuto({
      nylas,
      grantId: grant.grantId,
      ownerEmail: grant.email,
      contactEmail: contact,
    });

    const sections = parseReport(result.report);
    const reportHtml = sections
      ? `<div class="grid">
           <div class="card full"><h3>Summary</h3><p>${esc(sections.get("SUMMARY") ?? "")}</p></div>
           <div class="card"><h3>Last touch</h3><p>${esc(sections.get("LAST TOUCH") ?? "")}</p></div>
           <div class="card"><h3>Open items</h3>${renderList(sections.get("OPEN ITEMS") ?? "")}</div>
           <div class="card full"><h3>Proposed slots</h3>
             <div class="chips">${(result.slots ?? [])
               .slice(0, 6)
               .map((s) => `<span class="chip">${esc(s.startLocal)}</span>`)
               .join("") || esc(sections.get("PROPOSED SLOTS") ?? "")}</div>
           </div>
         </div>`
      : `<pre class="raw">${esc(result.report)}</pre>`;

    // The draft is editable before sending — the agent proposes,
    // the human edits and disposes.
    const draftHtml = result.draft
      ? `<div class="card full" style="margin-top:16px">
           <h3>Draft follow-up · review before sending</h3>
           <form method="post" action="/send" onsubmit="return showLoading()">
             <div class="email-preview">
               <div class="email-head">
                 <span>To&nbsp;&nbsp;&nbsp;<b>${esc(result.draft.to)}</b></span>
                 <span>Subj&nbsp;<input name="subject" value="${esc(result.draft.subject)}"></span>
               </div>
               <textarea name="body">${esc(result.draft.body)}</textarea>
             </div>
             <input type="hidden" name="to" value="${esc(result.draft.to)}">
             <div class="send-row">
               <button class="btn" type="submit">Send via Nylas</button>
               <a class="btn ghost" href="/">Discard</a>
               <span class="note"><b>Not sent yet.</b> Edit freely — sending only happens on your click.</span>
             </div>
           </form>
         </div>`
      : `<div class="banner" style="margin-top:16px">The agent did not record a draft.</div>`;

    res.send(
      layout(
        `<p><a href="/">← new pulse</a></p>
         <h1 style="margin:6px 0 4px">Pulse · <span style="color:var(--accent)">${esc(contact)}</span></h1>
         <p class="note">Grounded in real Nylas data · agent finished in ${result.turns} turns</p>
         ${reportHtml}
         ${draftHtml}`,
        grant.email,
      ),
    );
  } catch (err) {
    res
      .status(500)
      .send(
        layout(
          `<div class="banner err">Pulse failed: ${esc(String(err))}</div><p><a href="/">← back</a></p>`,
          grant.email,
        ),
      );
  }
});

app.post("/send", async (req, res) => {
  const grant = loadGrant();
  if (!grant) {
    res.redirect("/auth");
    return;
  }
  try {
    const sent = await sendMessage(nylas, grant.grantId, {
      to: [{ email: String(req.body.to) }],
      subject: String(req.body.subject),
      body: String(req.body.body),
    });
    res.send(
      layout(
        `<div class="center">
           <div class="big-check">📨</div>
           <h1>Sent</h1>
           <p class="note">Nylas message id</p>
           <p class="mono">${esc(sent.messageId)}</p>
           <p style="margin-top:26px"><a class="btn" href="/">Run another pulse</a></p>
         </div>`,
        grant.email,
      ),
    );
  } catch (err) {
    res
      .status(500)
      .send(layout(`<div class="banner err">Send failed: ${esc(String(err))}</div>`, grant.email));
  }
});

app.listen(config.port, () => {
  console.log(`Account Pulse: http://localhost:${config.port}`);
  console.log(`Connect an account: http://localhost:${config.port}/auth`);
});
