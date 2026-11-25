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
from fastapi.responses import JSONResponse, Response
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


# ===============================================================
# Reports: the admin downloads a summary of sales, stock and orders
# ===============================================================
# Money rules used in the report (also written inside the Excel file):
#   Walk-in revenue  = POS sales that are not voided
#   Online revenue   = website orders that are paid, shipped or delivered
#   Pending orders   = shown separately (not counted as revenue until paid)
#   Cancelled orders and voided sales are never counted as revenue
CONFIRMED_ORDER = ("paid", "shipped", "delivered")
LOW_STOCK = 5
MAX_REPORT_DAYS = 366
CAT_LABEL = {"men": "For him", "women": "For her", "unisex": "Unisex"}
MOVE_LABEL = {
    "sale": "Sold (POS)", "online_order": "Online order", "restock": "Restocked", "count": "Stock count",
    "damaged": "Damaged or lost", "adjustment": "Other fix", "void": "Sale voided (back in stock)",
    "order_cancelled": "Order cancelled (back in stock)",
}


def parse_ts(value):
    """Time text from the database -> datetime in Philippine time."""
    text = str(value).replace("Z", "+00:00")
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(.*)$", text)
    if m:
        frac = (m.group(3) or ".0")[1:7].ljust(6, "0")
        text = m.group(1) + "T" + m.group(2) + "." + frac + (m.group(4) or "+00:00")
    d = datetime.fromisoformat(text)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(PH_TZ)


def report_period(start, end):
    """Turn the two dates from the page into real dates (default: this month until today)."""
    today = datetime.now(PH_TZ).date()
    try:
        d1 = datetime.strptime(start, "%Y-%m-%d").date() if start else today.replace(day=1)
        d2 = datetime.strptime(end, "%Y-%m-%d").date() if end else today
    except ValueError:
        raise HTTPException(status_code=422, detail="Dates must look like 2026-11-25.")
    if d2 < d1:
        raise HTTPException(status_code=422, detail="The end date is before the start date.")
    if (d2 - d1).days + 1 > MAX_REPORT_DAYS:
        raise HTTPException(status_code=422, detail="Please pick " + str(MAX_REPORT_DAYS) + " days or less.")
    return d1, d2


def fetch_all(make_query, page=1000, limit=20000):
    """The database gives at most 1000 rows at a time, so ask again until we have them all."""
    rows = []
    start = 0
    while True:
        res = run(make_query().range(start, start + page - 1))
        rows.extend(res.data)
        if len(res.data) < page or len(rows) >= limit:
            break
        start += page
    return rows


def load_report_data(d1, d2):
    first = datetime(d1.year, d1.month, d1.day, tzinfo=PH_TZ)
    after = datetime(d2.year, d2.month, d2.day, tzinfo=PH_TZ) + timedelta(days=1)
    s, e = first.isoformat(), after.isoformat()

    sales = fetch_all(lambda: db().table("sales").select(
        "id,employee_id,total,payment_method,note,status,void_reason,voided_at,created_at,"
        "employee:users!sales_employee_id_fkey(name),"
        "sale_items(product_id,quantity,price,product:products(name,category))"
    ).gte("created_at", s).lt("created_at", e).order("id"))

    orders = fetch_all(lambda: db().table("orders").select(
        "id,user_id,total,status,created_at,user:users(name,email),"
        "order_items(product_id,quantity,price,product:products(name,category))"
    ).gte("created_at", s).lt("created_at", e).order("id"))

    products = fetch_all(lambda: db().table("products").select("id,name,brand,category,price,size_ml,stock").order("id"))

    moves = fetch_all(lambda: db().table("stock_movements").select(
        "id,product_id,qty_change,stock_after,reason,note,created_at,product:products(name),user:users(name)"
    ).gte("created_at", s).lt("created_at", e).order("id"), limit=6000)

    new_customers = 0
    try:
        users = fetch_all(lambda: db().table("users").select("id,created_at,role:roles(role)")
                          .gte("created_at", s).lt("created_at", e).order("id"))
        new_customers = len([u for u in users if role_name(u) not in STAFF_ROLES])
    except HTTPException:
        pass    # the report still works without this number

    return {"sales": sales, "orders": orders, "products": products, "moves": moves, "new_customers": new_customers}


