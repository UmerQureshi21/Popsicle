"""The daily send limit and minimum gap between emails."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import sending
from ..db import get_db
from ..schemas import SendingQuota, SendingSettingsIn

router = APIRouter(prefix="/api/sending", tags=["sending limits"])


@router.get("/quota", response_model=SendingQuota)
def get_quota(db: Session = Depends(get_db)):
    return SendingQuota(**vars(sending.quota(db)))


@router.put("/settings", response_model=SendingQuota)
def update_settings(body: SendingSettingsIn, db: Session = Depends(get_db)):
    s = sending.get_settings(db)
    s.daily_limit = body.daily_limit
    s.min_delay_seconds = body.min_delay_seconds
    db.commit()
    return SendingQuota(**vars(sending.quota(db)))
