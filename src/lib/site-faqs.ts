/** The visible questions and answers also supply FAQ structured data; keep one source of wording. */
export const LANDING_FAQ = [
  ["Is it really free to post?", "Yes. Posting and getting a price is free. You only pay if you accept the price."],
  ["Who are the tradies?", "Local tradies and workers. Restricted work needs a licence checked by the office."],
  ["What if the job needs more work?", "Your tradie sends photos and details of the extra work. You see the price and say yes before it starts."],
  ["When do I pay?", "You pay when you accept the fixed price. If you don't want to go ahead, say no. Posting your job costs nothing."],
] as const;

export const WORKER_FAQ = [
  ["Any job?", "Yes. Other work needs photo ID. Restricted work needs a current licence."],
  ["Lead fees?", "None."],
] as const;