def build_report(d1, d2, raw, generated_by):
    """Turn the raw rows into the numbers and tables of the report. No database here."""
    days = (d2 - d1).days + 1
    products = {p["id"]: p for p in raw["products"]}
    sales, orders = raw["sales"], raw["orders"]

    done = [x for x in sales if x["status"] == "completed"]
    voided = [x for x in sales if x["status"] != "completed"]
    confirmed = [o for o in orders if o["status"] in CONFIRMED_ORDER]
    pending = [o for o in orders if o["status"] == "pending"]
    cancelled = [o for o in orders if o["status"] == "cancelled"]

    def qty_of(rows, key):
        return sum(i["quantity"] for r in rows for i in r[key])

    walkin_total = round(sum(float(x["total"]) for x in done), 2)
    online_total = round(sum(float(o["total"]) for o in confirmed), 2)
    walkin_items, online_items = qty_of(done, "sale_items"), qty_of(confirmed, "order_items")

    # ----- day by day -----
    daily = {}
    for i in range(days):
        d = (d1 + timedelta(days=i)).isoformat()
        daily[d] = {"date": d, "walkin_count": 0, "walkin_total": 0.0, "online_count": 0, "online_total": 0.0, "voided": 0}
    for x in sales:
        row = daily.get(parse_ts(x["created_at"]).date().isoformat())
        if row is None:
            continue
        if x["status"] == "completed":
            row["walkin_count"] += 1
            row["walkin_total"] = round(row["walkin_total"] + float(x["total"]), 2)
        else:
            row["voided"] += 1
    for o in confirmed:
        row = daily.get(parse_ts(o["created_at"]).date().isoformat())
        if row is not None:
            row["online_count"] += 1
            row["online_total"] = round(row["online_total"] + float(o["total"]), 2)
    daily_rows = list(daily.values())
    for row in daily_rows:
        row["total"] = round(row["walkin_total"] + row["online_total"], 2)

    # ----- by perfume -----
    agg = {}

    def add(kind, items):
        for i in items:
            prod = i.get("product") or {}
            known = products.get(i["product_id"], {})
            a = agg.setdefault(i["product_id"], {
                "product_id": i["product_id"], "name": prod.get("name") or known.get("name") or ("Perfume " + str(i["product_id"])),
                "category": prod.get("category") or known.get("category") or "unisex",
                "walkin_units": 0, "online_units": 0, "revenue": 0.0})
            a[kind + "_units"] += i["quantity"]
            a["revenue"] = round(a["revenue"] + float(i["price"]) * i["quantity"], 2)

    for x in done:
        add("walkin", x["sale_items"])
    for o in confirmed:
        add("online", o["order_items"])
    perfumes = []
    for a in agg.values():
        a["units"] = a["walkin_units"] + a["online_units"]
        a["category_label"] = CAT_LABEL.get(a["category"], a["category"])
        a["stock"] = products.get(a["product_id"], {}).get("stock")
        perfumes.append(a)
    perfumes.sort(key=lambda a: (-a["revenue"], a["name"]))
    never_sold = [p for p in raw["products"] if p["id"] not in agg]

    # ----- by category -----
    categories = []
    for key in ("men", "women", "unisex"):
        mine = [a for a in perfumes if a["category"] == key]
        categories.append({"category": CAT_LABEL[key], "units": sum(a["units"] for a in mine),
                           "revenue": round(sum(a["revenue"] for a in mine), 2)})

    # ----- payment methods (walk-in only) -----
    payments = []
    for key, label in (("cash", "Cash"), ("gcash", "GCash"), ("card", "Card"), ("other", "Other")):
        mine = [x for x in done if x["payment_method"] == key]
        payments.append({"method": label, "count": len(mine), "total": round(sum(float(x["total"]) for x in mine), 2)})

    # ----- employees -----
    emp = {}
    for x in sales:
        who = emp.setdefault(x["employee_id"], {"name": (x.get("employee") or {}).get("name", "Unknown"),
                                                 "sales": 0, "items": 0, "total": 0.0, "voided": 0})
        if x["status"] == "completed":
            who["sales"] += 1
            who["items"] += sum(i["quantity"] for i in x["sale_items"])
            who["total"] = round(who["total"] + float(x["total"]), 2)
        else:
            who["voided"] += 1
    employees = sorted(emp.values(), key=lambda w: -w["total"])
    for w in employees:
        w["average"] = round(w["total"] / w["sales"], 2) if w["sales"] else 0

    # ----- online orders by status, and best customers -----
    order_status = []
    for st in ORDER_STATUSES:
        mine = [o for o in orders if o["status"] == st]
        order_status.append({"status": st.capitalize(), "count": len(mine), "total": round(sum(float(o["total"]) for o in mine), 2)})
    cust = {}
    for o in confirmed:
        c = cust.setdefault(o["user_id"], {"name": (o.get("user") or {}).get("name", "User " + str(o["user_id"])),
                                            "email": (o.get("user") or {}).get("email", ""), "orders": 0, "total": 0.0})
        c["orders"] += 1
        c["total"] = round(c["total"] + float(o["total"]), 2)
    customers = sorted(cust.values(), key=lambda c: -c["total"])[:20]

    # ----- stock now (snapshot) -----
    inventory = []
    for p in sorted(raw["products"], key=lambda p: p["name"].lower()):
        sold = agg.get(p["id"], {}).get("units", 0)
        per_day = sold / days
        status = "Sold out" if p["stock"] <= 0 else ("Low" if p["stock"] <= LOW_STOCK else "OK")
        inventory.append({
            "name": p["name"], "brand": p.get("brand") or "", "category": CAT_LABEL.get(p["category"], p["category"]),
            "size_ml": p.get("size_ml"), "price": float(p["price"]), "stock": p["stock"],
            "value": round(float(p["price"]) * p["stock"], 2), "status": status, "sold": sold,
            "days_left": round(p["stock"] / per_day) if per_day > 0 and p["stock"] > 0 else None,
        })
    low = [i for i in inventory if i["status"] == "Low"]
    out = [i for i in inventory if i["status"] == "Sold out"]
    stock_units = sum(p["stock"] for p in raw["products"])
    stock_value = round(sum(float(p["price"]) * p["stock"] for p in raw["products"]), 2)

    # ----- stock movements in the period -----
    summary = {}
    for m in raw["moves"]:
        row = summary.setdefault(m["reason"], {"reason": MOVE_LABEL.get(m["reason"], m["reason"]), "count": 0, "units_in": 0, "units_out": 0})
        row["count"] += 1
        if m["qty_change"] > 0:
            row["units_in"] += m["qty_change"]
        else:
            row["units_out"] += -m["qty_change"]
    movement_summary = sorted(summary.values(), key=lambda r: -r["count"])
    movements = []
    for m in sorted(raw["moves"], key=lambda m: m["id"], reverse=True):
        t = parse_ts(m["created_at"])
        movements.append({"when": t.strftime("%Y-%m-%d %H:%M"), "perfume": (m.get("product") or {}).get("name", ""),
                          "change": m["qty_change"], "after": m["stock_after"], "reason": MOVE_LABEL.get(m["reason"], m["reason"]),
                          "by": (m.get("user") or {}).get("name", ""), "note": m.get("note") or ""})

    # ----- detail lists -----
    sale_rows = []
    for x in sorted(sales, key=lambda x: x["id"], reverse=True):
        t = parse_ts(x["created_at"])
        sale_rows.append({
            "id": x["id"], "date": t.strftime("%Y-%m-%d"), "time": t.strftime("%H:%M"),
            "employee": (x.get("employee") or {}).get("name", ""),
            "perfumes": ", ".join(str(i["quantity"]) + " x " + ((i.get("product") or {}).get("name") or "Perfume") for i in x["sale_items"]),
            "payment": x["payment_method"].capitalize(), "total": float(x["total"]),
            "status": "Completed" if x["status"] == "completed" else "VOIDED",
            "void_reason": x.get("void_reason") or "", "note": x.get("note") or ""})
    order_rows = []
    for o in sorted(orders, key=lambda o: o["id"], reverse=True):
        t = parse_ts(o["created_at"])
        order_rows.append({
            "id": o["id"], "date": t.strftime("%Y-%m-%d"), "time": t.strftime("%H:%M"),
            "customer": (o.get("user") or {}).get("name", ""), "email": (o.get("user") or {}).get("email", ""),
            "perfumes": ", ".join(str(i["quantity"]) + " x " + ((i.get("product") or {}).get("name") or "Perfume") for i in o["order_items"]),
            "total": float(o["total"]), "status": o["status"].capitalize()})

    # ----- highlights in plain words -----
    total_revenue = round(walkin_total + online_total, 2)
    insights = []
    if total_revenue > 0:
        best = max(daily_rows, key=lambda r: r["total"])
        insights.append("Best day: " + best["date"] + " with P" + format(best["total"], ",.2f") + ".")
    if perfumes:
        insights.append("Best seller: " + perfumes[0]["name"] + " (" + str(perfumes[0]["units"]) + " sold, P" + format(perfumes[0]["revenue"], ",.2f") + ").")
    if out:
        insights.append(str(len(out)) + " perfume(s) are sold out: " + ", ".join(i["name"] for i in out[:6]) + (" ..." if len(out) > 6 else "") + ".")
    if low:
        insights.append(str(len(low)) + " perfume(s) are low (" + str(LOW_STOCK) + " or less): " + ", ".join(i["name"] for i in low[:6]) + (" ..." if len(low) > 6 else "") + ".")
    if pending:
        insights.append(str(len(pending)) + " online order(s) are still pending (P" + format(sum(float(o["total"]) for o in pending), ",.2f") + ") and are not counted as revenue yet.")
    if voided:
        insights.append(str(len(voided)) + " walk-in sale(s) were voided (P" + format(sum(float(x["total"]) for x in voided), ",.2f") + "). Check the reasons in the Walk-in sales sheet.")
    if never_sold:
        insights.append(str(len(never_sold)) + " perfume(s) did not sell at all in this period.")
    if not insights:
        insights.append("No sales in this period.")

    return {
        "period": {"start": d1.isoformat(), "end": d2.isoformat(), "days": days},
        "generated_at": datetime.now(PH_TZ).strftime("%Y-%m-%d %H:%M"),
        "generated_by": generated_by,
        "kpis": {
            "total_revenue": total_revenue,
            "walkin_total": walkin_total, "walkin_count": len(done), "walkin_items": walkin_items,
            "average_sale": round(walkin_total / len(done), 2) if done else 0,
            "online_total": online_total, "online_count": len(confirmed), "online_items": online_items,
            "pending_count": len(pending), "pending_value": round(sum(float(o["total"]) for o in pending), 2),
            "cancelled_count": len(cancelled),
            "voided_count": len(voided), "voided_total": round(sum(float(x["total"]) for x in voided), 2),
            "items_sold": walkin_items + online_items, "new_customers": raw["new_customers"],
            "perfumes": len(raw["products"]), "stock_units": stock_units, "stock_value": stock_value,
            "low_count": len(low), "out_count": len(out), "never_sold_count": len(never_sold),
        },
        "insights": insights, "daily": daily_rows, "perfumes": perfumes, "categories": categories, "payments": payments,
        "employees": employees, "order_status": order_status, "customers": customers, "inventory": inventory,
        "movement_summary": movement_summary, "movements": movements, "sales": sale_rows, "orders": order_rows,
    }


