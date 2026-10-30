/**
 * 04 · Two customers, one packet of mango.
 *
 * This is the only suite that cannot live in a .sql file, because the whole
 * point is two database sessions racing each other at the same instant.
 * PostgreSQL serialises them with a row lock; these tests prove that the
 * serialisation actually protects the stock.
 *
 * It used to be bash. It is JavaScript now so the same suite runs on Windows,
 * where there is no bash and where `date +%s%N` does not exist. Every label and
 * every assertion is kept identical to the shell version, so the total still
 * matches the rest of the database suite.
 *
 * Called by `scripts/run-db-tests.mjs` after the migrations, seed and fixtures.
 */

import { spawn } from 'node:child_process';

const STORE = '00000000-0000-4000-8000-000000000001';
const MANGO = '20000000-0000-4000-8000-00000000ffff';
const ASHA = '11111111-1111-1111-1111-111111111111';
const ASHA_ADDR = '50000000-0000-4000-8000-000000000001';
const RAVI = '22222222-2222-2222-2222-222222222222';
const RAVI_ADDR = '50000000-0000-4000-8000-000000000004';
const ADMIN = '33333333-3333-3333-3333-333333333333';

const SUITE = '04 concurrency';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The one line of psql output that matters: `<ok>|<error>`. */
function answerOf(stdout) {
  return (
    (stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^(true|false)\|/.test(line)) ?? ''
  );
}

/**
 * @param {{
 *   db: {
 *     psql: Function,
 *     psqlPath: string,
 *     env: NodeJS.ProcessEnv,
 *     q: (sql: string) => string,
 *   },
 * }} context
 */
