import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .campaigns import mark_interrupted_on_startup
from .config import settings
from .db import engine
from .models import Base
from .routers import campaigns, misc, people, people_search

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Fine while the schema is young; switch to Alembic once there's data worth migrating.
    Base.metadata.create_all(engine)
    mark_interrupted_on_startup()
    yield


app = FastAPI(title="Popsicle", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(campaigns.router)
app.include_router(people.router)
app.include_router(misc.router)
app.include_router(people_search.router)


@app.get("/api/health")
def health():
    return {"ok": True}
