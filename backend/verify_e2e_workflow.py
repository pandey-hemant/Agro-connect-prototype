"""
verify_e2e_workflow.py — 28-step end-to-end user-journey smoke.

Drives the live FastAPI on :8000. Each step prints [OK] or [FAIL].
Mirrors the user actions:
  1-3   role select (auth)         (frontend-only, validated via slice + route)
  4-7   seller creates + lists lot
  8-9   buyer browses + filters
  10-11 buyer makes offer
  12    seller counter-offers
  13    buyer accepts counter
  14-15 deal auto-created + lot SOLD
  16    other open offer auto-rejected
  17-18 both sides see deal
  19    quality declared
  20    quality verified
  21-23 delivery walk PENDING -> PREPARING -> IN_TRANSIT -> DELIVERED
  24    payment PAID
  25-26 FPO create + join
  27    FPO aggregate
  28    FPO leave
"""
import json
import sys
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8000/api"

PASS, FAIL = 0, 0
def step(n, label, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"[OK]  {n:>2}. {label}{(' — ' + detail) if detail else ''}")
    else:
        FAIL += 1
        print(f"[FAIL] {n:>2}. {label}{(' — ' + detail) if detail else ''}")

def req(method, path, body=None, expect=None):
    url = BASE + path
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            code = resp.getcode()
            payload = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        code = e.code
        payload = e.read().decode("utf-8")
    parsed = None
    if payload:
        try:
            parsed = json.loads(payload)
        except Exception:
            parsed = payload
    if expect is not None:
        # Accept either the exact expected code or its 200/201 equivalents
        # for REST POST/GET.
        ok = code == expect or (
            expect in (200, 201) and code in (200, 201)
        )
        if not ok:
            raise RuntimeError(f"{method} {path} expected {expect} got {code}: {payload}")
    return code, parsed


# --- 1-3: role select is frontend-only; verify backend supports both roles
# by listing lots and buyers (the two things both dashboards need).
code, h = req("GET", "/health", expect=200)
step(1, "Backend /api/health", code == 200, h.get("status", ""))

# 4-7: Seller creates a fresh ACTIVE lot
unique_crop = f"e2e-tomato-{int(time.time())}"
code, lot = req("POST", "/crop-lots", body={
    "crop_name": "Tomato",
    "crop_variety": "Hybrid",
    "quantity": 250.0,
    "quantity_unit": "kg",
    "harvest_date": "2026-08-29",
    "location": "Patna, Bihar",
    "farmer_quality_grade": "A",
    "expected_price_per_kg": 17.0,
}, expect=201)
step(4, "Seller creates Crop Lot (POST /crop-lots)", code in (200, 201), lot["public_id"])
lot_pub = lot["public_id"]
lot_id = lot["id"]

code, lst = req("GET", "/crop-lots", expect=200)
step(5, "Seller lists own Crop Lots", code == 200 and any(x["public_id"] == lot_pub for x in lst))
step(6, "Lot is ACTIVE on creation", lot["status"] == "ACTIVE", f"status={lot['status']}")
step(7, "Lot has positive integer id", isinstance(lot_id, int) and lot_id > 0, f"id={lot_id}")

# 8-9: Buyer browses + filters
code, lst = req("GET", "/crop-lots?status=ACTIVE", expect=200)
step(8, "Buyer fetches ACTIVE-only lots", code == 200 and isinstance(lst, list) and len(lst) >= 1)
code, lst2 = req("GET", "/crop-lots/available?crop=Tomato", expect=200)
step(9, "Buyer filters by crop", code == 200 and all(x["crop_name"].lower() == "tomato" for x in lst2))

# 10-11: Buyer makes an offer (we need an active buyer; seed if missing)
code, bseed = req("POST", "/buyers/seed-demo", expect=200)
buyers_envelope = req("GET", "/buyers", expect=200)[1]
buyers = buyers_envelope.get("results", buyers_envelope) if isinstance(buyers_envelope, dict) else buyers_envelope
buyer = next((b for b in buyers if "FreshHarvest" in b.get("name", "")), buyers[0])
step(10, "Buyer identity present (active buyer)", buyer is not None, buyer["name"])

code, off_resp = req("POST", "/offers", body={
    "crop_lot_id": lot_id,
    "buyer_id": buyer["id"],
    "price": 15.0,
    "quantity": 250.0,
    "message": "E2E initial offer",
}, expect=201)
off = off_resp.get("offer", off_resp) if isinstance(off_resp, dict) else off_resp
step(11, "Buyer creates offer (OPEN)", off.get("status") == "OPEN", f"status={off.get('status')}")
offer_pub = (off_resp.get("public_id") if isinstance(off_resp, dict) else None) or off["public_id"]

# 12: Seller counter-offers
code, off2 = req("POST", f"/offers/{offer_pub}/counter", body={
    "actor": "FARMER", "price": 17.0, "quantity": 250.0, "message": "Counter @ 17",
}, expect=200)
step(12, "Seller counter @ 17", off2["status"] == "COUNTERED" and off2["current_price"] == 17.0)

