# SCNTS Perfume API
# FastAPI + Supabase + login with bcrypt and JWT
# Beginner style: everything is in this one file.

import os
import re
import hashlib
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from supabase import create_client

load_dotenv()

# ---------------------------------------------------------------
# Settings (they come from Vercel settings or from the .env file)
# ---------------------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
JWT_SECRET = os.getenv("JWT_SECRET")

# If JWT_SECRET is missing, make one from the service key so the app still works.
if not JWT_SECRET and SUPABASE_SERVICE_KEY:
    JWT_SECRET = hashlib.sha256(("scnts|" + SUPABASE_SERVICE_KEY).encode()).hexdigest()

TOKEN_MINUTES = 60
MAX_FAILED_ATTEMPTS = 10
LOCK_MINUTES = 5
CATEGORIES = ["men", "women", "unisex"]
ORDER_STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"]
PH_TZ = timezone(timedelta(hours=8))      # Philippine time, used for "today"
STAFF_ROLES = ["employee", "admin"]

supabase = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

app = FastAPI(title="SCNTS Perfume API", version="1.0.0")
bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------
def db():
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database is not configured.")
    return supabase


def run(query):
    """Run a Supabase query and turn database errors into clear API errors."""
    try:
        return query.execute()
    except Exception as e:
        code = str(getattr(e, "code", "") or "")
        if code == "23505":
            raise HTTPException(status_code=409, detail="That record already exists.")
        if code == "23503":
            raise HTTPException(status_code=409, detail="This record is used by other records.")
        if code in ("23502", "23514", "22P02", "22003"):
            raise HTTPException(status_code=422, detail="Some of the data is not valid.")
        if code:
            raise HTTPException(status_code=500, detail="Database query failed (code " + code + ").")
        raise HTTPException(status_code=503, detail="Cannot reach the database.")


