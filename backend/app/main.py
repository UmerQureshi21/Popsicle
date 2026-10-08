import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import from_proxy, require_user
from . import migrations
from .campaigns import mark_interrupted_on_startup, resume_on_startup, start_sweeper
from .config import settings
from .db import engine
from .models import Base
from .routers import auth as auth_routes
from .routers import bookings, campaigns, conversations, misc, people, people_search, sending_limits

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


@app.middleware("http")
async def only_through_the_frontend(request: Request, call_next):
    """Deployed, the backend's own address is public too. Every call must come through the
    frontend's forwarding (which adds the shared secret), so nobody can reach the API directly,
    or fake their address to get around the login limits."""
    if settings.is_local or request.url.path == "/api/health" or from_proxy(request):
        return await call_next(request)
    return JSONResponse({"detail": "Use Popsicle through its website."}, status_code=403)


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def same_site_only(request: Request, call_next):
    """Changes can only be made from Popsicle's own pages. Browsers say which site a request
    comes from (Origin); one from any other website is refused, on top of the session cookie
    already not being sent to other sites."""
    origin = request.headers.get("origin")
    if request.method in UNSAFE_METHODS and origin and origin.rstrip("/") != settings.frontend_url.rstrip("/"):
        return JSONResponse({"detail": "Requests from other websites aren't allowed."}, status_code=403)
    return await call_next(request)


app.include_router(auth_routes.router)
# The booking page: open to the person you emailed, without logging in (see app/bookings.py).
app.include_router(bookings.public)
# Everything else needs a session when AUTH_REQUIRED is on (see app/auth.py).
protected = [Depends(require_user)]
app.include_router(campaigns.router, dependencies=protected)
app.include_router(people.router, dependencies=protected)
app.include_router(misc.router, dependencies=protected)
app.include_router(people_search.router, dependencies=protected)
app.include_router(sending_limits.router, dependencies=protected)
app.include_router(conversations.router, dependencies=protected)
app.include_router(bookings.router, dependencies=protected)


@app.get("/api/health")
def health():
    return {"ok": True}
