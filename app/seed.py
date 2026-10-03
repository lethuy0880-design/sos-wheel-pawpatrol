import os

import bcrypt

from app.database import Base, SessionLocal, engine
from app.models import Mechanic, Service, Setting


SERVICES = [
    ("fuel", "Xăng", "Tiếp nhiên liệu tận nơi", 30000, 50000, "range"),
    ("tire_patch", "Lốp", "Vá lốp không săm", 40000, 70000, "range"),
    ("tire_tube", "Lốp", "Thay ruột xe", 60000, 120000, "range"),
    ("battery_jump", "Bình điện", "Kích bình ắc quy", 50000, 100000, "range"),
    ("battery_replace", "Bình điện", "Thay bình ắc quy", 250000, 650000, "range"),
    ("chain_adjust", "Xích", "Tăng chỉnh, tra dầu xích", 30000, 60000, "range"),
    ("belt_replace", "Xích", "Kiểm tra dây curoa", 80000, 250000, "range"),
    ("diagnose", "Chưa rõ", "Kiểm tra và chẩn đoán", 30000, 80000, "actual"),
]

MECHANICS = [
    ("Minh Phát", "0900000001", 21.0285, 105.8542),
    ("Hoàng Nam", "0900000002", 21.0330, 105.8460),
    ("Tuấn Anh", "0900000003", 21.0215, 105.8610),
]


def seed_database():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if not db.get(Setting, 1):
            db.add(Setting(id=1))
        for code, group_name, name, price_min, price_max, price_type in SERVICES:
            if not db.query(Service).filter_by(code=code).first():
                db.add(Service(code=code, group_name=group_name, name=name, price_min=price_min,
                               price_max=price_max, price_type=price_type, is_active=True))
        demo_password = os.getenv("DEMO_MECHANIC_PASSWORD", "soswheel123").encode("utf-8")
        for name, phone, lat, lng in MECHANICS:
            if not db.query(Mechanic).filter_by(phone=phone).first():
                db.add(Mechanic(name=name, phone=phone,
                                password_hash=bcrypt.hashpw(demo_password, bcrypt.gensalt()).decode(),
                                is_approved=True, is_available=True, lat=lat, lng=lng))
        db.commit()