def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def check_password(password, password_hash):
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def make_token(user):
    payload = {
        "sub": str(user["id"]),
        "role": user["role"],
        "exp": datetime.now(timezone.utc) + timedelta(minutes=TOKEN_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def role_name(row):
    role = row.get("role")
    if isinstance(role, dict):
        return role.get("role", "user")
    return "user"


def public_user(row):
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": role_name(row)}


def current_user(cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
    if cred is None:
        raise HTTPException(status_code=401, detail="Login required.")
    try:
        data = jwt.decode(cred.credentials, JWT_SECRET, algorithms=["HS256"])
        user_id = int(data["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    res = run(db().table("users").select("id,name,email,is_active,role:roles(role)").eq("id", user_id).limit(1))
    if not res.data or not res.data[0]["is_active"]:
        raise HTTPException(status_code=401, detail="Login required.")
    return public_user(res.data[0])


def admin_only(user=Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


def staff_only(user=Depends(current_user)):
    if user["role"] not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Staff access required.")
    return user


def day_range(day):
    """Start and end of one day in Philippine time. No day = today."""
    if day:
        try:
            start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=PH_TZ)
        except ValueError:
            raise HTTPException(status_code=422, detail="Date must look like 2026-11-25.")
    else:
        start = datetime.now(PH_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat(), (start + timedelta(days=1)).isoformat()


def change_stock(product, amount, reason, user_id, note=None, sale_id=None, order_id=None):
    """Change the stock of one perfume AND write it in the stock history.
    amount is + to add stock and - to take stock out."""
    old = product["stock"]
    new = old + amount
    if new < 0:
        raise HTTPException(status_code=409, detail="Not enough stock for " + product["name"] + ".")
    done = run(db().table("products").update({"stock": new}).eq("id", product["id"]).eq("stock", old))
    if not done.data:
        raise HTTPException(status_code=409, detail="Stock changed while you were working. Please try again.")
    run(db().table("stock_movements").insert({
        "product_id": product["id"], "qty_change": amount, "stock_after": new,
        "reason": reason, "note": note, "user_id": user_id,
        "sale_id": sale_id, "order_id": order_id,
    }))
    product["stock"] = new


def take_stock(wanted, products, reason, user_id, note, sale_id=None, order_id=None):
    """Take stock out for a whole sale or order. If one item fails, put back the others."""
    taken = []
    try:
        for pid, qty in wanted.items():
            change_stock(products[pid], -qty, reason, user_id, note, sale_id, order_id)
            taken.append(pid)
    except HTTPException:
        for pid in taken:
            change_stock(products[pid], wanted[pid], "void", user_id, "Undo: " + note, sale_id, order_id)
        raise


def merge_items(items):
    wanted = {}
    for item in items:
        wanted[item.product_id] = wanted.get(item.product_id, 0) + item.quantity
    return wanted


def load_products(ids):
    found = run(db().table("products").select("id,name,price,stock").in_("id", ids))
    return {p["id"]: p for p in found.data}


# ---------------------------------------------------------------
# Models (the shape of the data we accept)
# ---------------------------------------------------------------
class RegisterIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(max_length=254)
    password: str = Field(min_length=6, max_length=72)


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    email: str = Field(max_length=254)
    password: str = Field(max_length=72)


class ProductIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=150)
    brand: str = Field(min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=2000)
    price: float = Field(ge=0, le=1000000)
    size_ml: int = Field(gt=0, le=5000)
    category: str = Field(pattern="^(men|women|unisex)$")
    stock: int = Field(default=0, ge=0, le=100000)
    image_url: Optional[str] = Field(default=None, max_length=500)


class ProductUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    brand: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=2000)
    price: Optional[float] = Field(default=None, ge=0, le=1000000)
    size_ml: Optional[int] = Field(default=None, gt=0, le=5000)
    category: Optional[str] = Field(default=None, pattern="^(men|women|unisex)$")
    stock: Optional[int] = Field(default=None, ge=0, le=100000)
    image_url: Optional[str] = Field(default=None, max_length=500)


class OrderItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: int = Field(gt=0)
    quantity: int = Field(ge=1, le=20)


class OrderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: List[OrderItemIn] = Field(min_length=1, max_length=30)


class StatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str = Field(pattern="^(pending|paid|shipped|delivered|cancelled)$")


class SaleItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: int = Field(gt=0)
    quantity: int = Field(ge=1, le=100)


class SaleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: List[SaleItemIn] = Field(min_length=1, max_length=50)
    payment_method: str = Field(default="cash", pattern="^(cash|gcash|card|other)$")
    note: Optional[str] = Field(default=None, max_length=200)


class VoidIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=3, max_length=200)


class RestockIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    quantity: int = Field(ge=1, le=100000)
    note: Optional[str] = Field(default=None, max_length=200)


class AdjustIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    new_stock: int = Field(ge=0, le=100000)
    reason: str = Field(pattern="^(count|damaged|adjustment)$")
    note: Optional[str] = Field(default=None, max_length=200)


class StaffIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(max_length=254)
    password: str = Field(min_length=6, max_length=72)


class StaffUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=6, max_length=72)


# ---------------------------------------------------------------
# Health
# ---------------------------------------------------------------
@app.get("/health")
def health():
    try:
        db().table("products").select("id").limit(1).execute()
        return {"status": "ok", "database": "connected"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "error", "database": "not connected"})


# ---------------------------------------------------------------
# Auth: register, login, me
# ---------------------------------------------------------------
def create_user(name, raw_email, password, role_name):
    email = raw_email.strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=422, detail="Please enter a valid email.")
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(status_code=422, detail="Password is too long.")

    exists = run(db().table("users").select("id").eq("email", email).limit(1))
    if exists.data:
        raise HTTPException(status_code=409, detail="This email is already registered.")

    role = run(db().table("roles").select("id").eq("role", role_name).limit(1))
    if not role.data:
        raise HTTPException(status_code=500, detail="The '" + role_name + "' role is missing in the roles table.")

    new_user = {
        "name": name.strip(),
        "email": email,
        "password_hash": hash_password(password),
        "role_id": role.data[0]["id"],
    }
    row = run(db().table("users").insert(new_user)).data[0]
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": role_name}


@app.post("/auth/register", status_code=201)
def register(data: RegisterIn):
    return create_user(data.name, data.email, data.password, "user")


