/** Hidden check of the algorithm task: the spec's edge cases, and its speed requirement. */
const JOURNEY_CHECK = String.raw`node --input-type=module <<'EOF'
import assert from "node:assert/strict";
const m = await import(process.cwd() + "/journey.js");
const earliestArrival = m.earliestArrival ?? m.default?.earliestArrival ?? m.default;
const c = (trip, from, to, dep, arr) => ({ trip, from, to, dep, arr });
assert.deepEqual(earliestArrival([], "A", "A", "08:00"), { arrival: "08:00", trips: 0 });
// Staying aboard needs no time; changing needs 5 minutes.
const t1 = [c("T1", "A", "B", "08:00", "08:30"), c("T1", "B", "C", "08:30", "09:00"), c("T2", "B", "C", "08:33", "08:50")];
assert.deepEqual(earliestArrival(t1, "A", "C", "07:00"), { arrival: "09:00", trips: 1 });
assert.deepEqual(earliestArrival([...t1, c("T3", "B", "C", "08:35", "08:55")], "A", "C", "07:00"), { arrival: "08:55", trips: 2 });
// Boarding at exactly the time the traveller is there is allowed; earlier is not.
assert.deepEqual(earliestArrival(t1, "A", "B", "08:00"), { arrival: "08:30", trips: 1 });
assert.equal(earliestArrival(t1, "A", "B", "08:01"), null);
// Same arrival: fewer trips wins.
const tie = [c("T6", "A", "B", "07:00", "07:30"), c("T7", "B", "C", "08:00", "09:00"), c("T5", "A", "C", "08:10", "09:00")];
assert.deepEqual(earliestArrival(tie, "A", "C", "06:00"), { arrival: "09:00", trips: 1 });
assert.equal(earliestArrival(t1, "C", "A", "00:00"), null);
assert.equal(earliestArrival(t1, "A", "Z", "00:00"), null);
// 50,000 connections in well under a second.
let seed = 1;
const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
const hm = (t) => String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
const big = [];
for (let trip = 0; big.length < 50000; trip++) {
  let st = rnd(500), t = rnd(1300);
  for (let j = 0; j < 20 && big.length < 50000; j++) {
    const next = (st + 1 + rnd(499)) % 500, arr = t + 1 + rnd(10);
    if (arr > 1439) break;
    big.push(c("T" + trip, "S" + st, "S" + next, hm(t), hm(arr)));
    st = next; t = arr + rnd(3);
  }
}
const start = performance.now();
earliestArrival(big, "S1", "S499", "00:00");
const ms = performance.now() - start;
assert.ok(ms < 1000, "50,000 connections took " + Math.round(ms) + " ms");
console.log("all journey checks passed");
EOF`;

/** Hidden check of the bug fix task: one assertion per rule of the spec. */
const CART_CHECK = String.raw`node --input-type=module <<'EOF'
import assert from "node:assert/strict";
const { cartTotal } = await import(process.cwd() + "/cart.js");
const items = [{ price: 1, qty: 1 }, { price: 5, qty: 1 }];
const before = JSON.stringify(items);
assert.equal(cartTotal(items, null), 505);
assert.equal(JSON.stringify(items), before, "arguments modified");
assert.equal(cartTotal([{ price: 1000, qty: 1 }], undefined), 1499);
assert.equal(cartTotal([{ price: 100, qty: 10 }], null), 1449);
assert.equal(cartTotal([{ price: 1, qty: 10 }], null), 509);
assert.equal(cartTotal([{ price: 2000, qty: 3 }], "save10"), 5400);
assert.equal(cartTotal([{ price: 5200, qty: 1 }], "SAVE10"), 5179);
assert.equal(cartTotal([{ price: 15, qty: 1 }], "SAVE10"), 513);
assert.equal(cartTotal([{ price: 1000, qty: 1 }], "freeship"), 1000);
assert.throws(() => cartTotal([{ price: 1000, qty: 1 }], "BOGUS"), { message: "unknown coupon" });
console.log("all cart checks passed");
EOF`;

/**
 * Tasks offered on the empty screen, one per kind of task public comparisons of coding agents use:
 * building a small app or game, implementing an algorithm to a precise spec, and fixing bugs in existing code.
 * The last two carry a hidden check: assertions on edge cases of the spec, run after each turn, never shown
 * to the agents. The game has none: whether it plays well is for the person to judge.
 */
export const EXAMPLES: { title: string; summary: string; prompt: string; check: string | null }[] = [
  {
    title: "A mini game",
    summary: "A Snake game in one HTML file.",
    prompt:
      "Create a tiny Snake game in a single index.html file, with no dependencies and no external files. Arrow keys move the snake, eating food grows it by one and adds a point, hitting a wall or itself ends the game, and Space restarts. Show the score.",
    check: null,
  },
  {
    title: "An algorithm",
    summary: "Earliest arrival through a train timetable, with transfers.",
    prompt:
      'Create journey.js, a Node.js module with no dependencies, exporting earliestArrival(connections, from, to, departAt).\n\nconnections is an array of { trip, from, to, dep, arr }: a train of trip trip leaves station from at dep and reaches station to at arr. Times are "HH:MM" strings within one day, and dep < arr.\n\nA traveller is at station from at time departAt. They may board a connection that leaves their current station at or after the time they are there. Staying on the same trip needs no time; changing to another trip needs at least 5 minutes at the station (the first boarding needs none).\n\nReturn { arrival, trips }: the earliest possible arrival time at station to, as "HH:MM", and the number of distinct trips used. When several journeys reach to at that earliest time, return the smallest number of trips. Return null when to cannot be reached. When from equals to, return { arrival: departAt, trips: 0 }.\n\nIt must stay fast: 50,000 connections must be handled in well under a second.',
    check: JOURNEY_CHECK,
  },
  {
    title: "Fix a bug",
    summary: "Find and fix the bugs in a shopping cart total.",
    prompt:
      'Create cart.js with exactly this code:\n\n```js\nexport function cartTotal(items, coupon) {\n  items.sort((a, b) => b.price - a.price);\n  let subtotal = 0;\n  for (const item of items) {\n    let line = item.price * item.qty;\n    if (item.qty > 10) line = line * 0.95;\n    subtotal += line;\n  }\n  const shipping = subtotal >= 5000 ? 0 : 499;\n  if (coupon === "SAVE10") subtotal = subtotal * 0.9;\n  if (coupon === "FREESHIP") return Math.round(subtotal);\n  return Math.round(subtotal + shipping);\n}\n```\n\nCustomers report wrong totals. Fix the bugs so that cartTotal follows these rules, keeping the same export and signature:\n\n- items is an array of { price, qty }: price in integer cents, qty an integer of at least 1. The result is the total in integer cents.\n- A line of 10 or more units gets 5% off that line, rounded to the nearest cent, halves rounded up.\n- The coupon SAVE10 takes 10% off the sum of the lines, rounded to the nearest cent, halves rounded up.\n- Shipping costs 499 cents, and is free when the sum after all discounts is at least 5000 cents. The coupon FREESHIP makes shipping free.\n- Coupon codes are case-insensitive. No coupon is null or undefined. Any other coupon throws an Error with the message "unknown coupon".\n- cartTotal must not modify its arguments.',
    check: CART_CHECK,
  },
];
