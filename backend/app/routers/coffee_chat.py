"""Coffee chat sheets: About me, and each person's sheet as a PDF (notes are saved on the contact)."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import coffee_chat
from ..db import get_db
from ..models import Contact
from ..schemas import ProfileIo

router = APIRouter(prefix="/api", tags=["coffee chat"])


@router.get("/profile", response_model=ProfileIo)
def get_profile(db: Session = Depends(get_db)):
    return ProfileIo(about=coffee_chat.get_profile(db).about)


@router.put("/profile", response_model=ProfileIo)
def save_profile(body: ProfileIo, db: Session = Depends(get_db)):
    p = coffee_chat.get_profile(db)
    p.about = body.about
    db.commit()
    return ProfileIo(about=p.about)


@router.get("/contacts/{contact_id}/coffee-chat.pdf")
def coffee_chat_pdf(contact_id: int, download: bool = False, db: Session = Depends(get_db)):
    """Their sheet: shown in the browser, or saved as a file with ?download=1."""
    contact = db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(404, "Contact not found")
    sheet = coffee_chat.sheet(db, contact)
    how = "attachment" if download else "inline"
    return Response(
        sheet.data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'{how}; filename="{sheet.filename}"', "Cache-Control": "no-store"},
    )