def make_xlsx(r):
    """Write the report as an Excel file (one sheet per topic). Returns the file as bytes."""
    try:
        import io
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
        from openpyxl.utils import get_column_letter
        from openpyxl.worksheet.properties import PageSetupProperties
    except ImportError:
        raise HTTPException(status_code=500, detail="Excel support is missing. Add openpyxl to requirements.txt and redeploy.")

    BERRY, GOLD, SOFT, GREY = "A3134F", "E8B84B", "FBF1F4", "6B5A62"
    FMT = {"money": '"₱"#,##0.00', "int": "#,##0"}
    thin = Side(style="thin", color="EAD7DE")
    wb = Workbook()
    wb.remove(wb.active)

    def new_sheet(title, tab=BERRY):
        ws = wb.create_sheet(title)
        ws.sheet_properties.tabColor = tab
        ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
        ws.page_setup.orientation = "landscape"
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.widths = {}
        return ws

    def heading(ws, row, text):
        c = ws.cell(row=row, column=1, value=text)
        c.font = Font(bold=True, size=13, color=BERRY)
        return row + 1

    def table(ws, row, cols, rows, total=None):
        """cols = [(header, key, kind)]. Returns the next free row."""
        for n, (h, k, kind) in enumerate(cols, 1):
            c = ws.cell(row=row, column=n, value=h)
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor=BERRY)
            c.alignment = Alignment(vertical="center", wrap_text=True)
            ws.widths[n] = max(ws.widths.get(n, 0), len(h) + 3)
        if not rows:
            c = ws.cell(row=row + 1, column=1, value="No data in this period.")
            c.font = Font(italic=True, color=GREY)
            return row + 3
        for i, rec in enumerate(rows):
            for n, (h, k, kind) in enumerate(cols, 1):
                v = rec.get(k)
                c = ws.cell(row=row + 1 + i, column=n, value=v)
                if kind in FMT:
                    c.number_format = FMT[kind]
                c.border = Border(bottom=thin)
                if i % 2:
                    c.fill = PatternFill("solid", fgColor=SOFT)
                ws.widths[n] = max(ws.widths.get(n, 0), min(len(str(v if v is not None else "")) + 3, 58))
        end = row + len(rows)
        ws.data_end = end
        if total:
            for n, (h, k, kind) in enumerate(cols, 1):
                c = ws.cell(row=end + 1, column=n, value=total.get(k))
                c.font = Font(bold=True)
                c.fill = PatternFill("solid", fgColor="FBE7B5")
                if kind in FMT:
                    c.number_format = FMT[kind]
            end += 1
        return end + 2

    def finish(ws, filter_ref=True, freeze="A2"):
        for n, w in ws.widths.items():
            ws.column_dimensions[get_column_letter(n)].width = w
        if freeze:
            ws.freeze_panes = freeze
        if filter_ref and ws.max_row > 1:
            ws.auto_filter.ref = "A1:" + get_column_letter(ws.max_column) + str(getattr(ws, "data_end", ws.max_row))

    k, p = r["kpis"], r["period"]

    # ---------- Summary ----------
    ws = new_sheet("Summary", GOLD)
    ws["A1"] = "SCNTS Perfume - Business Summary"
    ws["A1"].font = Font(bold=True, size=20, color=BERRY)
    ws["A2"] = "Period: " + p["start"] + " to " + p["end"] + " (" + str(p["days"]) + " day" + ("" if p["days"] == 1 else "s") + ")"
    ws["A2"].font = Font(bold=True, size=12)
    ws["A3"] = "Created " + r["generated_at"] + " (Philippine time) by " + r["generated_by"]
    ws["A3"].font = Font(italic=True, color=GREY)
    row = heading(ws, 5, "Key numbers")
    metrics = [
        {"m": "TOTAL REVENUE", "v": k["total_revenue"], "n": "Walk-in revenue + online revenue"},
        {"m": "Walk-in revenue", "v": k["walkin_total"], "n": "POS sales that were not voided"},
        {"m": "Online revenue", "v": k["online_total"], "n": "Website orders that are paid, shipped or delivered"},
        {"m": "Perfumes sold", "v": k["items_sold"], "n": str(k["walkin_items"]) + " walk-in + " + str(k["online_items"]) + " online"},
        {"m": "Walk-in sales", "v": k["walkin_count"], "n": "Number of POS sales"},
        {"m": "Average walk-in sale", "v": k["average_sale"], "n": "Walk-in revenue / number of walk-in sales"},
        {"m": "Online orders (counted)", "v": k["online_count"], "n": "Paid, shipped or delivered"},
        {"m": "Online orders pending", "v": k["pending_count"], "n": "Worth " + format(k["pending_value"], ",.2f") + " - not counted as revenue yet"},
        {"m": "Online orders cancelled", "v": k["cancelled_count"], "n": "Stock was put back"},
        {"m": "Walk-in sales voided", "v": k["voided_count"], "n": "Worth " + format(k["voided_total"], ",.2f") + " - not counted"},
        {"m": "New customer accounts", "v": k["new_customers"], "n": "Registered in this period"},
        {"m": "Perfumes in the shop", "v": k["perfumes"], "n": "Right now"},
        {"m": "Bottles in stock", "v": k["stock_units"], "n": "Right now"},
        {"m": "Stock value", "v": k["stock_value"], "n": "Right now, at selling price"},
        {"m": "Low stock perfumes", "v": k["low_count"], "n": str(LOW_STOCK) + " bottles or less"},
        {"m": "Sold out perfumes", "v": k["out_count"], "n": "Right now"},
        {"m": "Perfumes with no sales", "v": k["never_sold_count"], "n": "In this period"},
    ]
    money_rows = {"TOTAL REVENUE", "Walk-in revenue", "Online revenue", "Average walk-in sale", "Stock value"}
    for c, h in enumerate(("Measure", "Value", "Note"), 1):
        x = ws.cell(row=row, column=c, value=h)
        x.font = Font(bold=True, color="FFFFFF")
        x.fill = PatternFill("solid", fgColor=BERRY)
        if c == 2:
            x.alignment = Alignment(horizontal="right")
    for i, m in enumerate(metrics):
        a, b, c = ws.cell(row=row + 1 + i, column=1, value=m["m"]), ws.cell(row=row + 1 + i, column=2, value=m["v"]), ws.cell(row=row + 1 + i, column=3, value=m["n"])
        b.number_format = FMT["money"] if m["m"] in money_rows else FMT["int"]
        b.alignment = Alignment(horizontal="right")
        c.font = Font(color=GREY)
        for x in (a, b, c):
            x.border = Border(bottom=thin)
        if m["m"] == "TOTAL REVENUE":
            for x in (a, b, c):
                x.font = Font(bold=True, size=12)
                x.fill = PatternFill("solid", fgColor="FBE7B5")
    row += len(metrics) + 2
    row = heading(ws, row, "Highlights")
    for line in r["insights"]:
        ws.cell(row=row, column=1, value="- " + line)
        row += 1
    row += 1
    row = heading(ws, row, "How to read this report")
    for line in (
        "Revenue only counts money that came in: walk-in sales that are not voided, and online orders that are paid, shipped or delivered.",
        "Pending online orders are shown on their own. Cancelled orders and voided sales are never counted.",
        "The report has no cost prices, so it shows sales (revenue), not profit.",
        "Stock sheets show the stock right now. The stock log shows every change inside the chosen dates.",
        "All dates and times are Philippine time.",
    ):
        ws.cell(row=row, column=1, value="- " + line).font = Font(color=GREY)
        row += 1
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 20
    ws.column_dimensions["C"].width = 62

    # ---------- Daily ----------
    ws = new_sheet("Daily")
    cols = [("Date", "date", "text"), ("Walk-in sales", "walkin_count", "int"), ("Walk-in revenue", "walkin_total", "money"),
            ("Online orders", "online_count", "int"), ("Online revenue", "online_total", "money"),
            ("Total revenue", "total", "money"), ("Voided sales", "voided", "int")]
    t = {"date": "TOTAL"}
    for key in ("walkin_count", "walkin_total", "online_count", "online_total", "total", "voided"):
        t[key] = round(sum(d[key] for d in r["daily"]), 2)
    table(ws, 1, cols, r["daily"], total=t)
    finish(ws)

    # ---------- Perfumes ----------
    ws = new_sheet("Perfumes")
    cols = [("Perfume", "name", "text"), ("For", "category_label", "text"), ("Walk-in units", "walkin_units", "int"),
            ("Online units", "online_units", "int"), ("Total units", "units", "int"), ("Revenue", "revenue", "money"),
            ("Stock now", "stock", "int")]
    t = {"name": "TOTAL", "walkin_units": sum(a["walkin_units"] for a in r["perfumes"]), "online_units": sum(a["online_units"] for a in r["perfumes"]),
         "units": sum(a["units"] for a in r["perfumes"]), "revenue": round(sum(a["revenue"] for a in r["perfumes"]), 2)}
    table(ws, 1, cols, r["perfumes"], total=t)
    finish(ws)

    # ---------- Breakdown ----------
    ws = new_sheet("Breakdown")
    row = heading(ws, 1, "By category")
    row = table(ws, row, [("Category", "category", "text"), ("Units sold", "units", "int"), ("Revenue", "revenue", "money")], r["categories"])
    row = heading(ws, row, "Walk-in payment methods")
    row = table(ws, row, [("Method", "method", "text"), ("Sales", "count", "int"), ("Total", "total", "money")], r["payments"])
    row = heading(ws, row, "Online orders by status")
    row = table(ws, row, [("Status", "status", "text"), ("Orders", "count", "int"), ("Value", "total", "money")], r["order_status"])
    row = heading(ws, row, "Stock changes in this period")
    table(ws, row, [("Reason", "reason", "text"), ("Times", "count", "int"), ("Bottles added", "units_in", "int"), ("Bottles taken out", "units_out", "int")], r["movement_summary"])
    finish(ws, filter_ref=False, freeze=None)

    # ---------- Employees ----------
    ws = new_sheet("Employees")
    table(ws, 1, [("Employee", "name", "text"), ("Sales", "sales", "int"), ("Perfumes sold", "items", "int"), ("Total", "total", "money"),
                  ("Average sale", "average", "money"), ("Voided sales", "voided", "int")], r["employees"])
    finish(ws)

    # ---------- Inventory ----------
    ws = new_sheet("Inventory")
    t = {"name": "TOTAL", "stock": sum(i["stock"] for i in r["inventory"]), "value": round(sum(i["value"] for i in r["inventory"]), 2),
         "sold": sum(i["sold"] for i in r["inventory"])}
    table(ws, 1, [("Perfume", "name", "text"), ("Brand", "brand", "text"), ("For", "category", "text"), ("Size (ml)", "size_ml", "int"),
                  ("Price", "price", "money"), ("In stock", "stock", "int"), ("Stock value", "value", "money"), ("Status", "status", "text"),
                  ("Sold in period", "sold", "int"), ("Days of stock left*", "days_left", "int")], r["inventory"], total=t)
    n = ws.max_row + 2
    ws.cell(row=n, column=1, value="* Estimated from how fast it sold in this period. Empty = no sales, or already sold out.").font = Font(italic=True, color=GREY)
    for rr in range(2, ws.max_row):
        c = ws.cell(row=rr, column=8)
        if c.value == "Sold out":
            c.font = Font(bold=True, color="C0392B")
        elif c.value == "Low":
            c.font = Font(bold=True, color="B9770E")
    finish(ws)

    # ---------- Stock log ----------
    ws = new_sheet("Stock log")
    table(ws, 1, [("When", "when", "text"), ("Perfume", "perfume", "text"), ("Change", "change", "int"), ("Stock after", "after", "int"),
                  ("Reason", "reason", "text"), ("By", "by", "text"), ("Note", "note", "text")], r["movements"])
    finish(ws)

    # ---------- Walk-in sales ----------
    ws = new_sheet("Walk-in sales")
    table(ws, 1, [("#", "id", "int"), ("Date", "date", "text"), ("Time", "time", "text"), ("Employee", "employee", "text"), ("Perfumes", "perfumes", "text"),
                  ("Payment", "payment", "text"), ("Total", "total", "money"), ("Status", "status", "text"), ("Void reason", "void_reason", "text"),
                  ("Note", "note", "text")], r["sales"])
    for rr in range(2, ws.max_row + 1):
        if ws.cell(row=rr, column=8).value == "VOIDED":
            for cc in range(1, 11):
                ws.cell(row=rr, column=cc).font = Font(color="B03A2E", strike=(cc in (7,)))
    finish(ws)

    # ---------- Online orders ----------
    ws = new_sheet("Online orders")
    table(ws, 1, [("Order #", "id", "int"), ("Date", "date", "text"), ("Time", "time", "text"), ("Customer", "customer", "text"), ("Email", "email", "text"),
                  ("Perfumes", "perfumes", "text"), ("Total", "total", "money"), ("Status", "status", "text")], r["orders"])
    finish(ws)

    # ---------- Customers ----------
    ws = new_sheet("Top customers")
    table(ws, 1, [("Customer", "name", "text"), ("Email", "email", "text"), ("Orders", "orders", "int"), ("Total spent", "total", "money")], r["customers"])
    finish(ws)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@app.get("/reports/summary")
def report_summary(start: Optional[str] = None, end: Optional[str] = None, admin=Depends(admin_only)):
    d1, d2 = report_period(start, end)
    return build_report(d1, d2, load_report_data(d1, d2), admin["name"])


@app.get("/reports/export")
def report_export(start: Optional[str] = None, end: Optional[str] = None, admin=Depends(admin_only)):
    d1, d2 = report_period(start, end)
    data = make_xlsx(build_report(d1, d2, load_report_data(d1, d2), admin["name"]))
    name = "SCNTS-report-" + d1.isoformat() + "_to_" + d2.isoformat() + ".xlsx"
    return Response(content=data, headers={
        "Content-Disposition": 'attachment; filename="' + name + '"',
        "Access-Control-Expose-Headers": "Content-Disposition",
        "Cache-Control": "no-store",
    }, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
