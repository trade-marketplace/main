// Turns axe results into a message a person can act on. Plain code with no browser, so Vitest can test it.

/** The parts of an axe `Result` we print. */
export type AxeViolation = {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  nodes: { target: unknown[]; failureSummary?: string }[];
};

export function formatViolations(violations: AxeViolation[], where: string): string {
  if (violations.length === 0) return `No accessibility violations on ${where}.`;

  const lines = [`${violations.length} accessibility violation(s) on ${where}:`];
  for (const violation of violations) {
    lines.push("", `- [${violation.impact ?? "unknown"}] ${violation.id}: ${violation.help}`, `  ${violation.helpUrl}`);
    for (const node of violation.nodes) {
      lines.push(`  at ${node.target.map(String).join(" ")}`);
      if (node.failureSummary) {
        lines.push(...node.failureSummary.split("\n").map((line) => `    ${line.trim()}`));
      }
    }
  }
  return lines.join("\n");
}
