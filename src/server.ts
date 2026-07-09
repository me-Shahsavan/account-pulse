import express from "express";
import { config } from "./config.js";
import { NylasClient } from "./nylas/client.js";
import { buildAuthUrl, exchangeCodeForGrant, getGrant } from "./nylas/auth.js";
import { saveGrant, loadGrant } from "./store.js";
import { sendMessage } from "./nylas/send.js";
import { runPulse } from "./agent/pulse.js";

// Minimal server-rendered UI. Two concerns only:
//   /auth + /auth/callback  -> Nylas Hosted Auth round-trip (M1)
//   /                       -> pulse form + result + confirm-to-send (M5)

const app = express();
app.use(express.urlencoded({ extended: false }));

const nylas = new NylasClient({ apiKey: config.nylasApiKey, apiUri: config.nylasApiUri });

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const page = (body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Account Pulse</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  pre { background: #f6f6f6; padding: 1rem; white-space: pre-wrap; border-radius: 6px; }
  input[type=email] { padding: .5rem; width: 20rem; }
  button { padding: .5rem 1rem; cursor: pointer; }
  .muted { color: #777; }
</style></head><body>${body}</body></html>`;

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
    res.status(400).send(page(`<p>Missing ?code in callback.</p>`));
    return;
  }
  try {
    const token = await exchangeCodeForGrant(nylas, {
      clientId: config.nylasClientId,
      apiKey: config.nylasApiKey,
      redirectUri: config.callbackUri,
      code,
    });
    // Sanity check the grant before persisting it.
    const grant = await getGrant(nylas, token.grantId);
    saveGrant({
      grantId: token.grantId,
      email: token.email || grant.email,
      connectedAt: new Date().toISOString(),
    });
    res.send(
      page(
        `<h1>Connected ✔</h1>
         <p>Grant <code>${esc(token.grantId)}</code> for <b>${esc(grant.email)}</b> (status: ${esc(grant.grant_status)}).</p>
         <p><a href="/">Go run a pulse →</a></p>`,
      ),
    );
  } catch (err) {
    res.status(500).send(page(`<p>Auth failed: ${esc(String(err))}</p>`));
  }
});

app.get("/", (_req, res) => {
  const grant = loadGrant();
  res.send(
    page(`
      <h1>Account Pulse</h1>
      ${
        grant
          ? `<p class="muted">Connected as <b>${esc(grant.email)}</b></p>
             <form method="post" action="/pulse">
               <p><input type="email" name="contact" placeholder="contact@example.com" required>
               <button type="submit">Get pulse</button></p>
             </form>`
          : `<p>No account connected yet. <a href="/auth">Connect your account via Nylas Hosted Auth →</a></p>`
      }
    `),
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
    const result = await runPulse({
      anthropicApiKey: config.anthropicApiKey,
      nylas,
      grantId: grant.grantId,
      ownerEmail: grant.email,
      contactEmail: contact,
      timezone: config.userTimezone,
    });

    // The draft is rendered for review; sending requires the explicit
    // confirm form below (agent proposes, human disposes).
    const sendForm = result.draft
      ? `<h2>Send this draft?</h2>
         <form method="post" action="/send">
           <input type="hidden" name="to" value="${esc(result.draft.to)}">
           <input type="hidden" name="subject" value="${esc(result.draft.subject)}">
           <input type="hidden" name="body" value="${esc(result.draft.body)}">
           <button type="submit">Yes, send it via Nylas</button>
         </form>`
      : `<p class="muted">No draft was recorded.</p>`;

    res.send(
      page(
        `<p><a href="/">← back</a></p>
         <h1>Pulse: ${esc(contact)}</h1>
         <pre>${esc(result.report)}</pre>
         ${sendForm}`,
      ),
    );
  } catch (err) {
    res.status(500).send(page(`<p>Pulse failed: ${esc(String(err))}</p><p><a href="/">← back</a></p>`));
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
      page(
        `<h1>Sent ✔</h1>
         <p>Nylas message id: <code>${esc(sent.messageId)}</code></p>
         <p><a href="/">← back</a></p>`,
      ),
    );
  } catch (err) {
    res.status(500).send(page(`<p>Send failed: ${esc(String(err))}</p>`));
  }
});

app.listen(config.port, () => {
  console.log(`Account Pulse: http://localhost:${config.port}`);
  console.log(`Connect an account: http://localhost:${config.port}/auth`);
});
