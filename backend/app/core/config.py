"""Application configuration loaded from environment variables."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- App ---
    app_name: str = "AgroConnect API"
    api_v1_prefix: str = "/api"
    debug: bool = True

    # --- CORS ---
    # Comma-separated list of allowed origins for the dev frontend.
    # Include both ports 5173 and 5174 since Vite may use different ports.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"

    # --- Database ---
    # Default to a local SQLite file for prototype / dev work. Production
    # (Postgres) is wired via the same SQLAlchemy URL pattern.
    database_url: str = "sqlite:///./agroconnect.db"

    # --- Market Price provider (Phase 3) ---
    # The provider name to use for live market data. Either "data_gov_in"
    # (real, requires DATA_GOV_IN_API_KEY) or "demo" (built-in seed data).
    market_price_provider: str = "data_gov_in"

    # The data.gov.in resource UUID for "Daily Price of Various Commodities
    # from Various Markets (Mandi)". Set to empty string to use the live
    # default if known; otherwise hard-coded default below.
    data_gov_in_resource_id: str = "9ef84268-d588-465a-a308-a864a43d0070"

    # The API key for data.gov.in. Register for a free key at
    # https://data.gov.in/ and set the env var. The key NEVER leaves the
    # backend — it is only used server-side when proxying the request.
    data_gov_in_api_key: str = ""

    # If True, the market-price service will fall back to the demo
    # provider when the live provider errors out. If False, errors
    # propagate to the client as a 503.
    market_price_demo_fallback: bool = True

    # Network timeout (seconds) for live provider HTTP calls.
    market_price_timeout_seconds: float = 8.0

    # --- Logistics (Phase 4) ---
    # All values have safe defaults so the API is usable out of the box.
    # None of these are live data — they are clearly-labelled ESTIMATES.
    logistics_transport_rate_per_km_per_kg: float = 0.0015
    logistics_min_transport: float = 300.0
    logistics_loading_per_kg: float = 0.05
    logistics_unloading_per_kg: float = 0.05
    logistics_other_charges_pct: float = 0.02
    logistics_avg_speed_kmph: float = 40.0
    logistics_default_vehicle: str = "mini-truck"

    # Optional live routing — leave empty to keep the haversine estimate.
    maps_api_key: str = ""
    routing_api_key: str = ""
    routing_url: str = "https://router.project-osrm.org/route/v1/driving/"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
