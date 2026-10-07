"""Templates, attachments, Gmail connection and stats."""

import mimetypes
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import gmail
from ..config import settings
from ..db import get_db
from ..models import Attachment, Company, Contact, Email, EmailStatus, GmailAccount, Template
from ..schemas import AttachmentOut, GmailStatus, Stats, TemplateIn, TemplateOut

router = APIRouter(prefix="/api")

MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024  # Gmail's limit is 25MB for the whole message


# ---- Templates ----------------------------------------------------------


@router.get("/templates", response_model=list[TemplateOut], tags=["templates"])
def list_templates(db: Session = Depends(get_db)):
    return db.scalars(select(Template).order_by(Template.updated_at.desc())).all()


@router.post("/templates", response_model=TemplateOut, status_code=201, tags=["templates"])
def create_template(body: TemplateIn, db: Session = Depends(get_db)):
    t = Template(**body.model_dump())
    db.add(t)
    try:
        db.commit()
    except IntegrityError as e:
        raise HTTPException(409, f'A template named "{body.name}" already exists.') from e
    return t


@router.put("/templates/{template_id}", response_model=TemplateOut, tags=["templates"])
def update_template(template_id: int, body: TemplateIn, db: Session = Depends(get_db)):
    t = db.get(Template, template_id)
    if t is None:
        raise HTTPException(404, "Template not found")
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    try:
        db.commit()
    except IntegrityError as e:
        raise HTTPException(409, "Another template already has that name.") from e
    db.refresh(t)
    return t


@router.delete("/templates/{template_id}", status_code=204, tags=["templates"])
def delete_template(template_id: int, db: Session = Depends(get_db)):
    t = db.get(Template, template_id)
    if t is None:
        raise HTTPException(404, "Template not found")
    db.delete(t)
    db.commit()


# ---- Attachments --------------------------------------------------------


@router.post("/attachments", response_model=AttachmentOut, status_code=201, tags=["attachments"])
async def upload_attachment(file: UploadFile = File(...), db: Session = Depends(get_db)):
    # Read in pieces and stop as soon as it's too big, so a huge upload can't fill the memory.
    chunks, size = [], 0
    while chunk := await file.read(1024 * 1024):
        size += len(chunk)
        if size > MAX_ATTACHMENT_BYTES:
            raise HTTPException(413, "Attachments must be under 20 MB.")
        chunks.append(chunk)
    data = b"".join(chunks)
    a = Attachment(
        filename=file.filename or "attachment",
        content_type=(
            file.content_type
            if file.content_type and file.content_type != "application/octet-stream"
            else mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
        ),
        size_bytes=len(data),
        data=data,
    )
    db.add(a)
    db.commit()
    return a


# ---- Gmail --------------------------------------------------------------


@router.get("/gmail/status", response_model=GmailStatus, tags=["gmail"])
def gmail_status(db: Session = Depends(get_db)):
    acct = gmail.current_account(db)
    return GmailStatus(
        connected=acct is not None,
        email=acct.email if acct else None,
        credentials_file_present=gmail.credentials_file_present(),
        can_read=gmail.can(acct, gmail.READ_SCOPE),
        can_meet=gmail.can(acct, gmail.CALENDAR_SCOPE),
    )


@router.get("/gmail/connect", tags=["gmail"])
def gmail_connect(next: str = "/compose", db: Session = Depends(get_db)):
    """Browser navigates here; we bounce it to Google's consent screen, then back to `next`."""
    if not gmail.credentials_file_present():
        raise HTTPException(400, "backend/credentials.json is missing. See README for Gmail setup.")
    return RedirectResponse(gmail.start_auth(db, next))


@router.get("/gmail/callback", tags=["gmail"])
def gmail_callback(request: Request, state: str = "", error: str | None = None, db: Session = Depends(get_db)):
    back = settings.frontend_url + gmail.return_path(db, state)
    if error:
        gmail.forget_state(db, state)
        return RedirectResponse(f"{back}?gmail_error={error}")
    try:
        # Rebuilt from the public address: behind the frontend's /api forwarding, request.url is
        # the backend's internal (http) address, which Google's sign-in library rejects.
        gmail.finish_auth(db, state, f"{settings.backend_url}{gmail.REDIRECT_PATH}?{request.url.query}")
    except gmail.MissingSendPermission:
        return RedirectResponse(f"{back}?gmail_error=missing_send_permission")
    except Exception as e:
        return RedirectResponse(f"{back}?gmail_error={type(e).__name__}")
    return RedirectResponse(f"{back}?gmail=connected")


@router.delete("/gmail", status_code=204, tags=["gmail"])
def gmail_disconnect(db: Session = Depends(get_db)):
    for acct in db.scalars(select(GmailAccount)):
        db.delete(acct)
    db.commit()


# ---- Stats --------------------------------------------------------------


@router.get("/stats", response_model=Stats, tags=["stats"])
def stats(db: Session = Depends(get_db)):
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    sent = Email.status == EmailStatus.SENT
    return Stats(
        sent_total=db.scalar(select(func.count()).where(sent)) or 0,
        sent_last_7_days=db.scalar(select(func.count()).where(sent, Email.sent_at >= week_ago)) or 0,
        companies=db.scalar(select(func.count(Company.id))) or 0,
        contacts=db.scalar(select(func.count(Contact.id))) or 0,
        failed_total=db.scalar(select(func.count()).where(Email.status == EmailStatus.FAILED)) or 0,
    )
