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
@app.post("/auth/register", status_code=201)
def register(data: RegisterIn):
    email = data.email.strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=422, detail="Please enter a valid email.")
    if len(data.password.encode("utf-8")) > 72:
        raise HTTPException(status_code=422, detail="Password is too long.")

    exists = run(db().table("users").select("id").eq("email", email).limit(1))
    if exists.data:
        raise HTTPException(status_code=409, detail="This email is already registered.")

    role = run(db().table("roles").select("id").eq("role", "user").limit(1))
    if not role.data:
        raise HTTPException(status_code=500, detail="Roles table is empty. Add the 'user' role first.")

    new_user = {
        "name": data.name.strip(),
        "email": email,
        "password_hash": hash_password(data.password),
        "role_id": role.data[0]["id"],
    }
    res = run(db().table("users").insert(new_user))
    row = res.data[0]
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": "user"}


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
    # Join the same perfume if it was sent twice
    wanted = {}
    for item in data.items:
        wanted[item.product_id] = wanted.get(item.product_id, 0) + item.quantity

    ids = list(wanted.keys())
    found = run(db().table("products").select("id,name,price,stock").in_("id", ids))
    products = {p["id"]: p for p in found.data}

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
    except HTTPException:
        run(db().table("orders").delete().eq("id", order_id))
        raise

    for pid, qty in wanted.items():
        run(db().table("products").update({"stock": products[pid]["stock"] - qty}).eq("id", pid))

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
    res = run(db().table("orders").update({"status": data.status}).eq("id", order_id))
    if not res.data:
        raise HTTPException(status_code=404, detail="Order not found.")
    return res.data[0]