@app.post("/auth/login")
def login(data: LoginIn):
    email = data.email.strip().lower()
    res = run(
        db().table("users")
        .select("id,name,email,password_hash,is_active,failed_attempts,locked_until,role:roles(role)")
        .eq("email", email)
        .limit(1)
    )
    if not res.data:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    user = res.data[0]

    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="This account is disabled.")

    # Is the account locked?
    if user.get("locked_until"):
        try:
            locked_until = datetime.fromisoformat(str(user["locked_until"]).replace("Z", "+00:00"))
            if locked_until > datetime.now(timezone.utc):
                raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in a few minutes.")
        except ValueError:
            pass

    if not check_password(data.password, user["password_hash"]):
        attempts = (user.get("failed_attempts") or 0) + 1
        change = {"failed_attempts": attempts}
        if attempts >= MAX_FAILED_ATTEMPTS:
            change = {
                "failed_attempts": 0,
                "locked_until": (datetime.now(timezone.utc) + timedelta(minutes=LOCK_MINUTES)).isoformat(),
            }
        run(db().table("users").update(change).eq("id", user["id"]))
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if user.get("failed_attempts") or user.get("locked_until"):
        run(db().table("users").update({"failed_attempts": 0, "locked_until": None}).eq("id", user["id"]))

    me = public_user(user)
    return {"access_token": make_token(me), "token_type": "bearer", "user": me}


@app.get("/auth/me")
def me(user=Depends(current_user)):
    return user


# ---------------------------------------------------------------
# Products (anyone can look, only admin can change)
# ---------------------------------------------------------------
@app.get("/products")
def list_products(q: Optional[str] = None, category: Optional[str] = None):
    query = db().table("products").select("*").order("id")
    if category:
        if category not in CATEGORIES:
            raise HTTPException(status_code=422, detail="Category must be men, women or unisex.")
        query = query.eq("category", category)
    if q:
        clean = re.sub(r"[^\w\s\-]", "", q).strip()
        if clean:
            query = query.or_("name.ilike.%" + clean + "%,brand.ilike.%" + clean + "%")
    res = run(query)
    return {"count": len(res.data), "products": res.data}


@app.get("/products/{product_id}")
def get_product(product_id: int):
    res = run(db().table("products").select("*").eq("id", product_id).limit(1))
    if not res.data:
        raise HTTPException(status_code=404, detail="Perfume not found.")
    return res.data[0]


@app.post("/products", status_code=201)
def create_product(data: ProductIn, admin=Depends(admin_only)):
    new_row = data.model_dump()
    new_row["created_by"] = admin["id"]
    res = run(db().table("products").insert(new_row))
    return res.data[0]


@app.patch("/products/{product_id}")
def update_product(product_id: int, data: ProductUpdate, admin=Depends(admin_only)):
    changes = data.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Send at least one field to update.")
    res = run(db().table("products").update(changes).eq("id", product_id))
    if not res.data:
        raise HTTPException(status_code=404, detail="Perfume not found.")
    return res.data[0]


@app.delete("/products/{product_id}")
def delete_product(product_id: int, admin=Depends(admin_only)):
    res = run(db().table("products").delete().eq("id", product_id))
    if not res.data:
        raise HTTPException(status_code=404, detail="Perfume not found.")
    return {"message": "Perfume deleted.", "id": product_id}


# ---------------------------------------------------------------
# Favorites (each user only sees their own)
# ---------------------------------------------------------------
@app.get("/favorites")
def list_favorites(user=Depends(current_user)):
    res = run(
        db().table("favorites")
        .select("id,product_id,created_at,product:products(*)")
        .eq("user_id", user["id"])
        .order("created_at", desc=True)
    )
    return {"count": len(res.data), "favorites": res.data}


@app.post("/favorites/{product_id}", status_code=201)
def add_favorite(product_id: int, user=Depends(current_user)):
    product = run(db().table("products").select("id").eq("id", product_id).limit(1))
    if not product.data:
        raise HTTPException(status_code=404, detail="Perfume not found.")
    old = run(db().table("favorites").select("id").eq("user_id", user["id"]).eq("product_id", product_id).limit(1))
    if old.data:
        raise HTTPException(status_code=409, detail="Already in your favorites.")
    res = run(db().table("favorites").insert({"user_id": user["id"], "product_id": product_id}))
    return res.data[0]


