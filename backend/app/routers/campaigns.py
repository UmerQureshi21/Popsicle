from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from .. import campaigns as svc
from ..db import get_db
from ..models import Campaign, CampaignStatus, Email, EmailStatus
from ..schemas import (
    AttachmentOut,
    CampaignCounts,
    CampaignDetail,
    CampaignDraft,
    CampaignSummary,
    EmailOut,
    PreviewOut,
)

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


def _counts(db: Session, ids: list[int]) -> dict[int, CampaignCounts]:
    out = {i: CampaignCounts() for i in ids}
    rows = db.execute(
        select(Email.campaign_id, Email.status, func.count())
        .where(Email.campaign_id.in_(ids))
        .group_by(Email.campaign_id, Email.status)
    )
    for cid, status, n in rows:
        setattr(out[cid], status, n)
        out[cid].total += n
    return out


def _summary(c: Campaign, counts: CampaignCounts) -> dict:
    return dict(
        id=c.id, name=c.name, company_id=c.company_id, company_name=c.company.name if c.company else None,
        status=c.status, error=c.error, delay_seconds=c.delay_seconds, created_at=c.created_at,
        started_at=c.started_at, finished_at=c.finished_at, counts=counts,
    )


def _detail(db: Session, campaign_id: int) -> CampaignDetail:
    c = db.scalars(
        select(Campaign)
        .where(Campaign.id == campaign_id)
        .options(selectinload(Campaign.emails), selectinload(Campaign.attachments), selectinload(Campaign.company))
    ).first()
    if c is None:
        raise HTTPException(404, "Campaign not found")
    return CampaignDetail(
        **_summary(c, _counts(db, [c.id])[c.id]),
        subject_template=c.subject_template,
        body_template=c.body_template,
        variables=c.variables,
        attachments=[AttachmentOut.model_validate(a) for a in c.attachments],
        emails=[EmailOut.model_validate(e) for e in c.emails],
    )


@router.post("/preview", response_model=PreviewOut)
def preview(draft: CampaignDraft, db: Session = Depends(get_db)):
    return svc.prepare(db, draft)


@router.post("", response_model=CampaignDetail, status_code=201)
def create(draft: CampaignDraft, db: Session = Depends(get_db)):
    try:
        campaign = svc.create_campaign(db, draft)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    svc.start(campaign.id)
    return _detail(db, campaign.id)


@router.get("", response_model=list[CampaignSummary])
def list_campaigns(company_id: int | None = None, db: Session = Depends(get_db)):
    q = select(Campaign).options(selectinload(Campaign.company)).order_by(Campaign.created_at.desc())
    if company_id is not None:
        q = q.where(Campaign.company_id == company_id)
    items = list(db.scalars(q))
    counts = _counts(db, [c.id for c in items])
    return [CampaignSummary(**_summary(c, counts[c.id])) for c in items]


@router.get("/{campaign_id}", response_model=CampaignDetail)
def get_campaign(campaign_id: int, db: Session = Depends(get_db)):
    return _detail(db, campaign_id)


@router.post("/{campaign_id}/cancel", response_model=CampaignDetail)
def cancel(campaign_id: int, db: Session = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if c is None:
        raise HTTPException(404, "Campaign not found")
    if c.status in (CampaignStatus.QUEUED, CampaignStatus.SENDING, CampaignStatus.INTERRUPTED, CampaignStatus.WAITING):
        svc.request_cancel(db, c)
    return _detail(db, campaign_id)


@router.post("/{campaign_id}/resume", response_model=CampaignDetail)
def resume(campaign_id: int, retry_failed: bool = False, db: Session = Depends(get_db)):
    """Continue an interrupted campaign; with retry_failed, also re-send the ones that failed."""
    c = db.get(Campaign, campaign_id)
    if c is None:
        raise HTTPException(404, "Campaign not found")
    if svc.is_running(campaign_id):
        raise HTTPException(409, "This campaign is already sending.")
    if retry_failed:
        db.execute(
            update(Email)
            .where(Email.campaign_id == campaign_id, Email.status == EmailStatus.FAILED)
            .values(status=EmailStatus.PENDING, error=None)
        )
    if c.status == CampaignStatus.CANCELLED:
        db.execute(
            update(Email)
            .where(Email.campaign_id == campaign_id, Email.status == EmailStatus.CANCELLED)
            .values(status=EmailStatus.PENDING)
        )
    c.status = CampaignStatus.QUEUED
    c.finished_at = None
    db.commit()
    svc.start(campaign_id)
    return _detail(db, campaign_id)


@router.delete("/{campaign_id}", status_code=204)
def delete_campaign(campaign_id: int, db: Session = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if c is None:
        raise HTTPException(404, "Campaign not found")
    if svc.is_running(campaign_id):
        raise HTTPException(409, "Cancel the campaign before deleting it.")
    db.delete(c)
    db.commit()
