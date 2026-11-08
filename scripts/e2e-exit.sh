#!/bin/bash
# Runs a full exit on NEAR testnet with real token transfers.
# Uses free faucet accounts and the test euro only. Not real money.
# Usage: bash scripts/e2e-exit.sh <short-suffix> <funded-testnet-account>
# Test accounts are funded from that account, because the free faucet stops
# creating accounts after a few in a row without saying so.
# Waits are shortened to 5 seconds so the script doesn't sit idle.

cd "$(dirname "$0")/.." || exit 1
S=${1:?give a short suffix, for example a1}
FUNDER=${2:?give a funded testnet account}
REG=reg-$S.$FUNDER; TOK=teur-$S.$FUNDER; ADM=admin-$S.$FUNDER
OPS=ops-$S.$FUNDER; SVC=svc-$S.$FUNDER
MARIA=maria-$S.$FUNDER; TOM=tom-$S.$FUNDER; PETER=peter-$S.$FUNDER
LENA=lena-$S.$FUNDER; ERIK=erik-$S.$FUNDER
TOTAL=5000000003
PASS=0; BAD=0

keys_on_chain() {
  curl -s -m 15 -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$1\"}}" https://test.rpc.fastnear.com | grep -c public_key
}
new_acct() { # account amount; retries, and skips accounts that already exist
  local try
  for try in 1 2 3 4; do
    [ "$(keys_on_chain "$1")" -ge 1 ] && return 0
    near account create-account fund-myself "$1" "$2" autogenerate-new-keypair save-to-legacy-keychain       sign-as "$FUNDER" network-config testnet sign-with-legacy-keychain send 2>&1 </dev/null | sed "s/[[0-9;]*m//g" | grep -iE "enough|cannot|panicked|exceeded" | head -2
    sleep $((try * 5))
  done
  [ "$(keys_on_chain "$1")" -ge 1 ] || { echo "FAILED to create $1"; exit 1; }
}
call() { # contract method args signer [deposit]; retries dropped connections
  local out try
  for try in 1 2 3 4 5 6 7 8; do
    out=$(near contract call-function as-transaction "$1" "$2" json-args "$3" prepaid-gas "${GAS:-100.0} Tgas"       attached-deposit "${5:-0 NEAR}" sign-as "$4" network-config testnet       sign-with-legacy-keychain send 2>&1 </dev/null | sed "s/[[0-9;]*m//g")
    if echo "$out" | grep -qE "Transaction ID|panicked"; then sleep 3; break; fi
    sleep $((try * 8))
  done
  echo "$out"
}
must() { # label output; stops the run if a setup step failed
  if ! echo "$2" | grep -qE "Transaction ID|already registered"; then
    echo "SETUP FAILED: $1:"; echo "$2" | grep -vE "^s*$|console command|near.exe" | tail -8 | cut -c1-200; exit 1
  fi
}
ok() { # label output
  if echo "$2" | grep -q 'Transaction ID' && ! echo "$2" | grep -q panicked; then PASS=$((PASS+1)); echo "ok    $1"
  else BAD=$((BAD+1)); echo "WRONG $1: $(echo "$2" | grep -iE 'panicked|error' | head -2 | tr -s ' ')"; fi
}
refused() { # label expected-text output
  if echo "$3" | grep -q "$2"; then PASS=$((PASS+1)); echo "ok    refused: $1"
  else BAD=$((BAD+1)); echo "WRONG not refused: $1"; fi
}
view() { near contract call-function as-read-only "$1" "$2" json-args "$3" network-config testnet now 2>/dev/null </dev/null; }
bal() { view "$TOK" ft_balance_of "{\"account_id\":\"$1\"}" | tr -d '"\n '; }
is() { # label actual expected
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "ok    $1 = $2"
  else BAD=$((BAD+1)); echo "WRONG $1: got $2, wanted $3"; fi
}

echo "== accounts"
new_acct "$REG" "4.5 NEAR"; new_acct "$TOK" "2 NEAR"; new_acct "$ADM" "0.8 NEAR"
for a in $OPS $SVC $MARIA $TOM $PETER $LENA $ERIK; do new_acct "$a" "0.2 NEAR"; done
echo "created 10, each checked on-chain"

echo "== deploy"
# A local build wins; otherwise the committed copy in res/.
wasm() { [ -f "$1/target/near/$2" ] && echo "$1/target/near/$2" || echo "$1/res/$2"; }
near contract deploy "$TOK" use-file "$(wasm token test_euro.wasm)" with-init-call new \
  json-args "{\"owner_id\":\"$ADM\",\"total_supply\":\"$TOTAL\"}" prepaid-gas '100.0 Tgas' \
  attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send 2>&1 </dev/null | grep -q 'Transaction ID' && echo "token deployed"