@app.delete("/favorites/{product_id}")
def remove_favorite(product_id: int, user=Depends(current_user)):
    res = run(db().table("favorites").delete().eq("user_id", user["id"]).eq("product_id", product_id))
    if not res.data:
        raise HTTPException(status_code=404, detail="Not in your favorites.")
    return {"message": "Removed from favorites.", "product_id": product_id}


# ---------------------------------------------------------------
# Orders (the server calculates prices, never the browser)
# ---------------------------------------------------------------
ORDER_SELECT = "id,user_id,total,status,created_at,order_items(id,product_id,quantity,price,product:products(name,image_url))"


@app.post("/orders", status_code=201)
def create_order(data: OrderIn, user=Depends(current_user)):
    wanted = merge_items(data.items)
    products = load_products(list(wanted.keys()))

    total = 0
    for pid, qty in wanted.items():
        p = products.get(pid)
        if p is None:
            raise HTTPException(status_code=404, detail="Perfume " + str(pid) + " not found.")
        if qty > 20:
            raise HTTPException(status_code=422, detail="You can order at most 20 of one perfume.")
        if p["stock"] < qty:
            raise HTTPException(status_code=409, detail="Not enough stock for " + p["name"] + ".")
        total = total + float(p["price"]) * qty
    total = round(total, 2)

    order = run(db().table("orders").insert({"user_id": user["id"], "total": total, "status": "pending"}))
    order_id = order.data[0]["id"]

    rows = []
    for pid, qty in wanted.items():
        rows.append({"order_id": order_id, "product_id": pid, "quantity": qty, "price": products[pid]["price"]})
    try:
        run(db().table("order_items").insert(rows))
        take_stock(wanted, products, "online_order", user["id"], "Online order #" + str(order_id), order_id=order_id)
    except HTTPException:
        run(db().table("orders").delete().eq("id", order_id))
        raise

    full = run(db().table("orders").select(ORDER_SELECT).eq("id", order_id).limit(1))
    return full.data[0]


@app.get("/orders")
def my_orders(user=Depends(current_user)):
    res = run(db().table("orders").select(ORDER_SELECT).eq("user_id", user["id"]).order("created_at", desc=True))
    return {"count": len(res.data), "orders": res.data}


@app.get("/orders/all")
def all_orders(admin=Depends(admin_only)):
    select = ORDER_SELECT + ",user:users(name,email)"
    res = run(db().table("orders").select(select).order("created_at", desc=True))
    return {"count": len(res.data), "orders": res.data}


@app.patch("/orders/{order_id}/status")
def change_order_status(order_id: int, data: StatusIn, admin=Depends(admin_only)):
    cur = run(db().table("orders").select("id,status,order_items(product_id,quantity)").eq("id", order_id).limit(1))
    if not cur.data:
        raise HTTPException(status_code=404, detail="Order not found.")
    old_status = cur.data[0]["status"]
    if old_status == "cancelled" and data.status != "cancelled":
        raise HTTPException(status_code=409, detail="A cancelled order cannot be changed.")

    res = run(db().table("orders").update({"status": data.status}).eq("id", order_id).eq("status", old_status))
    if not res.data:
        raise HTTPException(status_code=409, detail="The order changed. Please refresh and try again.")

    # Cancelled order: put the perfumes back in stock
    if data.status == "cancelled" and old_status != "cancelled":
        for item in cur.data[0]["order_items"]:
            prod = run(db().table("products").select("id,name,stock").eq("id", item["product_id"]).limit(1))
            if prod.data:
                change_stock(prod.data[0], item["quantity"], "order_cancelled", admin["id"],
                             "Order #" + str(order_id) + " cancelled", order_id=order_id)
    return res.data[0]


# ===============================================================
# POS: staff record walk-in sales (employee and admin)
# ===============================================================
SALE_SELECT = (
    "id,employee_id,total,payment_method,note,status,void_reason,voided_at,created_at,"
    "employee:users!sales_employee_id_fkey(name),"
    "sale_items(id,product_id,quantity,price,product:products(name))"
)