export async function runConcurrencyTest({ db }) {
  console.log(`=== ${SUITE} ===`);

  // Dollar quoting, because a label like "the shop's own decrement" contains an
  // apostrophe and would otherwise close the SQL string.
  function record(ok, name, detail = '') {
    const clean = String(detail).replace(/\s+/g, ' ').trim();
    // Build the dollar-quoted literals by concatenation: inside a JavaScript
    // template literal `$${name}` would interpolate the name and leave a single
    // `$`, which is a SQL syntax error.
    const sql =
      'select test_result.record($$04 concurrency$$, $$' +
      name +
      '$$, ' +
      (ok ? 'true' : 'false') +
      ', $$' +
      clean +
      '$$);';
    const result = db.psql(['-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
    if (result.status !== 0) {
      throw new Error(
        `could not record "${name}":\n${result.stderr || result.stdout}`,
      );
    }
    if (ok) console.log(`  ok   ${name}`);
    else console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }

  /**
   * place_order as one customer. Returns `{ answer, elapsedMs }` where answer is
   * `<ok>|<error>`.
   *
   * sign_in() is used rather than set_config() because psql prints the result of
   * every -c, and set_config would leak the uid into the answer.
   */
  function placeOne(uid, product, address, key) {
    const started = performance.now();
    const result = db.psql([
      '-q',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'set role authenticated',
      '-c',
      `select test_result.sign_in('${uid}')`,
      '-c',
      `select coalesce(r->>'ok','') || '|' || coalesce(r->>'error','')
         from (select public.place_order(
                 '[{"product_id":"${product}","quantity":1}]',
                 '${STORE}', '${address}', '${key}') as r) s;`,
    ]);
    const elapsedMs = performance.now() - started;
    if (result.status !== 0) {
      throw new Error(`place_order as ${uid} failed:\n${result.stderr || result.stdout}`);
    }
    return { answer: answerOf(result.stdout), elapsedMs };
  }

  /** Fire a place_order in another process and resolve its answer line. */
  function raceOne(uid, product, address, key) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        db.psqlPath,
        [
          '-X',
          '-q',
          '-t',
          '-A',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          'set role authenticated',
          '-c',
          `select test_result.sign_in('${uid}')`,
          '-c',
          `select coalesce(r->>'ok','') || '|' || coalesce(r->>'error','')
             from (select public.place_order(
                     '[{"product_id":"${product}","quantity":1}]',
                     '${STORE}', '${address}', '${key}') as r) s;`,
        ],
        { env: db.env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`race process for ${uid} exited ${code}:\n${stderr}`));
          return;
        }
        resolve(answerOf(stdout));
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Set the scene: one mango left, priced so a single packet clears the shop's
  // Rs 100 minimum. That lets both customers order nothing BUT the contested
  // mango, so nothing else can be locking the row for them.
  //
  // mrp_paise is raised alongside price_paise on purpose. The constraint added by
  // 20261003000002_db_constraints.sql (products_mrp_paise_ge_price) requires
  // mrp_paise >= price_paise, and the fixture mango is seeded at mrp 1200.
  // Bumping the price to 12000 while leaving the MRP behind is refused by the
  // database. The old shell version had no `-e`, so it carried on regardless:
  // the price stayed at 1000, every caller was turned away with below_minimum,
  // and the race under test never actually started. The guard below is what
  // stops that from happening silently.
  // ---------------------------------------------------------------------------
  db.q(
    `update public.products
        set stock_qty = 1, is_active = true, price_paise = 12000, mrp_paise = 15000
      where id = '${MANGO}';`,
  );
  db.q(
    `update public.store_settings
        set is_open = true, open_time = '00:00', close_time = '23:59'
      where store_id = '${STORE}';`,
  );

  const setupPrice = db.q(
    `select price_paise from public.products where id = '${MANGO}';`,
  );
  if (setupPrice !== '12000') {
    record(
      false,
      'race: the contested mango was really priced above the shop minimum',
      `price_paise=${setupPrice}`,
    );
    throw new Error(
      `setup did not take: mango is ${setupPrice} paise, wanted 12000. ` +
        'The rest of this race cannot mean anything until that is fixed.',
    );
  }
  record(
    true,
    'race: the contested mango was really priced above the shop minimum',
  );

  // ===========================================================================
  // Race 1 · two place_order calls fired at the same instant
  // ===========================================================================
  const [ashaRace, raviRace] = await Promise.all([
    raceOne(ASHA, MANGO, ASHA_ADDR, 'race-asha-0041'),
    raceOne(RAVI, MANGO, RAVI_ADDR, 'race-ravi-0041'),
  ]);

  console.log(`  asha=${ashaRace}  ravi=${raviRace}`);

  let winners = 0;
  if (ashaRace.split('|')[0] === 'true') winners += 1;
  if (raviRace.split('|')[0] === 'true') winners += 1;

  record(
    winners === 1,
    'race: exactly one of the two customers got the last mango',
    `winners=${winners} asha=${ashaRace} ravi=${raviRace}`,
  );

  let loserError = '';
  if (ashaRace.split('|')[0] === 'false') loserError = ashaRace.split('|')[1] ?? '';
  if (raviRace.split('|')[0] === 'false') loserError = raviRace.split('|')[1] ?? '';

  record(
    loserError === 'items_unavailable',
    'race: the one who lost was told items_unavailable, not given a phantom order',
    `loser_error=${loserError}`,
  );

  const stockNow = db.q(
    `select stock_qty from public.products where id = '${MANGO}';`,
  );
  record(
    stockNow === '0',
    'race: stock landed on exactly 0, never negative and never 1 again',
    `stock=${stockNow}`,
  );

  const ordersMango = db.q(
    `select count(*) from public.orders o
      where exists (
        select 1 from public.order_items i
         where i.order_id = o.id and i.product_id = '${MANGO}'
      );`,
  );
  record(
    ordersMango === '1',
    'race: only one order in the whole shop contains that mango',
    `orders=${ordersMango}`,
  );

  // ===========================================================================
  // Race 2 · the loser has to WAIT for the lock, not read stale stock
  //
  // The shop takes the mango off the shelf in an open transaction and holds it
  // for three seconds. A customer who places an order during that window must
  // block until the shop commits, and only then be told the mango has gone.
  // ===========================================================================
  db.q(`update public.products set stock_qty = 1 where id = '${MANGO}';`);

  const shop = spawn(
    db.psqlPath,
    [
      '-X',
      '-q',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'set role authenticated',
      '-c',
      `select set_config('request.jwt.claim.sub', '${ADMIN}', false)`,
      '-c',
      'begin',
      '-c',
      `update public.products set stock_qty = stock_qty - 1 where id = '${MANGO}'`,
      '-c',
      'select pg_sleep(3)',
      '-c',
      'commit',
    ],
    { env: db.env, stdio: 'ignore' },
  );
  const shopDone = new Promise((resolve, reject) => {
    shop.on('error', reject);
    shop.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`shop transaction exited ${code}`));
    });
  });

  // Give the shop transaction time to take the row lock before the customer tries.
  await sleep(1000);

  const blocked = placeOne(ASHA, MANGO, ASHA_ADDR, 'race-blocked-0044');
  await shopDone;

  console.log(
    `  blocked for ${Math.round(blocked.elapsedMs)}ms, answer=${blocked.answer}`,
  );

  record(
    blocked.answer.split('|')[1] === 'items_unavailable',
    'blocked: the customer was refused once the shop committed',
    `answer=${blocked.answer}`,
  );

  // It must have waited for the lock rather than reading the old stock and
  // inventing an order. The shop holds the lock for ~2 more seconds.
  record(
    blocked.elapsedMs >= 1200,
    'blocked: the call actually waited on the row lock instead of guessing',
    `waited=${Math.round(blocked.elapsedMs)}ms`,
  );

  const ghost = db.q(
    `select count(*) from public.orders where idempotency_key = 'race-blocked-0044';`,
  );
  record(
    ghost === '0',
    'blocked: no order was created while it waited',
    `orders=${ghost}`,
  );

  const finalStock = db.q(
    `select stock_qty from public.products where id = '${MANGO}';`,
  );
  record(
    finalStock === '0',
    "blocked: the shop's own decrement is the only one that counted",
    `stock=${finalStock}`,
  );
}