near contract deploy "$REG" use-file "$(wasm contract shareholder_registry.wasm)" with-init-call new \
  json-args "{\"config\":{\"cooling_off_ms\":5000,\"extended_cooling_off_ms\":5000,\"recent_contact_change_ms\":600000,\"stale_after_ms\":3600000,\"verification_valid_for_ms\":600000},\"roles\":{\"verifier\":\"$OPS\",\"kyc_provider\":\"$OPS\",\"agent\":\"$OPS\",\"estate_reviewer\":\"$OPS\",\"payout_service\":\"$SVC\"}}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send 2>&1 </dev/null | grep -q 'Transaction ID' && echo "registry deployed"

echo "== token registration"
for a in $REG $SVC $MARIA $TOM $PETER $LENA $ERIK; do
  must "token registration $a" "$(call "$TOK" storage_deposit "{\"account_id\":\"$a\"}" "$FUNDER" '0.00125 NEAR')"
done
echo "done"

echo "== holders"
UNTIL=$(( ($(date +%s) + 86400) * 1000 ))
for a in $MARIA $TOM $PETER $LENA $ERIK; do
  must "register $a" "$(call "$REG" register_holder '{}' "$a")"
  must "confirm $a" "$(call "$REG" confirm_details '{}' "$a")"
  ok "kyc $a" "$(call "$REG" record_kyc "{\"holder_id\":\"$a\",\"valid_until\":$UNTIL,\"screening\":\"clear\"}" "$OPS")"
done

echo "== payout choices"
must "step" "$(call "$REG" record_bank_verification "{\"holder_id\":\"$MARIA\",\"fingerprint\":\"ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12\"}" "$OPS")"
ok "maria chooses bank" "$(call "$REG" request_payout_change "{\"holder_id\":\"$MARIA\",\"method\":\"bank\"}" "$MARIA")"
ok "lena chooses a route" "$(call "$REG" request_payout_change "{\"holder_id\":\"$LENA\",\"method\":\"intents\",\"new_route\":{\"chain\":\"base\",\"asset_id\":\"usdc\",\"address\":\"0xabc\"}}" "$LENA")"
sleep 7

echo "== company"
ok "create company" "$(call "$REG" create_company "{\"company_id\":\"acme\",\"name\":\"Acme\",\"payout_token\":\"$TOK\",\"total_shares\":5000}" "$ADM")"
for a in $MARIA $TOM $PETER $LENA $ERIK; do
  must "holding $a" "$(call "$REG" set_holding "{\"company_id\":\"acme\",\"holder_id\":\"$a\",\"shares\":1000}" "$ADM")"
done
ok "open payout" "$(call "$REG" open_payout "{\"event_id\":\"exit\",\"company_id\":\"acme\",\"total\":\"$TOTAL\"}" "$ADM")"
must "step" "$(call "$REG" mark_contact_bounced "{\"company_id\":\"acme\",\"holder_id\":\"$TOM\"}" "$ADM")"

echo "== funding"
call "$TOK" ft_transfer_call "{\"receiver_id\":\"$REG\",\"amount\":\"100\",\"msg\":\"exit\"}" "$ADM" '1 yoctoNEAR' >/dev/null
is "wrong funding amount refunded" "$(bal "$REG")" 0
ok "exact funding" "$(call "$TOK" ft_transfer_call "{\"receiver_id\":\"$REG\",\"amount\":\"$TOTAL\",\"msg\":\"exit\"}" "$ADM" '1 yoctoNEAR')"
is "contract holds the total" "$(bal "$REG")" "$TOTAL"

echo "== confirmations and the missed transfer"
must "step" "$(call "$REG" confirm_holding '{"event_id":"exit","shares":1000}' "$MARIA")"
must "step" "$(call "$REG" confirm_holding '{"event_id":"exit","shares":1000}' "$ERIK")"
must "step" "$(call "$REG" confirm_holding '{"event_id":"exit","shares":800}' "$PETER")"
must "step" "$(call "$REG" confirm_holding '{"event_id":"exit","shares":1200}' "$LENA")"
refused "payout during a dispute" "a dispute is open" "$(call "$REG" execute_payout '{"event_id":"exit"}' "$ADM")"
refused "shifting a silent holder's shares" "needs an open dispute" \
  "$(call "$REG" resolve_dispute "{\"event_id\":\"exit\",\"corrections\":[{\"holder_id\":\"$TOM\",\"shares\":800},{\"holder_id\":\"$LENA\",\"shares\":1200}]}" "$ADM")"
