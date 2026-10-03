from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utc_now


class Service(Base):
    __tablename__ = "services"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    group_name: Mapped[str] = mapped_column(String(60))
    name: Mapped[str] = mapped_column(String(100))
    price_min: Mapped[int] = mapped_column(Integer, default=0)
    price_max: Mapped[int] = mapped_column(Integer, default=0)
    price_type: Mapped[str] = mapped_column(String(20), default="range")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Setting(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    base_fee: Mapped[int] = mapped_column(Integer, default=15000)
    free_km: Mapped[float] = mapped_column(Float, default=2)
    per_km: Mapped[int] = mapped_column(Integer, default=5000)
    distance_factor: Mapped[float] = mapped_column(Float, default=1.3)
    fuel_price: Mapped[int] = mapped_column(Integer, default=25000)
    fuel_default_liters: Mapped[float] = mapped_column(Float, default=2)
    radius_km: Mapped[float] = mapped_column(Float, default=200)
    avg_speed_kmh: Mapped[float] = mapped_column(Float, default=20)
    request_timeout_seconds: Mapped[int] = mapped_column(Integer, default=120)


class Mechanic(Base):
    __tablename__ = "mechanics"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_available: Mapped[bool] = mapped_column(Boolean, default=False)
    location_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class RescueRequest(Base):
    __tablename__ = "rescue_requests"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id"))
    requested_mechanic_id: Mapped[int | None] = mapped_column(ForeignKey("mechanics.id"), nullable=True)
    mechanic_id: Mapped[int | None] = mapped_column(ForeignKey("mechanics.id"), nullable=True)
    customer_lat: Mapped[float] = mapped_column(Float)
    customer_lng: Mapped[float] = mapped_column(Float)
    customer_phone: Mapped[str] = mapped_column(String(30))
    distance_km: Mapped[float] = mapped_column(Float, default=0)
    service_fee_min: Mapped[int] = mapped_column(Integer, default=0)
    service_fee_max: Mapped[int] = mapped_column(Integer, default=0)
    travel_fee: Mapped[int] = mapped_column(Integer, default=0)
    total_min: Mapped[int] = mapped_column(Integer, default=0)
    total_max: Mapped[int] = mapped_column(Integer, default=0)
    service_fee_actual: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extra_fee: Mapped[int] = mapped_column(Integer, default=0)
    extra_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    diagnose_deducted: Mapped[bool] = mapped_column(Boolean, default=False)
    final_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    customer_token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    share_token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    review_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    service: Mapped[Service] = relationship()
    mechanic: Mapped[Mechanic | None] = relationship(foreign_keys=[mechanic_id])