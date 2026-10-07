import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import require_user
from . import migrations
from .campaigns import mark_interrupted_on_startup, resume_on_startup, start_sweeper
from .config import settings
from .db import engine
from .models import Base
from .routers import auth as auth_routes
from .routers import campaigns, conversations, misc, people, people_search, sending_limits

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Fine while the schema is young; switch to Alembic once there's data worth migrating.
    Base.metadata.create_all(engine)
    migrations.run(engine)
    mark_interrupted_on_startup()
    resume_on_startup()
    start_sweeper()
    yield


def docs_urls(local: bool) -> dict:
    """The interactive API docs list every endpoint, so they're only offered locally."""
    if local:
        return {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}
    return {"docs_url": None, "redoc_url": None, "openapi_url": None}


app = FastAPI(title="Popsicle", lifespan=lifespan, **docs_urls(settings.is_local))
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,  # the session cookie
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_routes.router)
# Everything else needs a session when AUTH_REQUIRED is on (see app/auth.py).
protected = [Depends(require_user)]
app.include_router(campaigns.router, dependencies=protected)
app.include_router(people.router, dependencies=protected)
app.include_router(misc.router, dependencies=protected)
app.include_router(people_search.router, dependencies=protected)
app.include_router(sending_limits.router, dependencies=protected)
app.include_router(conversations.router, dependencies=protected)


@app.get("/api/health")
def health():
    return {"ok": True}
