import math
import os
import secrets
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated

import bcrypt
import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db, utc_now
from app.models import Mechanic, RescueRequest, Service, Setting
from app.seed import seed_database


ROOT = Path(__file__).resolve().parent
app = FastAPI(title="SOS Wheel", version="1.0.0")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
templates = Jinja2Templates(directory=ROOT / "templates")
serializer = URLSafeTimedSerializer(os.getenv("SOSWHEEL_SECRET", "dev-only-change-this-secret"))
DEFAULT_SETTINGS = {
    "base_fee": 15000, "free_km": 2, "per_km": 5000, "distance_factor": 1.3,
    "fuel_price": 25000, "fuel_default_liters": 2, "radius_km": 200,
    "avg_speed_kmh": 20, "request_timeout_seconds": 120,
}
ADMIN_USER = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
ACTIVE_STATUSES = {"pending", "accepted", "arriving", "in_progress"}


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    seed_database()


class Coordinates(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RegisterMechanic(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=8, max_length=30)
    password: str = Field(min_length=8, max_length=128)


class Login(BaseModel):
    phone: str
    password: str


class AdminLogin(BaseModel):
    username: str
    password: str


class RescueCreate(Coordinates):
    service_code: str
    mechanic_id: int
    customer_phone: str = Field(min_length=8, max_length=30)


class LocationUpdate(Coordinates):
    is_available: bool


class ExtraFee(BaseModel):
    amount: int = Field(ge=0, le=2_000_000)
    note: str = Field(default="", max_length=300)


class Review(BaseModel):
    rating: int = Field(ge=1, le=5)
    review_text: str = Field(default="", max_length=1000)


def issue_token(payload: dict) -> str:
    return serializer.dumps(payload)


def token_payload(token: str, max_age: int = 60 * 60 * 24 * 14) -> dict:
    try:
        result = serializer.loads(token, max_age=max_age)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ hoặc đã hết hạn")
    if not isinstance(result, dict):
        raise HTTPException(status_code=401, detail="Token không hợp lệ")
    return result


def bearer(authorization: str | None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")
    return token_payload(authorization[7:].strip())


def require_mechanic(authorization: str | None, db: Session) -> Mechanic:
    payload = bearer(authorization)
    mechanic = db.get(Mechanic, payload.get("mechanic_id"))
    if not mechanic:
        raise HTTPException(status_code=401, detail="Không tìm thấy tài khoản thợ")
    return mechanic


def require_admin(authorization: str | None):
    if bearer(authorization).get("role") != "admin":
        raise HTTPException(status_code=403, detail="Chỉ quản trị viên mới được thực hiện thao tác này")


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371.0
    lat1, lat2 = math.radians(lat1), math.radians(lat2)
    delta_lat, delta_lng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    value = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(value))


def read_settings(db: Session) -> dict:
    row = db.get(Setting, 1)
    if row is None:
        return DEFAULT_SETTINGS.copy()
    return {key: getattr(row, key) for key in DEFAULT_SETTINGS}


def price_for(distance_km: float, config: dict) -> tuple[float, int]:
    adjusted = distance_km * config["distance_factor"]
    billable_km = max(0, math.ceil(adjusted - config["free_km"]))
    travel_fee = config["base_fee"] + billable_km * config["per_km"]
    return adjusted, travel_fee


def mechanic_public(mechanic: Mechanic, distance_km: float | None = None) -> dict:
    return {"id": mechanic.id, "name": mechanic.name, "phone": mechanic.phone,
            "lat": mechanic.lat, "lng": mechanic.lng, "distance_km": round(distance_km, 2) if distance_km is not None else None}


def request_public(item: RescueRequest, include_mechanic: bool = True) -> dict:
    data = {"id": item.id, "service_code": item.service.code, "service_name": item.service.name,
            "customer_lat": item.customer_lat, "customer_lng": item.customer_lng,
            "customer_phone": item.customer_phone, "distance_km": item.distance_km,
            "service_fee_min": item.service_fee_min, "service_fee_max": item.service_fee_max,
            "travel_fee": item.travel_fee, "total_min": item.total_min, "total_max": item.total_max,
            "service_fee_actual": item.service_fee_actual, "extra_fee": item.extra_fee,
            "extra_confirmed": item.extra_confirmed, "final_amount": item.final_amount,
            "status": item.status, "created_at": item.created_at.isoformat(),
            "accepted_at": item.accepted_at.isoformat() if item.accepted_at else None,
            "arrived_at": item.arrived_at.isoformat() if item.arrived_at else None,
            "completed_at": item.completed_at.isoformat() if item.completed_at else None,
            "rating": item.rating, "review_text": item.review_text}
    if include_mechanic and item.mechanic:
        data["mechanic"] = mechanic_public(item.mechanic)
    return data


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(request=request, name="index.html", context={})


@app.get("/health")
def health():
    return {"status": "ok", "app": "SOS Wheel"}


@app.get("/api/services")
def list_services(db: Session = Depends(get_db)):
    services = db.query(Service).filter_by(is_active=True).order_by(Service.id).all()
    return [{"id": s.id, "code": s.code, "group_name": s.group_name, "name": s.name,
             "price_min": s.price_min, "price_max": s.price_max, "price_type": s.price_type} for s in services]


@app.get("/api/settings")
def settings(db: Session = Depends(get_db)):
    return read_settings(db)


@app.post("/api/quote")
def quote(location: Coordinates, service_code: str, db: Session = Depends(get_db)):
    service = db.query(Service).filter_by(code=service_code, is_active=True).first()
    if not service:
        raise HTTPException(status_code=404, detail="Không tìm thấy dịch vụ")
    config = read_settings(db)
    candidates = db.query(Mechanic).filter_by(is_approved=True, is_available=True).all()
    distances = [haversine_km(location.lat, location.lng, m.lat, m.lng)
                 for m in candidates if m.lat is not None and m.lng is not None]
    distance = min(distances, default=0)
    adjusted, travel_fee = price_for(distance, config)
    fuel_extra = config["fuel_price"] * config["fuel_default_liters"] if service.code == "fuel" else 0
    return {"service": {"code": service.code, "name": service.name, "price_min": service.price_min,
                         "price_max": service.price_max},
            "nearest_distance_km": round(distance, 2), "adjusted_distance_km": round(adjusted, 2),
            "travel_fee": travel_fee + fuel_extra, "total_min": service.price_min + travel_fee + fuel_extra,
            "total_max": service.price_max + travel_fee + fuel_extra,
            "fuel_note": "Phí xăng tính theo thực tế" if service.code == "fuel" else None}


@app.get("/api/mechanics/nearby")
def nearby_mechanics(lat: float, lng: float, db: Session = Depends(get_db)):
    config = read_settings(db)
    mechanics = db.query(Mechanic).filter_by(is_approved=True, is_available=True).all()
    matches = []
    for mechanic in mechanics:
        if mechanic.lat is None or mechanic.lng is None:
            continue
        distance = haversine_km(lat, lng, mechanic.lat, mechanic.lng)
        if distance <= config["radius_km"]:
            matches.append(mechanic_public(mechanic, distance))
    return sorted(matches, key=lambda value: value["distance_km"])


@app.post("/api/requests")
def create_request(data: RescueCreate, db: Session = Depends(get_db)):
    service = db.query(Service).filter_by(code=data.service_code, is_active=True).first()
    mechanic = db.get(Mechanic, data.mechanic_id)
    if not service:
        raise HTTPException(status_code=404, detail="Dịch vụ không hợp lệ")
    config = read_settings(db)
    if not mechanic or not mechanic.is_approved or not mechanic.is_available or mechanic.lat is None:
        raise HTTPException(status_code=409, detail="Thợ hiện không nhận cứu hộ")
    distance = haversine_km(data.lat, data.lng, mechanic.lat, mechanic.lng)
    if distance > config["radius_km"]:
        raise HTTPException(status_code=409, detail="Thợ nằm ngoài khu vực phục vụ")
    adjusted, travel_fee = price_for(distance, config)
    request_id = f"SOS-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
    extra = config["fuel_price"] * config["fuel_default_liters"] if service.code == "fuel" else 0
    item = RescueRequest(id=request_id, service_id=service.id, requested_mechanic_id=mechanic.id,
                         customer_lat=data.lat, customer_lng=data.lng, customer_phone=data.customer_phone,
                         distance_km=adjusted, service_fee_min=service.price_min, service_fee_max=service.price_max,
                         travel_fee=travel_fee + extra, total_min=service.price_min + travel_fee + extra,
                         total_max=service.price_max + travel_fee + extra,
                         customer_token=secrets.token_urlsafe(32), share_token=secrets.token_urlsafe(32))
    db.add(item)
    db.commit()
    db.refresh(item)
    return {**request_public(item), "customer_token": item.customer_token,
            "share_url": f"/track/{item.share_token}"}


@app.get("/api/requests/{request_id}")
def track_request(request_id: str, token: str, db: Session = Depends(get_db)):
    item = db.query(RescueRequest).filter_by(id=request_id, customer_token=token).first()
    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn")
    return {**request_public(item), "share_url": f"/track/{item.share_token}"}


@app.get("/track/{share_token}", response_class=HTMLResponse)
def share_page(request: Request, share_token: str, db: Session = Depends(get_db)):
    item = db.query(RescueRequest).filter_by(share_token=share_token).first()
    if not item:
        raise HTTPException(status_code=404, detail="Liên kết theo dõi không hợp lệ")
    return templates.TemplateResponse(request=request, name="index.html", context={"share_token": share_token})


@app.get("/api/track/{share_token}")
def share_track(share_token: str, db: Session = Depends(get_db)):
    item = db.query(RescueRequest).filter_by(share_token=share_token).first()
    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn")
    data = {"id": item.id, "status": item.status, "customer_lat": item.customer_lat,
            "customer_lng": item.customer_lng, "created_at": item.created_at.isoformat()}
    if item.mechanic and item.status != "pending":
        data["mechanic"] = mechanic_public(item.mechanic)
    return data


@app.post("/api/requests/{request_id}/review")
def add_review(request_id: str, token: str, data: Review, db: Session = Depends(get_db)):
    item = db.query(RescueRequest).filter_by(id=request_id, customer_token=token).first()
    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn")
    if item.status != "completed":
        raise HTTPException(status_code=409, detail="Chỉ có thể đánh giá đơn đã hoàn thành")
    if item.rating is not None:
        raise HTTPException(status_code=409, detail="Đơn này đã được đánh giá")
    item.rating, item.review_text = data.rating, data.review_text
    db.commit()
    return {"ok": True}


@app.post("/api/mechanics/register", status_code=201)
def register_mechanic(data: RegisterMechanic, db: Session = Depends(get_db)):
    if db.query(Mechanic).filter_by(phone=data.phone).first():
        raise HTTPException(status_code=409, detail="Số điện thoại đã được đăng ký")
    mechanic = Mechanic(name=data.name, phone=data.phone,
                        password_hash=bcrypt.hashpw(data.password.encode(), bcrypt.gensalt()).decode(),
                        is_approved=False, is_available=False)
    db.add(mechanic)
    db.commit()
    return {"ok": True, "message": "Tài khoản đang chờ quản trị viên duyệt"}


@app.post("/api/mechanics/login")
def mechanic_login(data: Login, db: Session = Depends(get_db)):
    mechanic = db.query(Mechanic).filter_by(phone=data.phone).first()
    if not mechanic or not bcrypt.checkpw(data.password.encode(), mechanic.password_hash.encode()):
        raise HTTPException(status_code=401, detail="Số điện thoại hoặc mật khẩu không đúng")
    if not mechanic.is_approved:
        raise HTTPException(status_code=403, detail="Tài khoản đang chờ Admin duyệt")
    return {"access_token": issue_token({"mechanic_id": mechanic.id, "role": "mechanic"}),
            "mechanic": mechanic_public(mechanic)}


@app.get("/api/mechanics/me")
def mechanic_profile(authorization: Annotated[str | None, Header()] = None, db: Session = Depends(get_db)):
    return mechanic_public(require_mechanic(authorization, db))


@app.post("/api/mechanics/location")
def update_location(data: LocationUpdate, authorization: Annotated[str | None, Header()] = None,
                    db: Session = Depends(get_db)):
    mechanic = require_mechanic(authorization, db)
    mechanic.lat, mechanic.lng = data.lat, data.lng
    mechanic.location_updated_at = utc_now()
    mechanic.is_available = data.is_available
    db.commit()
    return {"ok": True, "is_available": mechanic.is_available}


@app.get("/api/mechanics/requests")
def mechanic_requests(authorization: Annotated[str | None, Header()] = None, db: Session = Depends(get_db)):
    mechanic = require_mechanic(authorization, db)
    items = db.query(RescueRequest).filter(RescueRequest.requested_mechanic_id == mechanic.id,
                                           RescueRequest.status.in_(ACTIVE_STATUSES)).order_by(RescueRequest.created_at.desc()).all()
    return [request_public(item, include_mechanic=False) for item in items]


@app.post("/api/mechanics/requests/{request_id}/accept")
def accept_request(request_id: str, authorization: Annotated[str | None, Header()] = None,
                   db: Session = Depends(get_db)):
    mechanic = require_mechanic(authorization, db)
    item = db.get(RescueRequest, request_id)
    if not item or item.requested_mechanic_id != mechanic.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn được gửi cho bạn")
    if item.status != "pending":
        raise HTTPException(status_code=409, detail="Đơn đã được xử lý")
    item.status, item.mechanic_id, item.accepted_at = "accepted", mechanic.id, utc_now()
    db.commit()
    return request_public(item)


@app.post("/api/mechanics/requests/{request_id}/arrive")
def arrive_request(request_id: str, authorization: Annotated[str | None, Header()] = None,
                   db: Session = Depends(get_db)):
    return transition_request(request_id, "accepted", "arriving", "arrived_at", authorization, db)


@app.post("/api/mechanics/requests/{request_id}/start")
def start_request(request_id: str, authorization: Annotated[str | None, Header()] = None,
                  db: Session = Depends(get_db)):
    return transition_request(request_id, "arriving", "in_progress", None, authorization, db)


def transition_request(request_id: str, old_status: str, new_status: str, time_field: str | None,
                       authorization: str | None, db: Session):
    mechanic = require_mechanic(authorization, db)
    item = db.get(RescueRequest, request_id)
    if not item or item.mechanic_id != mechanic.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn")
    if item.status != old_status:
        raise HTTPException(status_code=409, detail=f"Không thể chuyển đơn từ {item.status} sang {new_status}")
    item.status = new_status
    if time_field:
        setattr(item, time_field, utc_now())
    db.commit()
    return request_public(item)


@app.post("/api/mechanics/requests/{request_id}/extra")
def report_extra(request_id: str, data: ExtraFee, authorization: Annotated[str | None, Header()] = None,
                 db: Session = Depends(get_db)):
    mechanic = require_mechanic(authorization, db)
    item = db.get(RescueRequest, request_id)
    if not item or item.mechanic_id != mechanic.id or item.status != "in_progress":
        raise HTTPException(status_code=409, detail="Không thể báo phát sinh cho đơn này")
    item.extra_fee, item.extra_confirmed = data.amount, False
    db.commit()
    return {"ok": True, "message": "Đã gửi phát sinh, cần khách xác nhận", "amount": data.amount, "note": data.note}


@app.post("/api/requests/{request_id}/extra/confirm")
def confirm_extra(request_id: str, token: str, db: Session = Depends(get_db)):
    item = db.query(RescueRequest).filter_by(id=request_id, customer_token=token).first()
    if not item or item.status != "in_progress":
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn")
    item.extra_confirmed = True
    db.commit()
    return {"ok": True}


@app.post("/api/mechanics/requests/{request_id}/complete")
def complete_request(request_id: str, authorization: Annotated[str | None, Header()] = None,
                     db: Session = Depends(get_db)):
    mechanic = require_mechanic(authorization, db)
    item = db.get(RescueRequest, request_id)
    if not item or item.mechanic_id != mechanic.id or item.status != "in_progress":
        raise HTTPException(status_code=409, detail="Không thể hoàn thành đơn này")
    if item.extra_fee > 0 and not item.extra_confirmed:
        raise HTTPException(status_code=409, detail="Khách chưa xác nhận phí phát sinh")
    item.status, item.completed_at = "completed", utc_now()
    item.service_fee_actual = item.service_fee_min if item.service_fee_min == item.service_fee_max else None
    item.final_amount = (item.service_fee_actual if item.service_fee_actual is not None else item.service_fee_min) + item.travel_fee + item.extra_fee
    db.commit()
    return request_public(item)


@app.post("/api/admin/login")
def admin_login(data: AdminLogin):
    if data.username != ADMIN_USER or data.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Thông tin Admin không đúng")
    return {"access_token": issue_token({"role": "admin"})}


@app.get("/api/admin/mechanics")
def admin_mechanics(authorization: Annotated[str | None, Header()] = None, db: Session = Depends(get_db)):
    require_admin(authorization)
    return [{"id": m.id, "name": m.name, "phone": m.phone, "is_approved": m.is_approved,
             "is_available": m.is_available, "created_at": m.created_at.isoformat()} for m in db.query(Mechanic).order_by(Mechanic.created_at.desc()).all()]


@app.post("/api/admin/mechanics/{mechanic_id}/approve")
def approve_mechanic(mechanic_id: int, authorization: Annotated[str | None, Header()] = None,
                     db: Session = Depends(get_db)):
    require_admin(authorization)
    mechanic = db.get(Mechanic, mechanic_id)
    if not mechanic:
        raise HTTPException(status_code=404, detail="Không tìm thấy thợ")
    mechanic.is_approved = True
    db.commit()
    return {"ok": True}


@app.get("/api/admin/analytics")
def admin_analytics(authorization: Annotated[str | None, Header()] = None, db: Session = Depends(get_db)):
    require_admin(authorization)
    rows = db.query(RescueRequest, Service).join(Service).all()
    records = [{"created_at": item.created_at, "status": item.status, "rating": item.rating,
                "service": service.group_name, "lat": item.customer_lat, "lng": item.customer_lng,
                "response_minutes": (item.accepted_at - item.created_at).total_seconds() / 60 if item.accepted_at else None}
               for item, service in rows]
    frame = pd.DataFrame(records)
    if frame.empty:
        return {"total_requests": 0, "popular_services": [], "peak_hours": [], "hotspots": [],
                "avg_response_minutes": None, "average_rating": None}
    frame["hour"] = pd.to_datetime(frame["created_at"]).dt.hour
    frame["area"] = frame.apply(lambda row: f"{row['lat']:.2f}, {row['lng']:.2f}", axis=1)
    return {"total_requests": len(frame), "popular_services": frame.groupby("service").size().sort_values(ascending=False).head(5).rename_axis("name").reset_index(name="count").to_dict("records"),
            "peak_hours": frame.groupby("hour").size().sort_values(ascending=False).head(5).rename_axis("hour").reset_index(name="count").to_dict("records"),
            "hotspots": frame.groupby("area").size().sort_values(ascending=False).head(5).rename_axis("area").reset_index(name="count").to_dict("records"),
            "avg_response_minutes": round(float(frame["response_minutes"].mean()), 1) if frame["response_minutes"].notna().any() else None,
            "average_rating": round(float(frame["rating"].mean()), 2) if frame["rating"].notna().any() else None}


@app.get("/api/admin/requests")
def admin_requests(authorization: Annotated[str | None, Header()] = None, db: Session = Depends(get_db)):
    require_admin(authorization)
    items = db.query(RescueRequest).order_by(RescueRequest.created_at.desc()).limit(100).all()
    return [request_public(item) for item in items]