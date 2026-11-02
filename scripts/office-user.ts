import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { getDb } from "@/server/db";
import { OfficeUserError, officeUserEmail, officeUsers } from "@/server/office/users";

const USAGE = "Usage: npm run office-user -- add <email> | remove <email> | list [--yes]";
export type OfficeUserCommand = { operation: "list" } | { operation: "add" | "remove"; email: string; yes: boolean };

export function parseOfficeUserCommand(args: string[]): OfficeUserCommand {
  const yes = args.includes("--yes");
  const positional = args.filter((arg) => arg !== "--yes");
  if (args.filter((arg) => arg === "--yes").length > 1) throw new Error(USAGE);
  if (positional[0] === "list" && positional.length === 1) return { operation: "list" };
  if ((positional[0] === "add" || positional[0] === "remove") && positional.length === 2) {
    return { operation: positional[0], email: officeUserEmail(positional[1]), yes };
  }
  throw new Error(USAGE);
}

type CommandDeps = {
  users: ReturnType<typeof officeUsers>;
  print: (line: string) => void;
  confirm: (question: string) => Promise<string>;
};

/** Kept separate from process I/O so confirmation and cancellation can be tested without real accounts. */
export async function runOfficeUserCommand(command: OfficeUserCommand, deps: CommandDeps): Promise<void> {
  if (command.operation === "list") {
    const users = await deps.users.list();
    if (!users.length) deps.print("No office users.");
    for (const user of users) deps.print(`${user.email}\t${user.since?.toISOString() ?? "Since unknown (predates office-user audit)"}`);
    return;
  }
  const user = await deps.users.find(command.email);
  const target = command.operation === "add" ? "ADMIN" : "CUSTOMER";
  if (user.role === target || (command.operation === "remove" && user.role !== "ADMIN")) {
    deps.print(`${user.email}: no change needed (${user.role}).`);
    return;
  }
  deps.print(`Set ${user.email} from ${user.role} to ${target}.`);
  if (command.operation === "remove") deps.print("Revoke all current sessions and refresh tokens. Office access ends immediately.");
  if (!command.yes && (await deps.confirm("Continue? [y/N] ")).trim().toLowerCase() !== "y") {
    deps.print("Cancelled. No changes made.");
    return;
  }
  const result = await deps.users[command.operation](command.email);
  deps.print(`${result.email}: ${result.role}${result.changed ? "." : " (already set)."}`);
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL must be set. No changes made.");
  const command = parseOfficeUserCommand(process.argv.slice(2));
  const db = getDb();
  let prompt: ReturnType<typeof createInterface> | undefined;
  try {
    await runOfficeUserCommand(command, {
      users: officeUsers(db), print: (line) => console.log(line),
      confirm: async (question) => {
        prompt ??= createInterface({ input: process.stdin, output: process.stdout });
        return prompt.question(question);
      },
    });
  } finally {
    prompt?.close();
    await db.$disconnect();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error: unknown) => {
    // Database/provider errors may include connection strings. Only our known messages may reach the terminal.
    console.error(error instanceof OfficeUserError || (error instanceof Error && [USAGE, "DATABASE_URL must be set. No changes made."].includes(error.message))
      ? error.message : "Office user command failed. Check database access and Auth session-table permissions; use list to verify the current role.");
    process.exitCode = 1;
  });
}
