import readline from "node:readline/promises";
import { config } from "./config.js";
import { NylasClient } from "./nylas/client.js";
import { requireGrant } from "./store.js";
import { searchThreads } from "./nylas/email.js";
import { getAvailability } from "./nylas/calendar.js";
import { sendMessage } from "./nylas/send.js";
import { runPulse } from "./agent/pulse.js";

// Usage:
//   npm run pulse -- <contact-email>            agent pulse (review draft only)
//   npm run pulse -- <contact-email> --send     pulse, then confirm-to-send
//   npm run pulse -- <contact-email> --raw      dump raw threads + availability
//   npm run pulse -- <contact-email> --days 30  narrower lookback window

function parseArgs(argv: string[]) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const contactEmail = positional[0];
  if (!contactEmail || !contactEmail.includes("@")) {
    console.error("Usage: npm run pulse -- <contact-email> [--raw] [--send] [--days N]");
    process.exit(1);
  }
  const daysIdx = argv.indexOf("--days");
  return {
    contactEmail,
    raw: argv.includes("--raw"),
    send: argv.includes("--send"),
    daysBack: daysIdx >= 0 ? Number(argv[daysIdx + 1]) : 90,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const grant = requireGrant();
  const nylas = new NylasClient({ apiKey: config.nylasApiKey, apiUri: config.nylasApiUri });

  if (args.raw) {
    // M2 sanity mode: real API responses, no LLM involved.
    const threads = await searchThreads(nylas, grant.grantId, args.contactEmail, args.daysBack);
    const slots = await getAvailability(nylas, grant.email, {
      daysAhead: 7,
      timezone: config.userTimezone,
    });
    console.log(JSON.stringify({ threads, availability: slots }, null, 2));
    return;
  }

  console.log(`Pulsing ${args.contactEmail} (last ${args.daysBack} days)...\n`);
  const result = await runPulse({
    anthropicApiKey: config.anthropicApiKey,
    nylas,
    grantId: grant.grantId,
    ownerEmail: grant.email,
    contactEmail: args.contactEmail,
    timezone: config.userTimezone,
    daysBack: args.daysBack,
    onProgress: (note) => console.log(`  [${note}]`),
  });

  console.log(`\n${result.report}\n`);

  if (!result.draft) {
    console.log("(The agent did not record a draft, so there is nothing to send.)");
    return;
  }

  if (!args.send) {
    console.log("Draft not sent. Re-run with --send to review and send it.");
    return;
  }

  // The ONLY send path: explicit human confirmation in the terminal.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `Send this draft to ${result.draft.to}? Type "yes" to send: `,
  );
  rl.close();

  if (answer.trim().toLowerCase() !== "yes") {
    console.log("Not sent.");
    return;
  }

  const sent = await sendMessage(nylas, grant.grantId, {
    to: [{ email: result.draft.to }],
    subject: result.draft.subject,
    body: result.draft.body,
  });
  console.log(`Sent. Nylas message id: ${sent.messageId}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
