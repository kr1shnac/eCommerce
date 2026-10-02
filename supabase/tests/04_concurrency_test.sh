#!/usr/bin/env bash
#
# 04 · Two customers, one packet of mango.
#
# This is the only test that cannot live in a .sql file, because the whole point
# is two database sessions racing each other at the same instant. PostgreSQL
# serialises them with a row lock; these tests prove that the serialisation
# actually protects the stock.
#
# It is also the test most people forget to write, and the bug it catches is the
# one a customer would tell you about: "I paid for mango and got rice."
#
# Called by run.sh, which has already exported PGHOST/PGPORT/PGUSER/PGDATABASE.

set -uo pipefail

STORE='00000000-0000-4000-8000-000000000001'
MANGO='20000000-0000-4000-8000-00000000ffff'
ASHA='11111111-1111-1111-1111-111111111111'
ASHA_ADDR='50000000-0000-4000-8000-000000000001'
RAVI='22222222-2222-2222-2222-222222222222'
RAVI_ADDR='50000000-0000-4000-8000-000000000004'
ADMIN='33333333-3333-3333-3333-333333333333'

SUITE='04 concurrency'

psql_q() { psql -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

# Assert from bash. $1 = pass(1/0), $2 = name, $3 = detail
# Dollar quoting, because a label like "the shop's own decrement" contains an
# apostrophe and would otherwise close the SQL string.
assert() {
  local ok="$1" name="$2" detail="${3:-}"
  local sql="select test_result.record(\$\$04 concurrency\$\$, \$\$$name\$\$, "
  if [ "$ok" = 1 ]; then sql="$sql true, "; else sql="$sql false, "; fi
  sql="$sql\$\$$(printf '%s' "$detail" | tr -d '\n')\$\$);"

  if ! psql_q -c "$sql" >/dev/null; then
    echo "  FAIL could not even record: $name"
    return 1
  fi

  if [ "$ok" = 1 ]; then
    echo "  ok   $name"
  else
    echo "  FAIL $name${detail:+ -- $detail}"
  fi
}

# place_order as $1, for one of product $2, at address $3, key $4.
# Prints "<ok>|<error>" and leaves the elapsed milliseconds in PLACE_MS.
# sign_in() is used rather than set_config() because psql prints the result of
# every -c, and set_config would leak the uid into the answer below.
place_one() {
  local uid="$1" product="$2" address="$3" key="$4"
  local start end out
  start=$(date +%s%N)
  out=$(psql_q -t -A \
    -c "set role authenticated" \
    -c "select test_result.sign_in('$uid')" \
    -c "select coalesce(r->>'ok','') || '|' || coalesce(r->>'error','')
         from (select public.place_order(
                 '[{\"product_id\":\"$product\",\"quantity\":1}]',
                 '$STORE', '$address', '$key') as r) s;" \
    | grep -E '^(true|false)\|' | head -1)
  end=$(date +%s%N)
  PLACE_MS=$(( (end - start) / 1000000 ))
  printf '%s' "$out"
}

echo "=== $SUITE ==="

# -----------------------------------------------------------------------------
# Set the scene: one mango left, priced so a single packet clears the shop's
# Rs 100 minimum. That lets both customers order nothing BUT the contested mango,
# so nothing else can be locking the row for them.
# -----------------------------------------------------------------------------
psql_q -c "update public.products set stock_qty = 1, is_active = true, price_paise = 12000 where id = '$MANGO';" >/dev/null
psql_q -c "update public.store_settings set is_open = true, open_time = '00:00', close_time = '23:59' where store_id = '$STORE';" >/dev/null

# =============================================================================
# Race 1 · two place_order calls fired at the same instant
# =============================================================================

race_one() {
  local uid="$1" product="$2" address="$3" key="$4" out="$5"
  psql_q -t -A \
    -c "set role authenticated" \
    -c "select test_result.sign_in('$uid')" \
    -c "select coalesce(r->>'ok','') || '|' || coalesce(r->>'error','')
         from (select public.place_order(
                 '[{\"product_id\":\"$product\",\"quantity\":1}]',
                 '$STORE', '$address', '$key') as r) s;" \
    | grep -E '^(true|false)\|' > "$out"
}

race_one "$ASHA" "$MANGO" "$ASHA_ADDR" 'race-asha-0041' /tmp/grocery-race-asha.txt &
PID_A=$!
race_one "$RAVI" "$MANGO" "$RAVI_ADDR" 'race-ravi-0041' /tmp/grocery-race-ravi.txt &
PID_R=$!
wait $PID_A $PID_R

ASHA_RACE="$(tr -d ' \n' < /tmp/grocery-race-asha.txt)"
RAVI_RACE="$(tr -d ' \n' < /tmp/grocery-race-ravi.txt)"
rm -f /tmp/grocery-race-asha.txt /tmp/grocery-race-ravi.txt

echo "  asha=$ASHA_RACE  ravi=$RAVI_RACE"

WINNERS=0
[ "${ASHA_RACE%%|*}" = "true" ] && WINNERS=$((WINNERS + 1))
[ "${RAVI_RACE%%|*}" = "true" ] && WINNERS=$((WINNERS + 1))

assert $([ "$WINNERS" = 1 ] && echo 1 || echo 0) \
  "race: exactly one of the two customers got the last mango" \
  "winners=$WINNERS asha=$ASHA_RACE ravi=$RAVI_RACE"

LOSER_ERROR=""
[ "${ASHA_RACE%%|*}" = "false" ] && LOSER_ERROR="${ASHA_RACE#*|}"
[ "${RAVI_RACE%%|*}" = "false" ] && LOSER_ERROR="${RAVI_RACE#*|}"

assert $([ "$LOSER_ERROR" = "items_unavailable" ] && echo 1 || echo 0) \
  "race: the one who lost was told items_unavailable, not given a phantom order" \
  "loser_error=$LOSER_ERROR"

STOCK_NOW="$(psql_q -c "select stock_qty from public.products where id = '$MANGO';")"
assert $([ "$STOCK_NOW" = "0" ] && echo 1 || echo 0) \
  "race: stock landed on exactly 0, never negative and never 1 again" \
  "stock=$STOCK_NOW"

ORDERS_MANGO="$(psql_q -c "select count(*) from public.orders o where exists (select 1 from public.order_items i where i.order_id = o.id and i.product_id = '$MANGO');")"
assert $([ "$ORDERS_MANGO" = "1" ] && echo 1 || echo 0) \
  "race: only one order in the whole shop contains that mango" \
  "orders=$ORDERS_MANGO"

# =============================================================================
# Race 2 · the loser has to WAIT for the lock, not read stale stock
#
# The shop takes the mango off the shelf in an open transaction and holds it for
# three seconds. A customer who places an order during that window must block
# until the shop commits, and only then be told the mango has gone.
# =============================================================================

psql_q -c "update public.products set stock_qty = 1 where id = '$MANGO';" >/dev/null

psql_q \
  -c "set role authenticated" \
  -c "select set_config('request.jwt.claim.sub', '$ADMIN', false)" \
  -c "begin" \
  -c "update public.products set stock_qty = stock_qty - 1 where id = '$MANGO'" \
  -c "select pg_sleep(3)" \
  -c "commit" >/dev/null 2>&1 &
SHOP_PID=$!

# Give the shop transaction time to take the row lock before the customer tries.
sleep 1

START=$(date +%s%N)
BLOCKED_OUT="$(place_one "$ASHA" "$MANGO" "$ASHA_ADDR" 'race-blocked-0044')"
END=$(date +%s%N)
WAIT_MS=$(( (END - START) / 1000000 ))

wait $SHOP_PID

echo "  blocked for ${WAIT_MS}ms, answer=$BLOCKED_OUT"

assert $([ "${BLOCKED_OUT#*|}" = "items_unavailable" ] && echo 1 || echo 0) \
  "blocked: the customer was refused once the shop committed" \
  "answer=$BLOCKED_OUT"

# It must have waited for the lock rather than reading the old stock and
# inventing an order. The shop holds the lock for ~2 more seconds.
assert $([ "$WAIT_MS" -ge 1200 ] && echo 1 || echo 0) \
  "blocked: the call actually waited on the row lock instead of guessing" \
  "waited=${WAIT_MS}ms"

ORDER_GHOST="$(psql_q -c "select count(*) from public.orders where idempotency_key = 'race-blocked-0044';")"
assert $([ "$ORDER_GHOST" = "0" ] && echo 1 || echo 0) \
  "blocked: no order was created while it waited" \
  "orders=$ORDER_GHOST"

STOCK_FINAL="$(psql_q -c "select stock_qty from public.products where id = '$MANGO';")"
assert $([ "$STOCK_FINAL" = "0" ] && echo 1 || echo 0) \
  "blocked: the shop's own decrement is the only one that counted" \
  "stock=$STOCK_FINAL"