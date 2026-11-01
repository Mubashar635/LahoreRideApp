-- 001: core schema for riders, drivers, rides, fares and idempotency.
--
-- Integrity rules that matter for correctness are enforced HERE, in the
-- database, not only in application code. Application checks give friendly
-- errors; these constraints are the last line of defence under concurrency.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TYPE ride_category AS ENUM ('ECONOMY', 'COMFORT');
CREATE TYPE driver_status AS ENUM ('OFFLINE', 'AVAILABLE', 'ON_TRIP');
CREATE TYPE ride_status   AS ENUM ('REQUESTED', 'ACCEPTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE cancel_actor  AS ENUM ('RIDER', 'DRIVER', 'SYSTEM');

-- ---------------------------------------------------------------------------
-- Riders
-- ---------------------------------------------------------------------------
CREATE TABLE riders (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL CHECK (length(trim(name)) > 0),
    phone       text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Drivers and their availability
-- A driver serves exactly one category (the vehicle they drive).
-- Location is a plain lat/lng pair; production would use PostGIS / geo index.
-- ---------------------------------------------------------------------------
CREATE TABLE drivers (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text NOT NULL CHECK (length(trim(name)) > 0),
    phone            text NOT NULL UNIQUE,
    vehicle_plate    text NOT NULL UNIQUE,
    vehicle_model    text NOT NULL,
    category         ride_category NOT NULL,
    status           driver_status NOT NULL DEFAULT 'OFFLINE',
    lat              double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng              double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
    location_updated_at timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Matching scans only available drivers of a category.
CREATE INDEX drivers_available_idx ON drivers (category) WHERE status = 'AVAILABLE';

-- ---------------------------------------------------------------------------
-- Fare rates (per category). Kept in the DB so pricing can change without a
-- deploy; each ride snapshots the rate it was quoted with.
-- All money is stored as integer PKR to avoid floating-point rounding.
-- ---------------------------------------------------------------------------
CREATE TABLE fare_rates (
    category        ride_category PRIMARY KEY,
    base_fare_pkr   integer NOT NULL CHECK (base_fare_pkr >= 0),
    per_km_pkr      integer NOT NULL CHECK (per_km_pkr >= 0),
    per_min_pkr     integer NOT NULL CHECK (per_min_pkr >= 0),
    minimum_fare_pkr integer NOT NULL CHECK (minimum_fare_pkr >= 0),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Rides (requests + current driver assignment + fare)
-- ---------------------------------------------------------------------------
CREATE TABLE rides (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id            uuid NOT NULL REFERENCES riders (id),
    category            ride_category NOT NULL,
    status              ride_status NOT NULL DEFAULT 'REQUESTED',

    pickup_address      text NOT NULL,
    pickup_lat          double precision NOT NULL CHECK (pickup_lat BETWEEN -90 AND 90),
    pickup_lng          double precision NOT NULL CHECK (pickup_lng BETWEEN -180 AND 180),
    dropoff_address     text NOT NULL,
    dropoff_lat         double precision NOT NULL CHECK (dropoff_lat BETWEEN -90 AND 90),
    dropoff_lng         double precision NOT NULL CHECK (dropoff_lng BETWEEN -180 AND 180),

    -- Current assignment. NULL until a driver accepts.
    driver_id           uuid REFERENCES drivers (id),

    -- Fare information (snapshot at request time, final at completion).
    distance_km         numeric(7, 2) NOT NULL CHECK (distance_km >= 0),
    duration_min        integer NOT NULL CHECK (duration_min >= 0),
    estimated_fare_pkr  integer NOT NULL CHECK (estimated_fare_pkr >= 0),
    final_fare_pkr      integer CHECK (final_fare_pkr >= 0),
    pickup_eta_min      integer CHECK (pickup_eta_min >= 0),

    cancelled_by        cancel_actor,
    cancel_reason       text,

    requested_at        timestamptz NOT NULL DEFAULT now(),
    accepted_at         timestamptz,
    completed_at        timestamptz,
    cancelled_at        timestamptz,
    updated_at          timestamptz NOT NULL DEFAULT now(),

    -- Each status implies a consistent shape of the row. This makes it
    -- impossible to persist e.g. an ACCEPTED ride with no driver, or a
    -- COMPLETED ride with no final fare, even if application code has a bug.
    CONSTRAINT rides_status_shape CHECK (
        CASE status
            WHEN 'REQUESTED' THEN driver_id IS NULL AND accepted_at IS NULL
                                  AND completed_at IS NULL AND cancelled_at IS NULL
            WHEN 'ACCEPTED'  THEN driver_id IS NOT NULL AND accepted_at IS NOT NULL
                                  AND completed_at IS NULL AND cancelled_at IS NULL
            WHEN 'COMPLETED' THEN driver_id IS NOT NULL AND accepted_at IS NOT NULL
                                  AND completed_at IS NOT NULL AND final_fare_pkr IS NOT NULL
                                  AND cancelled_at IS NULL
            WHEN 'CANCELLED' THEN cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
                                  AND completed_at IS NULL
        END
    )
);

-- A rider may have at most ONE active ride at a time
-- (blocks duplicate ride requests even if two arrive simultaneously).
CREATE UNIQUE INDEX rides_one_active_per_rider
    ON rides (rider_id) WHERE status IN ('REQUESTED', 'ACCEPTED');

-- A driver may be assigned to at most ONE active ride at a time
-- (blocks one driver being double-booked by concurrent accepts).
CREATE UNIQUE INDEX rides_one_active_per_driver
    ON rides (driver_id) WHERE status = 'ACCEPTED';

CREATE INDEX rides_rider_history_idx ON rides (rider_id, requested_at DESC);

-- ---------------------------------------------------------------------------
-- Ride events: append-only audit log of every state transition / assignment.
-- Gives the assignment history (who accepted, who cancelled, when).
-- ---------------------------------------------------------------------------
CREATE TABLE ride_events (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ride_id      uuid NOT NULL REFERENCES rides (id),
    from_status  ride_status,
    to_status    ride_status NOT NULL,
    driver_id    uuid REFERENCES drivers (id),
    actor        text NOT NULL,
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ride_events_ride_idx ON ride_events (ride_id, id);

-- ---------------------------------------------------------------------------
-- Idempotency keys: lets clients safely retry POST requests.
-- The first request with a key stores its response; a retry with the same key
-- and same body gets the stored response instead of performing the action twice.
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
    scope            text NOT NULL,          -- e.g. 'rider:<id>' or 'ride:<id>:cancel'
    idempotency_key  text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
    request_hash     text NOT NULL,          -- detects key reuse with a different body
    response_status  integer,                -- NULL while the first request is in flight
    response_body    jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, idempotency_key)
);

CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
