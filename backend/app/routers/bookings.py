"""Booking links: your booking hours (logged in), and the public booking page's two calls."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import auth, bookings, gmail
from ..db import get_db
from ..schemas import BookedOut, BookIn, BookingPageOut, BookingSettingsIn, BookingSettingsOut

router = APIRouter(prefix="/api/booking", tags=["booking links"])
# No login: the visitor is the person you emailed. Only these two calls are open.
public = APIRouter(prefix="/api/book", tags=["booking page"])


def _settings_out(db: Session) -> BookingSettingsOut:
    s = bookings.get_settings(db)
    fields = {k: getattr(s, k) for k in BookingSettingsIn.model_fields}
    return BookingSettingsOut(**fields, can_check_calendar=gmail.can(gmail.current_account(db), gmail.CALENDAR_SCOPE))


@router.get("/settings", response_model=BookingSettingsOut)
def get_settings(db: Session = Depends(get_db)):
    return _settings_out(db)


@router.put("/settings", response_model=BookingSettingsOut)
def update_settings(body: BookingSettingsIn, db: Session = Depends(get_db)):
    s = bookings.get_settings(db)
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    db.commit()
    return _settings_out(db)


@public.get("/{token}", response_model=BookingPageOut)
def booking_page(token: str, request: Request, db: Session = Depends(get_db)):
    try:
        bookings.check_rate(auth.client_ip(request))
        return bookings.page(db, token)
    except bookings.BookingError as e:
        raise HTTPException(e.status, str(e)) from e


@public.post("/{token}", response_model=BookedOut)
def book(token: str, body: BookIn, request: Request, db: Session = Depends(get_db)):
    try:
        bookings.check_rate(auth.client_ip(request))
        return bookings.book(db, token, body.starts_at)
    except bookings.BookingError as e:
        raise HTTPException(e.status, str(e)) from e