@app.post("/pos/sales", status_code=201)
def record_sale(data: SaleIn, staff=Depends(staff_only)):
    wanted = merge_items(data.items)
    products = load_products(list(wanted.keys()))

    total = 0
    for pid, qty in wanted.items():
        p = products.get(pid)
        if p is None:
            raise HTTPException(status_code=404, detail="Perfume " + str(pid) + " not found.")
        if p["stock"] < qty:
            raise HTTPException(status_code=409, detail="Not enough stock for " + p["name"] + " (only " + str(p["stock"]) + " left).")
        total = total + float(p["price"]) * qty
    total = round(total, 2)

    sale = run(db().table("sales").insert({
        "employee_id": staff["id"], "total": total,
        "payment_method": data.payment_method, "note": data.note,
    }))
    sale_id = sale.data[0]["id"]

    rows = []
    for pid, qty in wanted.items():
        rows.append({"sale_id": sale_id, "product_id": pid, "quantity": qty, "price": products[pid]["price"]})
    try:
        run(db().table("sale_items").insert(rows))
        take_stock(wanted, products, "sale", staff["id"], "Sale #" + str(sale_id), sale_id=sale_id)
    except HTTPException:
        run(db().table("sales").delete().eq("id", sale_id))
        raise

    full = run(db().table("sales").select(SALE_SELECT).eq("id", sale_id).limit(1))
    return full.data[0]


def sales_of_day(day, staff, employee_id=None):
    start, end = day_range(day)
    query = db().table("sales").select(SALE_SELECT).gte("created_at", start).lt("created_at", end).order("created_at", desc=True)
    if staff["role"] != "admin":
        query = query.eq("employee_id", staff["id"])      # an employee only sees her own sales
    elif employee_id:
        query = query.eq("employee_id", employee_id)
    return start[:10], run(query).data


@app.get("/pos/sales")
def list_sales(date: Optional[str] = None, employee_id: Optional[int] = None, staff=Depends(staff_only)):
    day, sales = sales_of_day(date, staff, employee_id)
    return {"date": day, "count": len(sales), "sales": sales}


@app.get("/pos/summary")
def sales_summary(date: Optional[str] = None, employee_id: Optional[int] = None, staff=Depends(staff_only)):
    day, sales = sales_of_day(date, staff, employee_id)
    done = [s for s in sales if s["status"] == "completed"]

    by_payment = {"cash": 0, "gcash": 0, "card": 0, "other": 0}
    by_employee = {}
    items_sold = 0
    for s in done:
        by_payment[s["payment_method"]] = round(by_payment[s["payment_method"]] + float(s["total"]), 2)
        qty = sum(i["quantity"] for i in s["sale_items"])
        items_sold += qty
        who = by_employee.setdefault(s["employee_id"], {
            "employee_id": s["employee_id"],
            "name": (s.get("employee") or {}).get("name", "Unknown"),
            "sales_count": 0, "items_sold": 0, "total": 0,
        })
        who["sales_count"] += 1
        who["items_sold"] += qty
        who["total"] = round(who["total"] + float(s["total"]), 2)

    return {
        "date": day,
        "sales_count": len(done),
        "items_sold": items_sold,
        "total": round(sum(float(s["total"]) for s in done), 2),
        "voided_count": len(sales) - len(done),
        "by_payment": by_payment,
        "by_employee": list(by_employee.values()),
    }