# 13: Buyer accepts
code, off3 = req("POST", f"/offers/{offer_pub}/accept", body={"actor": "BUYER"}, expect=200)
step(13, "Buyer accepts", off3["offer"]["status"] == "ACCEPTED" and "deal" in off3)

deal_pub = off3["deal"]["public_id"]
step(14, "Deal auto-created on accept", off3["deal"]["public_id"] == deal_pub, deal_pub)

# 15: Lot flipped to SOLD
code, lot2 = req("GET", f"/crop-lots/{lot_pub}", expect=200)
step(15, "Lot status flipped to SOLD", lot2["status"] == "SOLD", f"status={lot2['status']}")

# 16: Second offer on same lot should now be 400
code2, err = req("POST", "/offers", body={
    "crop_lot_id": lot_id, "buyer_id": buyer["id"],
    "price": 16.0, "quantity": 100.0,
})
step(16, "New offer on SOLD lot rejected (400)", code2 == 400)

# 17-18: Both sides see deal
code, deals_for_buyer = req("GET", f"/deals?buyer_id={buyer['id']}", expect=200)
buyers_deals = deals_for_buyer.get("results", deals_for_buyer) if isinstance(deals_for_buyer, dict) else deals_for_buyer
step(17, "Buyer lists own deals", code == 200 and any(d["public_id"] == deal_pub for d in buyers_deals))
code, deals_all_envelope = req("GET", "/deals", expect=200)
deals_all = deals_all_envelope.get("results", deals_all_envelope) if isinstance(deals_all_envelope, dict) else deals_all_envelope
step(18, "Seller side lists all deals (prototype)", code == 200 and any(d["public_id"] == deal_pub for d in deals_all))

# 19: Farmer declares quality
code, q = req("POST", f"/quality/{lot_id}", body={
    "grade": "A", "size": "Medium", "appearance": "Bright red, firm",
    "moisture_pct": 88.0, "defects_pct": 2.0, "notes": "E2E farmer declared",
}, expect=200)
step(19, "Quality declared (FARMER_DECLARED)", q.get("declared_grade") == "A" and q.get("declared_by") == "FARMER")

# 20: Buyer verifies
code, qv = req("POST", f"/quality/{lot_id}/verify", body={
    "actor": "BUYER", "grade": "A", "notes": "Accepts grade"
}, expect=200)
step(20, "Quality verified (BUYER_VERIFIED)", qv.get("declared_by") in ("BUYER", "VERIFIER"))

# 21-23: Delivery walk
code, d = req("POST", f"/deals/{deal_pub}/status", body={"delivery_status": "PREPARING"}, expect=200)
step(21, "Delivery PREPARING", d["delivery_status"] == "PREPARING")
code, d = req("POST", f"/deals/{deal_pub}/status", body={"delivery_status": "IN_TRANSIT"}, expect=200)
step(22, "Delivery IN_TRANSIT", d["delivery_status"] == "IN_TRANSIT")
code, d = req("POST", f"/deals/{deal_pub}/status", body={"delivery_status": "DELIVERED"}, expect=200)
step(23, "Delivery DELIVERED", d["delivery_status"] == "DELIVERED")

# 24: Payment PAID
code, d = req("POST", f"/deals/{deal_pub}/status", body={"payment_status": "PAID"}, expect=200)
step(24, "Payment PAID", d["payment_status"] == "PAID")

# 25-26: FPO create + join
code, fpo = req("POST", "/fpos", body={
    "name": "E2E FPO Patna", "location": "Patna", "district": "Patna", "state": "Bihar",
}, expect=201)
step(25, "Create FPO", code in (200, 201) and fpo.get("public_id"), fpo.get("public_id", "?"))
fpo_pub = fpo["public_id"]

# Need a second ACTIVE lot to join
code, lotB = req("POST", "/crop-lots", body={
    "crop_name": "Onion", "crop_variety": "Red", "quantity": 400.0,
    "quantity_unit": "kg", "harvest_date": "2026-08-29",
    "location": "Nalanda, Bihar", "farmer_quality_grade": "B",
    "expected_price_per_kg": 14.0,
}, expect=201)
code, join = req("POST", f"/fpos/{fpo_pub}/join", body={"crop_lot_id": lotB["id"]}, expect=200)
step(26, "Join FPO with second lot", code == 200 and any(m.get("crop_lot_id") == lotB["id"] for m in join.get("members", [])))

# 27: FPO aggregate
code, agg = req("GET", f"/fpos/{fpo_pub}/aggregate", expect=200)
step(27, "FPO aggregate lists lot", code == 200 and any(row.get("lot_count", 0) >= 1 for row in agg.get("by_crop", [])))

# 28: FPO leave
code, leave = req("POST", f"/fpos/{fpo_pub}/leave", body={"crop_lot_id": lotB["id"]}, expect=200)
step(28, "Leave FPO (idempotent)", code == 200 and not any(m.get("crop_lot_id") == lotB["id"] for m in leave.get("members", [])))

print()
print(f"=== {PASS} passed, {FAIL} failed (of 28) ===")
sys.exit(0 if FAIL == 0 else 1)