ok "correction applied" "$(call "$REG" resolve_dispute "{\"event_id\":\"exit\",\"corrections\":[{\"holder_id\":\"$PETER\",\"shares\":800},{\"holder_id\":\"$LENA\",\"shares\":1200}]}" "$ADM")"
must "step" "$(call "$REG" confirm_holding '{"event_id":"exit","shares":800}' "$PETER")"
must "step" "$(call "$REG" confirm_holding '{"event_id":"exit","shares":1200}' "$LENA")"

echo "== the exit"
OUT=$(GAS=300.0 call "$REG" execute_payout '{"event_id":"exit"}' "$ADM")
ok "exit payout" "$OUT"
echo "$OUT" | grep -oE 'https://[^ ]*transactions/[A-Za-z0-9]+' | head -1
sleep 6
is "erik paid" "$(bal "$ERIK")" 1000000000
is "peter paid" "$(bal "$PETER")" 800000000
is "tom paid nothing yet" "$(bal "$TOM")" 0
is "maria paid nothing on-chain (queued)" "$(bal "$MARIA")" 0
is "tom's money held" "$(view "$REG" get_held_funds "{\"company_id\":\"acme\",\"holder_id\":\"$TOM\"}" | tr -d '"\n ')" 1000000000
refused "agent releasing money" "only the payout service" "$(call "$REG" release_for_route "{\"event_id\":\"exit\",\"holder_id\":\"$LENA\"}" "$OPS")"

echo "== route"
ok "route released" "$(call "$REG" release_for_route "{\"event_id\":\"exit\",\"holder_id\":\"$LENA\"}" "$SVC")"
ok "route success" "$(call "$REG" report_route_result "{\"event_id\":\"exit\",\"holder_id\":\"$LENA\",\"result\":\"SUCCESS\"}" "$SVC")"
sleep 6
is "service repaid for lena's delivery" "$(bal "$SVC")" 1200000000
refused "service repaid twice" "not released for a route" "$(call "$REG" report_route_result "{\"event_id\":\"exit\",\"holder_id\":\"$LENA\",\"result\":\"SUCCESS\"}" "$SVC")"
refused "service taking peter's line" "not released for a route" "$(call "$REG" report_route_result "{\"event_id\":\"exit\",\"holder_id\":\"$PETER\",\"result\":\"SUCCESS\"}" "$SVC")"

echo "== tom comes back"
refused "claim before confirming" "need attention\|must be confirmed" "$(call "$REG" claim '{"company_id":"acme"}' "$TOM")"
must "step" "$(call "$REG" confirm_details '{}' "$TOM")"
must "step" "$(call "$REG" confirm_holding '{"event_id":"exit","shares":1000}' "$TOM")"
ok "tom claims" "$(call "$REG" claim '{"company_id":"acme"}' "$TOM")"
sleep 6
is "tom paid" "$(bal "$TOM")" 1000000000
refused "claiming twice" "nothing to claim" "$(call "$REG" claim '{"company_id":"acme"}' "$TOM")"

echo "== proof and remainder"
PROOF=$(view "$REG" get_manifest_proof "{\"event_id\":\"exit\",\"holder_id\":\"$PETER\"}" | tr -d '\n')
is "peter's line verifies" "$(view "$REG" verify_manifest_line "{\"event_id\":\"exit\",\"holder_id\":\"$PETER\",\"shares\":800,\"amount\":\"800000000\",\"proof\":$PROOF}" | tr -d '\n ')" true
is "a wrong amount fails" "$(view "$REG" verify_manifest_line "{\"event_id\":\"exit\",\"holder_id\":\"$PETER\",\"shares\":800,\"amount\":\"900000000\",\"proof\":$PROOF}" | tr -d '\n ')" false
ok "remainder collected" "$(call "$REG" collect_remainder '{"company_id":"acme"}' "$ADM")"
sleep 6
is "admin got the rounding remainder" "$(bal "$ADM")" 3
is "only maria's queued money stays in the contract" "$(bal "$REG")" 1000000000

echo
echo "RESULT: $PASS passed, $BAD wrong"
view "$REG" get_payout '{"event_id":"exit"}' | tr -d '\n' | grep -oE '"totals": *\{[^}]*\}'
echo "contract: https://testnet.nearblocks.io/address/$REG"