@app.post("/pos/sales/{sale_id}/void")
def void_sale(sale_id: int, data: VoidIn, admin=Depends(admin_only)):
    cur = run(db().table("sales").select("id,status,sale_items(product_id,quantity)").eq("id", sale_id).limit(1))
    if not cur.data:
        raise HTTPException(status_code=404, detail="Sale not found.")
    if cur.data[0]["status"] != "completed":
        raise HTTPException(status_code=409, detail="This sale is already voided.")

    res = run(db().table("sales").update({
        "status": "voided", "voided_by": admin["id"], "void_reason": data.reason.strip(),
        "voided_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", sale_id).eq("status", "completed"))
    if not res.data:
        raise HTTPException(status_code=409, detail="This sale is already voided.")

    for item in cur.data[0]["sale_items"]:
        prod = run(db().table("products").select("id,name,stock").eq("id", item["product_id"]).limit(1))
        if prod.data:
            change_stock(prod.data[0], item["quantity"], "void", admin["id"], "Sale #" + str(sale_id) + " voided", sale_id=sale_id)
    return {"message": "Sale voided and stock put back.", "id": sale_id}


# ===============================================================
# Inventory: only admin can add or fix stock. Staff can look.
# ===============================================================
@app.post("/inventory/{product_id}/restock")
def restock(product_id: int, data: RestockIn, admin=Depends(admin_only)):
    prod = run(db().table("products").select("id,name,stock").eq("id", product_id).limit(1))
    if not prod.data:
        raise HTTPException(status_code=404, detail="Perfume not found.")
    p = prod.data[0]
    change_stock(p, data.quantity, "restock", admin["id"], data.note)
    return {"product_id": product_id, "name": p["name"], "stock": p["stock"]}


@app.post("/inventory/{product_id}/adjust")
def adjust_stock(product_id: int, data: AdjustIn, admin=Depends(admin_only)):
    prod = run(db().table("products").select("id,name,stock").eq("id", product_id).limit(1))
    if not prod.data:
        raise HTTPException(status_code=404, detail="Perfume not found.")
    p = prod.data[0]
    difference = data.new_stock - p["stock"]
    if difference == 0:
        raise HTTPException(status_code=422, detail="The stock is already " + str(p["stock"]) + ". Nothing to change.")
    change_stock(p, difference, data.reason, admin["id"], data.note)
    return {"product_id": product_id, "name": p["name"], "stock": p["stock"], "difference": difference}


@app.get("/inventory/movements")
def stock_history(product_id: Optional[int] = None, limit: int = 100, admin=Depends(admin_only)):
    if limit < 1 or limit > 300:
        raise HTTPException(status_code=422, detail="Limit must be between 1 and 300.")
    query = (
        db().table("stock_movements")
        .select("id,product_id,qty_change,stock_after,reason,note,sale_id,order_id,created_at,product:products(name),user:users(name)")
        .order("created_at", desc=True)
        .limit(limit)
    )
    if product_id:
        query = query.eq("product_id", product_id)
    res = run(query)
    return {"count": len(res.data), "movements": res.data}


# ===============================================================
# Staff accounts (admin creates employees)
# ===============================================================
@app.get("/staff")
def list_staff(admin=Depends(admin_only)):
    roles = run(db().table("roles").select("id").in_("role", STAFF_ROLES))
    ids = [r["id"] for r in roles.data]
    res = run(db().table("users").select("id,name,email,is_active,created_at,role:roles(role)").in_("role_id", ids).order("id"))
    people = [{"id": u["id"], "name": u["name"], "email": u["email"], "is_active": u["is_active"],
               "created_at": u["created_at"], "role": role_name(u)} for u in res.data]
    return {"count": len(people), "staff": people}


@app.post("/staff", status_code=201)
def add_employee(data: StaffIn, admin=Depends(admin_only)):
    return create_user(data.name, data.email, data.password, "employee")


@app.patch("/staff/{user_id}")
def update_employee(user_id: int, data: StaffUpdate, admin=Depends(admin_only)):
    cur = run(db().table("users").select("id,name,role:roles(role)").eq("id", user_id).limit(1))
    if not cur.data:
        raise HTTPException(status_code=404, detail="Employee not found.")
    if role_name(cur.data[0]) != "employee":
        raise HTTPException(status_code=403, detail="You can only change employee accounts here.")

    changes = {}
    if data.is_active is not None:
        changes["is_active"] = data.is_active
    if data.password is not None:
        if len(data.password.encode("utf-8")) > 72:
            raise HTTPException(status_code=422, detail="Password is too long.")
        changes["password_hash"] = hash_password(data.password)
        changes["failed_attempts"] = 0
        changes["locked_until"] = None
    if not changes:
        raise HTTPException(status_code=422, detail="Send is_active or password.")
    run(db().table("users").update(changes).eq("id", user_id))
    return {"message": "Employee updated.", "id": user_id}
