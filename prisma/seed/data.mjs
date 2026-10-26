// The demo data `npm run db:seed` writes (#88). Every name, address, phone number, licence number and figure here is
// an example: clearly fake people at `@demo.test`, made-up streets in Invercargill (DECISIONS.md 12).
// Passwords are never here: they come from SEED_DEMO_PASSWORD (.env.example).

/** Fixed ids, so seeding again updates the same rows instead of adding more. */
const id = (/** @type {number} */ n) => `de000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/**
 * @typedef {"customer" | "tradie" | "otherWorker" | "office"} PersonKey
 * @typedef {"CUSTOMER" | "TRADIE" | "ADMIN"} Role
 * @typedef {"ELECTRICAL" | "PLUMBING" | "GAS" | "CONSTRUCTION" | "OTHER"} Trade
 * @typedef {"REVIEW" | "QUOTE_BOUNTY" | "PRICED" | "BOOKABLE" | "ASSIGNED" | "SUBMITTED" | "COMPLETED"
 *   | "CANCEL_REVIEW" | "CANCELLED"} JobStatus
 * @typedef {"MORNING" | "AFTERNOON" | "EVENING"} TimeOfDay
 */

/**
 * @type {Record<PersonKey, {
 *   id: string; email: string; role: Role; firstName: string; lastName: string; phone: string;
 *   worker?: {
 *     bio: string; baseSuburb: string; areaLat: number; areaLng: number; areaRadiusKm: number; available: boolean;
 *     verified: boolean; trades: Trade[];
 *     licences: { trade: Trade; number: string; type: string; status: "VERIFIED" | "PENDING"; expiresInDays: number }[];
 *   };
 * }>}
 */
export const PEOPLE = {
  customer: {
    id: id(1),
    email: "customer@demo.test",
    role: "CUSTOMER",
    firstName: "Casey",
    lastName: "Demo-Customer",
    phone: "+64210000001",
  },
  tradie: {
    id: id(2),
    email: "tradie@demo.test",
    role: "TRADIE",
    firstName: "Toby",
    lastName: "Demo-Sparky",
    phone: "+64210000002",
    worker: {
      bio: "Demo registered electrician. Evenings and weekends around Invercargill.",
      baseSuburb: "Gladstone",
      areaLat: -46.3985,
      areaLng: 168.3575,
      areaRadiusKm: 25,
      available: true,
      verified: true,
      trades: ["ELECTRICAL"],
      licences: [
        { trade: "ELECTRICAL", number: "DEMO-EW-0001", type: "Registered electrician", status: "VERIFIED", expiresInDays: 400 },
      ],
    },
  },
  otherWorker: {
    id: id(3),
    email: "worker@demo.test",
    role: "TRADIE",
    firstName: "Olive",
    lastName: "Demo-Worker",
    phone: "+64210000003",
    worker: {
      bio: "Demo all-rounder: moving, flat-pack, garden tidy-ups.",
      baseSuburb: "Windsor",
      areaLat: -46.3938,
      areaLng: 168.3712,
      areaRadiusKm: 10,
      available: true,
      // Not checked by the office yet: no verified badge (DECISIONS.md 1).
      verified: false,
      trades: ["OTHER"],
      licences: [],
    },
  },
  office: {
    id: id(4),
    email: "office@demo.test",
    role: "ADMIN",
    firstName: "Ora",
    lastName: "Demo-Office",
    phone: "+64210000004",
  },
};

/** The demo customer's saved places. Made-up streets; coordinates are near the suburb's centre. */
export const ADDRESSES = {
  home: {
    id: id(0xa001),
    label: "Home",
    line1: "12 Demo Street",
    suburb: "Gladstone",
    city: "Invercargill",
    postcode: "9810",
    lat: -46.3961,
    lng: 168.3561,
    isDefault: true,
  },
  rental: {
    id: id(0xa002),
    label: "Rental",
    line1: "7 Example Road",
    suburb: "Windsor",
    city: "Invercargill",
    postcode: "9810",
    lat: -46.3925,
    lng: 168.3701,
    isDefault: false,
  },
};

/**
 * Example rates, copied into job_pricing like the office would (DECISIONS.md, launch rates #62): $70/hr licensed,
 * $38/hr Other, 2 h / 1 h minimum, 20% margin. Holiday pay and on-costs follow BUSINESS_PLAN.md's example
 * (12.5% on-costs incl. 8% holiday pay). These are seed figures only; the real pricing maths is its own task.
 */
export const EXAMPLE_RATES = {
  licensed: { workerRateCents: 7000, minMinutes: 120 },
  other: { workerRateCents: 3800, minMinutes: 60 },
  holidayPayBps: 800,
  onCostBps: 450,
  marginBps: 2000,
  gstBps: 1500,
};

/**
 * @typedef {{
 *   id: string; category: Trade; title: string; description: string; address: keyof typeof ADDRESSES;
 *   accessNotes?: string; asap?: boolean; anyTime?: boolean; postedDaysAgo: number;
 *   photos: { file: string; by: PersonKey }[];
 *   windows: [number, TimeOfDay][];
 *   estimates: { by: PersonKey; minutes: number; materialsCents: number; note?: string; needsSiteVisit?: boolean }[];
 *   pricing?: { minutes: number; materialsCents: number; note: string };
 *   worker?: PersonKey; booked?: [number, TimeOfDay];
 *   steps: [JobStatus, PersonKey | null][];
 *   checkoutStarted?: boolean;
 *   extraWork?: { by: PersonKey; description: string; minutes: number; materialsCents: number }[];
 *   materialsSpentCents?: number;
 * }} DemoJob
 */

/**
 * At least one job in every status, across all five trades. `steps` is the way the job got to its status after
 * being posted (as REVIEW) and who made each change, so the status-history trigger writes a believable history.
 * `windows` and `booked` are days from the day the seed runs, so previews always show upcoming windows.
 *
 * Money (Schema 3) follows the steps too: every job that went to BOOKABLE was paid for (a test-mode payment for its
 * price), `checkoutStarted` leaves a pending payment on a priced job, a worker who claims a job gets its materials
 * budget and reports `materialsSpentCents` when they submit, a COMPLETED job has its worker's payout queued, and
 * `extraWork` is asked for by the worker after claiming, waiting for the office to price it.
 * @type {DemoJob[]}
 */
export const JOBS = [
  {
    id: id(0xb001),
    category: "ELECTRICAL",
    title: "Heat pump circuit for a new 6 kW unit",
    description:
      "Getting a heat pump put in the lounge. The installer says it needs its own circuit from the switchboard, " +
      "about an 8 m run. The switchboard is in the garage.",
    address: "home",
    postedDaysAgo: 0.3,
    photos: [
      { file: "heat-pump-wall.webp", by: "customer" },
      { file: "switchboard.webp", by: "customer" },
    ],
    windows: [
      [3, "MORNING"],
      [4, "AFTERNOON"],
    ],
    estimates: [{ by: "tradie", minutes: 180, materialsCents: 12000, note: "RCBO, cable and an outdoor isolator." }],
    steps: [],
  },
  {
    id: id(0xb002),
    category: "OTHER",
    title: "Move a three-seater couch upstairs",
    description: "Couch needs to go from the garage to the upstairs flat. Narrow stairs with one turn.",
    address: "rental",
    accessNotes: "Side gate code 0000. Parking on the street.",
    anyTime: true,
    postedDaysAgo: 1,
    photos: [{ file: "couch-stairs.webp", by: "customer" }],
    windows: [],
    estimates: [{ by: "otherWorker", minutes: 60, materialsCents: 0, note: "Two people, straps." }],
    steps: [],
  },
  {
    id: id(0xb003),
    category: "PLUMBING",
    title: "Low water pressure in the whole house",
    description: "Pressure dropped over a month at every tap, worst in the shower. No leaks we can see.",
    address: "home",
    postedDaysAgo: 2,
    photos: [{ file: "low-pressure-tap.webp", by: "customer" }],
    windows: [
      [2, "MORNING"],
      [2, "AFTERNOON"],
      [5, "MORNING"],
    ],
    estimates: [],
    // Can't be priced from photos: someone has to go and look (DECISIONS.md 2).
    steps: [["QUOTE_BOUNTY", "office"]],
  },
  {
    id: id(0xb004),
    category: "GAS",
    title: "Swap an old gas hob for a new one",
    description: "Four-burner gas hob, same size cut-out. The new hob is here and boxed.",
    address: "home",
    postedDaysAgo: 3,
    photos: [{ file: "gas-hob.webp", by: "customer" }],
    windows: [
      [6, "AFTERNOON"],
      [7, "MORNING"],
    ],
    estimates: [],
    pricing: { minutes: 120, materialsCents: 4500, note: "Standard hob swap, 2 h minimum, fittings and test." },
    steps: [["PRICED", "office"]],
    // The customer went to pay and hasn't finished.
    checkoutStarted: true,
  },
  {
    id: id(0xb005),
    category: "CONSTRUCTION",
    title: "Replace rotten deck boards by the steps",
    description: "About six boards are soft near the steps. Joists look OK from underneath.",
    address: "rental",
    postedDaysAgo: 5,
    photos: [{ file: "deck-boards.webp", by: "customer" }],
    windows: [
      [5, "MORNING"],
      [8, "MORNING"],
    ],
    estimates: [],
    pricing: { minutes: 240, materialsCents: 18000, note: "Six boards, screws and stain." },
    steps: [
      ["PRICED", "office"],
      ["BOOKABLE", "customer"],
    ],
  },
  {
    id: id(0xb006),
    category: "ELECTRICAL",
    title: "Kitchen reno: move two plugs and add a dishwasher plug",
    description: "Two benchtop doubles move along the wall and a new plug goes under the sink. The gib is off.",
    address: "home",
    accessNotes: "Side door unlocked from 8.",
    postedDaysAgo: 8,
    photos: [{ file: "kitchen-plugs.webp", by: "customer" }],
    windows: [
      [1, "MORNING"],
      [2, "MORNING"],
    ],
    estimates: [{ by: "tradie", minutes: 300, materialsCents: 22000 }],
    pricing: { minutes: 300, materialsCents: 22000, note: "From one estimate and the price book." },
    worker: "tradie",
    booked: [1, "MORNING"],
    steps: [
      ["PRICED", "office"],
      ["BOOKABLE", "customer"],
      ["ASSIGNED", "tradie"],
    ],
    // Assigned with extra work: found on site, waiting for the office to price it.
    extraWork: [
      {
        by: "tradie",
        description: "Existing hob cable is nicked, needs a new run from the board, about 12 m.",
        minutes: 90,
        materialsCents: 9500,
      },
    ],
  },
  {
    id: id(0xb007),
    category: "OTHER",
    title: "Build a flat-pack wardrobe",
    description: "Two-door wardrobe, six boxes. Needs fixing to the wall.",
    address: "rental",
    postedDaysAgo: 10,
    photos: [
      { file: "wardrobe-boxes.webp", by: "customer" },
      // The worker's photo of the finished job, sent with "I'm done".
      { file: "wardrobe-built.webp", by: "otherWorker" },
    ],
    windows: [[-1, "AFTERNOON"]],
    estimates: [{ by: "otherWorker", minutes: 150, materialsCents: 0 }],
    pricing: { minutes: 150, materialsCents: 1500, note: "Wall anchors included." },
    worker: "otherWorker",
    booked: [-1, "AFTERNOON"],
    steps: [
      ["PRICED", "office"],
      ["BOOKABLE", "customer"],
      ["ASSIGNED", "otherWorker"],
      ["SUBMITTED", "otherWorker"],
    ],
    materialsSpentCents: 1380,
  },
  {
    id: id(0xb008),
    category: "ELECTRICAL",
    title: "Outdoor double plug on the deck",
    description: "Want a weatherproof double plug on the deck for a heater.",
    address: "home",
    postedDaysAgo: 20,
    photos: [{ file: "outdoor-plug.webp", by: "customer" }],
    windows: [[-14, "MORNING"]],
    estimates: [{ by: "tradie", minutes: 120, materialsCents: 4000 }],
    pricing: { minutes: 120, materialsCents: 4000, note: "2 h minimum." },
    worker: "tradie",
    booked: [-14, "MORNING"],
    steps: [
      ["PRICED", "office"],
      ["BOOKABLE", "customer"],
      ["ASSIGNED", "tradie"],
      ["SUBMITTED", "tradie"],
      ["COMPLETED", "customer"],
    ],
    materialsSpentCents: 4210,
  },
  {
    id: id(0xb009),
    category: "PLUMBING",
    title: "Hot water cylinder dripping from the valve",
    description: "Slow drip from the pressure valve on top of the cylinder in the hall cupboard.",
    address: "rental",
    postedDaysAgo: 6,
    photos: [{ file: "hot-water-cylinder.webp", by: "customer" }],
    windows: [[4, "EVENING"]],
    estimates: [],
    pricing: { minutes: 120, materialsCents: 9000, note: "Replace valve, 2 h minimum." },
    // Paid, then cancelled: the office reviews it before any refund.
    steps: [
      ["PRICED", "office"],
      ["BOOKABLE", "customer"],
      ["CANCEL_REVIEW", "customer"],
    ],
  },
  {
    id: id(0xb00a),
    category: "CONSTRUCTION",
    title: "Two fence panels blown down",
    description: "Two timber panels on the back boundary came down in the wind. Posts look fine.",
    address: "home",
    postedDaysAgo: 12,
    photos: [{ file: "fence-panel.webp", by: "customer" }],
    windows: [[-5, "MORNING"]],
    estimates: [],
    // Cancelled before it was priced, so it never had a price.
    steps: [["CANCELLED", "customer"]],
  },
];

/**
 * Fixed ids for a demo job's money rows, from the job's own id (de…b006 → payment de…c006, payout de…d006, extra
 * work de…e006 onwards), so seeding again makes the same rows.
 * @param {string} jobId
 */
export function moneyIds(jobId) {
  const n = Number.parseInt(jobId.slice(-3), 16);
  return {
    payment: id(0xc000 + n),
    payout: id(0xd000 + n),
    variation: (/** @type {number} */ index) => id(0xe000 + n * 0x10 + index),
  };
}

/**
 * Test-mode payment references. Stripe's real ids are random; these say DEMO so nobody mistakes them for a real
 * charge, and payments.livemode stays false.
 * @param {string} jobId
 */
export function testPaymentRefs(jobId) {
  const suffix = jobId.slice(-4);
  return {
    checkoutId: `cs_test_DEMO_${suffix}`,
    paymentId: `pi_test_DEMO_${suffix}`,
    idempotencyKey: `demo-job-payment-${jobId}`,
  };
}

/** Where a demo photo is stored. Uploads (#96) will put `prisma/seed/photos/<file>` at this path in the bucket. */
export const photoPath = (/** @type {string} */ file) => `demo/${file}`;

/**
 * An example of how a price is built, in whole cents (BUSINESS_PLAN.md "Pricing"): worker pay, holiday pay and
 * on-costs, materials at cost, a margin on all of that, then GST. Demo figures only.
 * @param {{ minutes: number; materialsCents: number }} work
 * @param {Trade} category
 */
export function examplePricing(work, category) {
  const rates = category === "OTHER" ? EXAMPLE_RATES.other : EXAMPLE_RATES.licensed;
  const minutes = Math.max(work.minutes, rates.minMinutes);
  const workerGrossCents = Math.round((rates.workerRateCents * minutes) / 60);
  const holidayPayCents = Math.round((workerGrossCents * EXAMPLE_RATES.holidayPayBps) / 10000);
  const onCostCents = Math.round((workerGrossCents * EXAMPLE_RATES.onCostBps) / 10000);
  const costCents = workerGrossCents + holidayPayCents + onCostCents + work.materialsCents;
  const marginCents = Math.round((costCents * EXAMPLE_RATES.marginBps) / 10000);
  const gstCents = Math.round(((costCents + marginCents) * EXAMPLE_RATES.gstBps) / 10000);
  return {
    workerRateCents: rates.workerRateCents,
    minMinutes: rates.minMinutes,
    holidayPayBps: EXAMPLE_RATES.holidayPayBps,
    onCostBps: EXAMPLE_RATES.onCostBps,
    marginBps: EXAMPLE_RATES.marginBps,
    gstBps: EXAMPLE_RATES.gstBps,
    minutes,
    materialsCents: work.materialsCents,
    workerGrossCents,
    holidayPayCents,
    onCostCents,
    marginCents,
    gstCents,
    priceCents: costCents + marginCents + gstCents,
  };
}
