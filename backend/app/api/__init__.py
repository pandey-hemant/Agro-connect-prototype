"""API routers — composed into a single ``api_router`` for the app.

The health check is mounted directly on the app in ``main.py``; everything
else is added here under ``/api``.
"""
from fastapi import APIRouter

from app.api import buyers, crop_lots, decisions, deals, fpos, logistics, market_prices, offers, quality

api_router = APIRouter()
api_router.include_router(crop_lots.router, tags=["crop-lots"])
api_router.include_router(market_prices.router, tags=["market-prices"])
api_router.include_router(logistics.router, tags=["logistics"])
api_router.include_router(decisions.router, tags=["decisions"])
api_router.include_router(buyers.router, tags=["buyers"])
api_router.include_router(offers.router, tags=["offers"])
api_router.include_router(fpos.router, tags=["fpos"])
api_router.include_router(quality.router, tags=["quality"])
api_router.include_router(deals.router, tags=["deals"])
