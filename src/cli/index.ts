/**
 * Thin CLI — command wiring only, no business logic (blueprint §5). Commands are added as their
 * slices land: serve-mock (now), then discover / replay / catalog / operator.
 */
const [cmd, ...rest] = process.argv.slice(2);

async function main(): Promise<void> {
  switch (cmd) {
    case "serve-mock": {
      const { startMockBank } = await import("../../mock-bank/src/server.js");
      const port = Number(argValue(rest, "--port") ?? 4010);
      await startMockBank(port);
      console.log(`mock-bank listening on http://localhost:${port}  (tenants: /t/acme, /t/globus)`);
      break;
    }
    default:
      console.error(`unknown command: ${cmd ?? "(none)"}\ncommands: serve-mock`);
      process.exit(1);
  }
}

export function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

void main();
