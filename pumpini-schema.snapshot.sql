-- ─────────────────────────────────────────────────────────────────────────────
--  pumpini-schema.snapshot.sql — AUTHORITATIVE current PRODUCTION schema
--
--  A faithful `pg_dump --schema-only --no-owner --schema=public` snapshot of the
--  LIVE production database, captured 2026-06-28. Source of truth for what the
--  schema ACTUALLY is in prod: all 60 tables, RLS policies, functions, triggers,
--  and grants.
--
--  WHY THIS EXISTS — the hand-maintained `pumpini-schema.sql` had drifted badly
--  (only 23 of 60 tables; missing plans, permission_modules, role_templates,
--  template_permissions, user_role_assignments, station_subscriptions,
--  gst_invoices, products, superadmins, user_passkeys, …  — all added in prod via
--  manual SQL that was never committed). That repo↔prod drift is the #1 prod-break
--  risk called out in CLAUDE.md. This snapshot closes it.
--
--  HOW TO USE
--    • Reading: to know what a column/table/constraint really is in prod, look HERE.
--    • Rebuilding staging from scratch: load this first, then follow STAGING.md
--      for the post-clone grant (GRANT app_authenticated TO postgres) and the
--      data-load trigger/self-FK steps.
--    • DO NOT run blindly against prod — prod already has this. Prod schema changes
--      remain manual & deliberate (CLAUDE.md deploy-ordering rule).
--
--  REFRESH: re-run the pg_dump above and replace everything below this header.
-- ─────────────────────────────────────────────────────────────────────────────

--
-- PostgreSQL database dump
--

\restrict vmMUXLo5BvpAQMojladFOjd67okJwBQ3KUAtpW6PAaWuLHDIe54tchD4Wb6zjXO

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: app_current_corporate_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_current_corporate_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select nullif(current_setting('app.corporate_id', true), '')::uuid
$$;


--
-- Name: app_current_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_current_user_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;


--
-- Name: app_is_superadmin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_is_superadmin() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select coalesce(current_setting('app.is_superadmin', true) = 'true', false)
$$;


--
-- Name: calib_tolerance(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calib_tolerance(p_chart uuid, p_dip numeric) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  SELECT ROUND((
      2 * sqrt(GREATEST(0, 2*(c.diameter_cm/2)*p_dip - p_dip*p_dip))
      * c.length_cm / 1000 / 10)::numeric, 2)
  FROM tank_calibration_charts c WHERE c.id = p_chart;
$$;


--
-- Name: calib_volume(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calib_volume(p_chart uuid, p_dip numeric) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE
    WHEN p_dip <= 0 THEN 0
    WHEN p_dip >= c.diameter_cm
      THEN ROUND((pi() * power(c.diameter_cm/2, 2) * c.length_cm / 1000)::numeric, 2)
    ELSE ROUND((
        power(c.diameter_cm/2, 2) * acos((c.diameter_cm/2 - p_dip) / (c.diameter_cm/2))
        - (c.diameter_cm/2 - p_dip) * sqrt(2*(c.diameter_cm/2)*p_dip - p_dip*p_dip)
      )::numeric * c.length_cm / 1000, 2)
  END
  FROM tank_calibration_charts c WHERE c.id = p_chart;
$$;


--
-- Name: detect_corporate_duplicates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_corporate_duplicates() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.gst_number IS NOT NULL AND NEW.gst_number != '' THEN
    INSERT INTO corporate_duplicate_flags(corp1_id, corp2_id, match_type, match_score)
    SELECT NEW.id, ca.id, 'gstn', 100
    FROM corporate_accounts ca
    WHERE ca.id != NEW.id
      AND ca.gst_number = NEW.gst_number
      AND ca.merged_into_id IS NULL
    ON CONFLICT(corp1_id, corp2_id) DO NOTHING;
  END IF;
  IF NEW.contact_phone IS NOT NULL THEN
    INSERT INTO corporate_duplicate_flags(corp1_id, corp2_id, match_type, match_score)
    SELECT NEW.id, ca.id, 'phone', 90
    FROM corporate_accounts ca
    WHERE ca.id != NEW.id
      AND ca.contact_phone = NEW.contact_phone
      AND ca.merged_into_id IS NULL
    ON CONFLICT(corp1_id, corp2_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: increase_tank_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increase_tank_stock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE tanks
  SET current_stock = current_stock + COALESCE(NEW.net_volume_ltrs, NEW.gross_volume_ltrs)
  WHERE id = NEW.tank_id;
  RETURN NEW;
END;
$$;


--
-- Name: mark_transactions_invoiced(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_transactions_invoiced() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.line_items IS NOT NULL THEN
    UPDATE dispense_events
    SET is_invoiced = TRUE, invoice_id = NEW.id
    WHERE id IN (
      SELECT (item->>'id')::UUID
      FROM jsonb_array_elements(NEW.line_items) AS item
    );
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: my_corporates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_corporates() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select ca.id from corporate_accounts ca
   where ca.created_by_station in (select my_stations())
      or exists (select 1 from corporate_station_links csl
                  where csl.corporate_id = ca.id
                    and csl.station_id in (select my_stations()))
  union
  select app_current_corporate_id() where app_current_corporate_id() is not null
$$;


--
-- Name: my_owner_groups(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_owner_groups() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select group_id from owner_group_members where user_id = app_current_user_id()
$$;


--
-- Name: my_stations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_stations() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select station_id from station_users where user_id = app_current_user_id()
  union
  select sgm.station_id
    from owner_group_members ogm
    join station_groups        stg on stg.owner_group_id   = ogm.group_id
    join station_group_members sgm on sgm.station_group_id = stg.id
   where ogm.user_id = app_current_user_id()
$$;


--
-- Name: reduce_tank_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reduce_tank_stock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE tanks t
  SET current_stock = GREATEST(0, current_stock - NEW.quantity_ltrs)
  FROM nozzles n
  WHERE n.id = NEW.nozzle_id AND n.tank_id = t.id;
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alert_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_definitions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    alert_type character varying(50) NOT NULL,
    severity character varying(10) DEFAULT 'warning'::character varying,
    whatsapp_enabled boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT alert_definitions_severity_check CHECK (((severity)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'critical'::character varying])::text[])))
);


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    alert_type character varying(50) NOT NULL,
    severity character varying(10) DEFAULT 'warning'::character varying,
    message text NOT NULL,
    recipient_ids uuid[],
    channels character varying(20)[],
    sent_at timestamp with time zone DEFAULT now(),
    acknowledged_at timestamp with time zone,
    CONSTRAINT alerts_severity_check CHECK (((severity)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'critical'::character varying])::text[])))
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    station_id uuid,
    date date NOT NULL,
    check_in timestamp with time zone,
    check_out timestamp with time zone,
    shift_number smallint,
    status character varying(20) DEFAULT 'present'::character varying,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT attendance_status_check CHECK (((status)::text = ANY ((ARRAY['present'::character varying, 'absent'::character varying, 'half_day'::character varying, 'leave'::character varying])::text[])))
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    action character varying(80) NOT NULL,
    entity character varying(80),
    entity_id uuid,
    old_data jsonb,
    new_data jsonb,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: cash_denominations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_denominations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    shift_id uuid,
    attendant_id uuid,
    note_500 integer DEFAULT 0,
    note_200 integer DEFAULT 0,
    note_100 integer DEFAULT 0,
    note_50 integer DEFAULT 0,
    note_20 integer DEFAULT 0,
    note_10 integer DEFAULT 0,
    note_5 integer DEFAULT 0,
    note_2 integer DEFAULT 0,
    note_1 integer DEFAULT 0,
    total_cash numeric(12,2) GENERATED ALWAYS AS ((((((((((note_500 * 500) + (note_200 * 200)) + (note_100 * 100)) + (note_50 * 50)) + (note_20 * 20)) + (note_10 * 10)) + (note_5 * 5)) + (note_2 * 2)) + (note_1 * 1))) STORED,
    recorded_at timestamp with time zone DEFAULT now()
);


--
-- Name: cash_deposits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_deposits (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    deposit_date date DEFAULT CURRENT_DATE NOT NULL,
    bank_account character varying(80),
    reference_no character varying(80),
    notes text,
    deposited_by uuid,
    confirmed boolean DEFAULT false,
    confirmed_by uuid,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT cash_deposits_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: corporate_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_accounts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_name character varying(120) NOT NULL,
    gst_number character varying(20),
    contact_person character varying(80),
    contact_phone character varying(15),
    contact_email character varying(120),
    credit_limit numeric(12,2) DEFAULT 0,
    current_outstanding numeric(12,2) DEFAULT 0,
    billing_cycle character varying(10) DEFAULT 'monthly'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    merged_into_id uuid,
    gstn character varying(20),
    pan character varying(15),
    address text,
    email character varying(120),
    created_by_station uuid
);


--
-- Name: corporate_drivers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_drivers (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    corporate_id uuid,
    name character varying(120) NOT NULL,
    phone character varying(15),
    vehicle_number character varying(20),
    fasttag_id character varying(50),
    biometric_ref text,
    per_fill_limit numeric(10,2),
    is_active boolean DEFAULT true,
    enrolled_at timestamp with time zone DEFAULT now()
);


--
-- Name: corporate_duplicate_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_duplicate_flags (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    corp1_id uuid,
    corp2_id uuid,
    match_type character varying(20),
    match_score integer DEFAULT 100,
    status character varying(20) DEFAULT 'pending'::character varying,
    flagged_at timestamp with time zone DEFAULT now(),
    resolved_by uuid,
    resolved_at timestamp with time zone,
    CONSTRAINT corporate_duplicate_flags_match_type_check CHECK (((match_type)::text = ANY ((ARRAY['gstn'::character varying, 'phone'::character varying, 'name_similar'::character varying])::text[]))),
    CONSTRAINT corporate_duplicate_flags_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'merged'::character varying, 'dismissed'::character varying])::text[])))
);


--
-- Name: corporate_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_receipts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    corporate_id uuid NOT NULL,
    station_id uuid NOT NULL,
    receipt_date date DEFAULT CURRENT_DATE NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_type character varying(20) NOT NULL,
    reference_no character varying(80),
    invoice_id uuid,
    remarks text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT corporate_receipts_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT corporate_receipts_payment_type_check CHECK (((payment_type)::text = ANY ((ARRAY['cash'::character varying, 'cheque'::character varying, 'rtgs'::character varying, 'upi'::character varying, 'credit_note'::character varying])::text[])))
);


--
-- Name: corporate_station_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_station_links (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    corporate_id uuid NOT NULL,
    station_id uuid NOT NULL,
    credit_limit numeric(12,2) DEFAULT 0 NOT NULL,
    payment_terms integer DEFAULT 30,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: dispense_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispense_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    shift_id uuid,
    event_seq bigint NOT NULL,
    rfid_tag_id uuid,
    nozzle_id uuid,
    attendant_id uuid,
    fuel_type character varying(20),
    quantity_ltrs numeric(10,3) NOT NULL,
    rate_per_ltr numeric(8,2) NOT NULL,
    amount numeric(12,2) GENERATED ALWAYS AS ((quantity_ltrs * rate_per_ltr)) STORED,
    payment_mode character varying(20),
    upi_ref character varying(80),
    vehicle_number character varying(20),
    photo_url text,
    latitude numeric(10,7),
    longitude numeric(10,7),
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    synced_at timestamp with time zone DEFAULT now(),
    invoice_id uuid,
    is_invoiced boolean DEFAULT false,
    corporate_id uuid,
    source character varying(12) DEFAULT 'pos'::character varying,
    is_voided boolean DEFAULT false,
    voided_by uuid,
    voided_at timestamp with time zone,
    void_reason text,
    CONSTRAINT dispense_events_fuel_type_check CHECK (((fuel_type)::text = ANY ((ARRAY['petrol'::character varying, 'diesel'::character varying, 'cng'::character varying, 'premium_petrol'::character varying, 'lubes'::character varying])::text[]))),
    CONSTRAINT dispense_events_payment_mode_check CHECK (((payment_mode)::text = ANY ((ARRAY['cash'::character varying, 'upi'::character varying, 'credit'::character varying, 'card'::character varying])::text[])))
);


--
-- Name: corporate_station_balance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.corporate_station_balance AS
 SELECT csl.id AS link_id,
    csl.corporate_id,
    csl.station_id,
    ca.company_name,
    ca.contact_person,
    ca.contact_phone,
    ca.gst_number,
    ca.email,
    ca.gstn,
    ca.is_active AS corp_active,
    ca.merged_into_id,
    csl.credit_limit,
    csl.payment_terms,
    csl.is_active,
    COALESCE(( SELECT sum(de.amount) AS sum
           FROM public.dispense_events de
          WHERE ((de.corporate_id = csl.corporate_id) AND (de.station_id = csl.station_id) AND ((de.payment_mode)::text = 'credit'::text) AND ((de.is_invoiced IS NULL) OR (de.is_invoiced = false)))), (0)::numeric) AS current_outstanding,
    (csl.credit_limit - COALESCE(( SELECT sum(de.amount) AS sum
           FROM public.dispense_events de
          WHERE ((de.corporate_id = csl.corporate_id) AND (de.station_id = csl.station_id) AND ((de.payment_mode)::text = 'credit'::text) AND ((de.is_invoiced IS NULL) OR (de.is_invoiced = false)))), (0)::numeric)) AS available_credit
   FROM (public.corporate_station_links csl
     JOIN public.corporate_accounts ca ON ((ca.id = csl.corporate_id)))
  WHERE (ca.merged_into_id IS NULL);


--
-- Name: corporate_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_transactions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    dispense_event_id uuid,
    corporate_id uuid,
    driver_id uuid,
    amount numeric(12,2),
    credit_before numeric(12,2),
    credit_after numeric(12,2),
    plate_photo_url text,
    fasttag_read character varying(50),
    verified_at timestamp with time zone DEFAULT now()
);


--
-- Name: credit_suspense_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_suspense_entries (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid NOT NULL,
    direction character varying(3) NOT NULL,
    amount numeric(12,2) NOT NULL,
    shift_id uuid,
    attendant_id uuid,
    corporate_id uuid,
    description text,
    reference_type character varying(40),
    reference_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT credit_suspense_entries_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT credit_suspense_entries_direction_check CHECK (((direction)::text = ANY ((ARRAY['in'::character varying, 'out'::character varying])::text[])))
);


--
-- Name: delivery_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_invoices (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    file_base64 text NOT NULL,
    media_type character varying(40) NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: dipstick_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dipstick_readings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    tank_id uuid,
    shift_id uuid,
    reading_type character varying(20),
    dip_cm numeric(8,2),
    volume_ltrs numeric(10,2),
    density numeric(8,4),
    temperature_c numeric(5,2),
    recorded_by uuid,
    recorded_at timestamp with time zone DEFAULT now(),
    CONSTRAINT dipstick_readings_reading_type_check CHECK (((reading_type)::text = ANY ((ARRAY['opening'::character varying, 'mid_shift'::character varying, 'closing'::character varying])::text[])))
);


--
-- Name: dispense_events_event_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dispense_events_event_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dispense_events_event_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dispense_events_event_seq_seq OWNED BY public.dispense_events.event_seq;


--
-- Name: fuel_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fuel_deliveries (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    tank_id uuid,
    shift_id uuid,
    dc_number character varying(50),
    dc_date date,
    received_at timestamp with time zone DEFAULT now(),
    fuel_type character varying(20) NOT NULL,
    oil_company character varying(30),
    depot_name character varying(100),
    tanker_number character varying(20),
    compartment_no character varying(10),
    gross_volume_ltrs numeric(10,2) NOT NULL,
    temperature_c numeric(5,2),
    density numeric(8,4),
    net_volume_ltrs numeric(10,2) GENERATED ALWAYS AS (
CASE
    WHEN ((temperature_c IS NOT NULL) AND (density IS NOT NULL)) THEN round(((gross_volume_ltrs * density) * ((1)::numeric - (0.00090 * (temperature_c - (15)::numeric)))), 2)
    ELSE gross_volume_ltrs
END) STORED,
    batch_number character varying(50),
    seal_number character varying(50),
    rate_per_ltr numeric(8,2),
    freight numeric(10,2) DEFAULT 0,
    total_value numeric(12,2),
    challan_photo_url text,
    received_by uuid,
    verified_by uuid,
    verified_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    invoice_id uuid
);


--
-- Name: fuel_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fuel_prices (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    fuel_type character varying(20) NOT NULL,
    price numeric(8,2) NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    set_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: gst_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gst_invoices (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    corporate_id uuid,
    invoice_number character varying(50) NOT NULL,
    invoice_date date NOT NULL,
    period_from date,
    period_to date,
    subtotal numeric(12,2),
    cgst_rate numeric(5,2) DEFAULT 9,
    sgst_rate numeric(5,2) DEFAULT 9,
    cgst_amount numeric(12,2),
    sgst_amount numeric(12,2),
    total_amount numeric(12,2),
    status character varying(20) DEFAULT 'draft'::character varying,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    line_items jsonb,
    amount_received numeric DEFAULT 0,
    CONSTRAINT gst_invoices_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'paid'::character varying])::text[])))
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    station_name text,
    city text,
    phone text NOT NULL,
    email text,
    message text,
    source text DEFAULT 'website'::text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    state character varying(60)
);


--
-- Name: meter_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meter_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shift_id uuid,
    nozzle_id uuid,
    image_base64 text,
    media_type text,
    ocr_reading text,
    ocr_legible boolean,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: nozzles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nozzles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    tank_id uuid,
    nozzle_number character varying(8) NOT NULL,
    fuel_type character varying(20) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: owner_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owner_group_members (
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(20) DEFAULT 'member'::character varying,
    joined_at timestamp with time zone DEFAULT now(),
    CONSTRAINT owner_group_members_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'member'::character varying])::text[])))
);


--
-- Name: owner_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owner_groups (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    logo_url text,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: permission_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_modules (
    code character varying(50) NOT NULL,
    label character varying(100) NOT NULL,
    description text,
    category character varying(50)
);


--
-- Name: petty_cash_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.petty_cash_entries (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid NOT NULL,
    direction character varying(3) NOT NULL,
    amount numeric(12,2) NOT NULL,
    entry_type character varying(20) DEFAULT 'expense'::character varying NOT NULL,
    description text,
    reference_type character varying(40),
    reference_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT petty_cash_entries_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT petty_cash_entries_direction_check CHECK (((direction)::text = ANY ((ARRAY['in'::character varying, 'out'::character varying])::text[])))
);


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(20) NOT NULL,
    price_per_month numeric(10,2) DEFAULT 0 NOT NULL,
    features jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT plans_name_check CHECK (((name)::text = ANY ((ARRAY['starter'::character varying, 'pro'::character varying, 'enterprise'::character varying])::text[])))
);


--
-- Name: platform_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_audit (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    admin_id uuid,
    action character varying(80),
    entity character varying(80),
    entity_id uuid,
    details jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_cn_seq; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_cn_seq (
    station_id uuid NOT NULL,
    last_seq integer DEFAULT 0 NOT NULL
);


--
-- Name: product_credit_note_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_credit_note_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    credit_note_id uuid NOT NULL,
    invoice_item_id uuid,
    product_id uuid,
    product_name text,
    hsn_code text,
    unit text,
    quantity numeric(12,3) NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    gst_rate numeric(5,2) DEFAULT 18 NOT NULL,
    taxable_amount numeric(12,2) NOT NULL,
    cgst_amount numeric(12,2) NOT NULL,
    sgst_amount numeric(12,2) NOT NULL,
    total_amount numeric(12,2) NOT NULL
);


--
-- Name: product_credit_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_credit_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    station_id uuid NOT NULL,
    cn_number text NOT NULL,
    customer_type text DEFAULT 'cash'::text NOT NULL,
    customer_id uuid,
    customer_name text,
    original_invoice_id uuid,
    original_invoice_number text,
    reason text,
    subtotal numeric(12,2) DEFAULT 0 NOT NULL,
    total_cgst numeric(12,2) DEFAULT 0 NOT NULL,
    total_sgst numeric(12,2) DEFAULT 0 NOT NULL,
    grand_total numeric(12,2) DEFAULT 0 NOT NULL,
    settlement text DEFAULT 'petty_cash'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_invoice_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    invoice_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_name character varying(200) NOT NULL,
    hsn_code character varying(20),
    unit character varying(20),
    quantity numeric(10,3) NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    gst_rate numeric(5,2) DEFAULT 18.00,
    taxable_amount numeric(10,2) NOT NULL,
    cgst_amount numeric(10,2) DEFAULT 0,
    sgst_amount numeric(10,2) DEFAULT 0,
    igst_amount numeric(10,2) DEFAULT 0,
    total_amount numeric(10,2) NOT NULL
);


--
-- Name: product_invoice_seq; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_invoice_seq (
    station_id uuid NOT NULL,
    last_seq integer DEFAULT 0
);


--
-- Name: product_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_invoices (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid NOT NULL,
    invoice_number character varying(50) NOT NULL,
    invoice_date date DEFAULT CURRENT_DATE,
    customer_type character varying(20) DEFAULT 'cash'::character varying,
    customer_id uuid,
    customer_name character varying(200),
    customer_gstn character varying(20),
    payment_mode character varying(20) DEFAULT 'cash'::character varying,
    subtotal numeric(10,2) DEFAULT 0,
    total_cgst numeric(10,2) DEFAULT 0,
    total_sgst numeric(10,2) DEFAULT 0,
    total_igst numeric(10,2) DEFAULT 0,
    grand_total numeric(10,2) DEFAULT 0,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    shift_id uuid,
    attendant_id uuid,
    location character varying(8) DEFAULT 'shop'::character varying
);


--
-- Name: product_stock_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_stock_receipts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(10,3) NOT NULL,
    buying_price numeric(10,2),
    selling_price numeric(10,2),
    notes text,
    received_by uuid,
    received_at timestamp with time zone DEFAULT now(),
    location character varying(8) DEFAULT 'shop'::character varying
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    brand character varying(100),
    barcode character varying(100),
    hsn_code character varying(20),
    unit character varying(20) DEFAULT 'piece'::character varying,
    selling_price numeric(10,2) DEFAULT 0 NOT NULL,
    buying_price numeric(10,2) DEFAULT 0,
    gst_rate numeric(5,2) DEFAULT 18.00,
    current_stock numeric(10,3) DEFAULT 0,
    min_stock_level numeric(10,3) DEFAULT 5,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    require_barcode boolean DEFAULT false NOT NULL,
    bay_stock numeric(12,3) DEFAULT 0,
    shop_stock numeric(12,3) DEFAULT 0
);


--
-- Name: rfid_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rfid_tags (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    tag_uid character varying(64) NOT NULL,
    station_id uuid,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: role_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_templates (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    name character varying(80) NOT NULL,
    description text,
    is_system boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: shift_attendant_nozzles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_attendant_nozzles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    shift_id uuid,
    attendant_id uuid,
    nozzle_id uuid,
    opening_reading numeric(12,3) DEFAULT 0,
    closing_reading numeric(12,3),
    assigned_at timestamp with time zone DEFAULT now()
);


--
-- Name: shift_attendants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_attendants (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    shift_id uuid,
    attendant_id uuid,
    rfid_tag_id uuid,
    nozzle_id uuid,
    bank_account character varying(30),
    upi_vpa character varying(100),
    opening_reading numeric(12,3) DEFAULT 0,
    closing_reading numeric(12,3),
    assigned_at timestamp with time zone DEFAULT now(),
    opening_cash numeric(12,2) DEFAULT 0,
    qr_code_url text,
    closing_cash numeric(12,2),
    bank_statement_url text,
    shift_ended_at timestamp with time zone,
    shift_ended_by uuid
);


--
-- Name: shift_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_definitions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    shift_number smallint NOT NULL,
    name character varying(50) DEFAULT ''::character varying NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    CONSTRAINT shift_definitions_shift_number_check CHECK ((shift_number = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: shift_nozzle_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_nozzle_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shift_id uuid NOT NULL,
    nozzle_id uuid,
    closing_reading numeric,
    recorded_by uuid,
    recorded_at timestamp with time zone DEFAULT now(),
    opening_reading numeric,
    opening_mgr numeric,
    opening_pos numeric,
    closing_mgr numeric,
    closing_pos numeric
);


--
-- Name: shift_reconciliation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_reconciliation (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    shift_id uuid,
    attendant_id uuid,
    total_sales numeric(12,2),
    cash_expected numeric(12,2),
    cash_actual numeric(12,2),
    upi_total numeric(12,2),
    credit_total numeric(12,2),
    card_total numeric(12,2),
    variance numeric(12,2) GENERATED ALWAYS AS ((cash_actual - cash_expected)) STORED,
    alert_sent boolean DEFAULT false,
    remarks text,
    reconciled_at timestamp with time zone DEFAULT now(),
    dispute_type character varying(20),
    dispute_amount numeric(12,2),
    dispute_notes text,
    denomination_id uuid,
    manager_confirmed boolean DEFAULT false,
    manager_id uuid,
    confirmed_at timestamp with time zone,
    mode character varying(10) DEFAULT 'pos'::character varying,
    resolution character varying(20),
    resolution_amount numeric(12,2) DEFAULT 0,
    operator_ack boolean DEFAULT false,
    test_ltrs numeric(12,3) DEFAULT 0,
    price_per_ltr numeric(10,2) DEFAULT 0,
    petty_cash numeric(12,2) DEFAULT 0,
    CONSTRAINT shift_reconciliation_dispute_type_check CHECK (((dispute_type)::text = ANY ((ARRAY['cash_collected'::character varying, 'salary_deduction'::character varying, 'waived'::character varying])::text[])))
);


--
-- Name: shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shifts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    shift_number smallint NOT NULL,
    date date NOT NULL,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    status character varying(20) DEFAULT 'open'::character varying,
    manager_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT shifts_shift_number_check CHECK ((shift_number = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT shifts_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'closed'::character varying, 'reconciled'::character varying])::text[])))
);


--
-- Name: station_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.station_group_members (
    station_group_id uuid NOT NULL,
    station_id uuid NOT NULL
);


--
-- Name: station_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.station_groups (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    owner_group_id uuid,
    name character varying(120) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: station_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.station_settings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    gstn character varying(20),
    pan character varying(15),
    tan character varying(15),
    address text,
    city character varying(80),
    state character varying(80),
    pincode character varying(10),
    owner_whatsapp character varying(15),
    owner_email character varying(120),
    language character varying(10) DEFAULT 'en'::character varying,
    variance_threshold numeric(10,2) DEFAULT 50,
    invoice_prefix character varying(20) DEFAULT 'INV'::character varying,
    invoice_seq integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    latitude numeric(10,7),
    longitude numeric(10,7),
    geo_fence_radius integer DEFAULT 500,
    geo_fence_enabled boolean DEFAULT false,
    products_enabled boolean DEFAULT false,
    return_policy_days integer DEFAULT 30 NOT NULL,
    manager_blind_drop boolean DEFAULT false,
    stock_tol_pct_petrol numeric(5,3) DEFAULT 0.75,
    stock_tol_pct_diesel numeric(5,3) DEFAULT 0.50,
    stock_tol_floor_ltrs numeric(8,2) DEFAULT 20,
    deposit_alert_days integer DEFAULT 2,
    deposit_alert_amount numeric(12,2) DEFAULT 0,
    tally_company_name character varying(150)
);


--
-- Name: station_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.station_subscriptions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid NOT NULL,
    plan character varying(20) DEFAULT 'pro'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    end_date date,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT station_subscriptions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: station_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.station_users (
    station_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: stations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(120) NOT NULL,
    address text,
    gst_number character varying(20),
    oil_company character varying(50),
    city character varying(80),
    state character varying(80),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    owner_group_id uuid,
    plan character varying(20) DEFAULT 'trial'::character varying,
    status character varying(20) DEFAULT 'active'::character varying,
    trial_ends_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
    billing_email character varying(120),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT subscriptions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: superadmins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.superadmins (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(120) NOT NULL,
    email character varying(120) NOT NULL,
    phone character varying(15) NOT NULL,
    password_hash text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tally_ledger_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tally_ledger_map (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid NOT NULL,
    touchpoint_key character varying(40) NOT NULL,
    ledger_name character varying(120),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: tanks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tanks (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid,
    tank_number smallint NOT NULL,
    fuel_type character varying(20) NOT NULL,
    capacity_ltrs numeric(10,2),
    current_stock numeric(10,2) DEFAULT 0,
    density numeric(8,4),
    created_at timestamp with time zone DEFAULT now(),
    calibration_chart_id uuid
);


--
-- Name: tank_book_stock; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.tank_book_stock AS
 SELECT t.id AS tank_id,
    t.station_id,
    t.tank_number,
    t.fuel_type,
    t.capacity_ltrs,
    sh.id AS shift_id,
    sh.shift_number,
    sh.date AS shift_date,
    COALESCE(( SELECT dr.volume_ltrs
           FROM public.dipstick_readings dr
          WHERE ((dr.tank_id = t.id) AND (dr.shift_id = sh.id) AND ((dr.reading_type)::text = 'opening'::text))
          ORDER BY dr.recorded_at
         LIMIT 1), t.current_stock) AS opening_dip,
    COALESCE(( SELECT sum(fd.net_volume_ltrs) AS sum
           FROM public.fuel_deliveries fd
          WHERE ((fd.tank_id = t.id) AND (fd.shift_id = sh.id))), (0)::numeric) AS deliveries,
    COALESCE(( SELECT sum(de.quantity_ltrs) AS sum
           FROM (public.dispense_events de
             JOIN public.nozzles n ON ((n.id = de.nozzle_id)))
          WHERE ((n.tank_id = t.id) AND (de.shift_id = sh.id))), (0)::numeric) AS sales_ltrs,
    ((COALESCE(( SELECT dr.volume_ltrs
           FROM public.dipstick_readings dr
          WHERE ((dr.tank_id = t.id) AND (dr.shift_id = sh.id) AND ((dr.reading_type)::text = 'opening'::text))
          ORDER BY dr.recorded_at
         LIMIT 1), t.current_stock) + COALESCE(( SELECT sum(fd.net_volume_ltrs) AS sum
           FROM public.fuel_deliveries fd
          WHERE ((fd.tank_id = t.id) AND (fd.shift_id = sh.id))), (0)::numeric)) - COALESCE(( SELECT sum(de.quantity_ltrs) AS sum
           FROM (public.dispense_events de
             JOIN public.nozzles n ON ((n.id = de.nozzle_id)))
          WHERE ((n.tank_id = t.id) AND (de.shift_id = sh.id))), (0)::numeric)) AS book_stock,
    ( SELECT dr.volume_ltrs
           FROM public.dipstick_readings dr
          WHERE ((dr.tank_id = t.id) AND (dr.shift_id = sh.id) AND ((dr.reading_type)::text = 'closing'::text))
          ORDER BY dr.recorded_at DESC
         LIMIT 1) AS closing_dip
   FROM (public.tanks t
     CROSS JOIN public.shifts sh)
  WHERE (sh.station_id = t.station_id);


--
-- Name: tank_calibration_charts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tank_calibration_charts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(80) NOT NULL,
    diameter_cm numeric(6,1) NOT NULL,
    length_cm numeric(7,1) NOT NULL,
    manufacturer character varying(120),
    source character varying(160),
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tank_reconciliation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tank_reconciliation (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    station_id uuid NOT NULL,
    shift_id uuid,
    tank_id uuid NOT NULL,
    opening_ltrs numeric(12,2) DEFAULT 0 NOT NULL,
    deliveries_ltrs numeric(12,2) DEFAULT 0 NOT NULL,
    sales_ltrs numeric(12,2) DEFAULT 0 NOT NULL,
    book_closing numeric(12,2) DEFAULT 0 NOT NULL,
    actual_closing numeric(12,2) DEFAULT 0 NOT NULL,
    variance_ltrs numeric(12,2) DEFAULT 0 NOT NULL,
    variance_pct numeric(8,3) DEFAULT 0 NOT NULL,
    tolerance_ltrs numeric(12,2) DEFAULT 0 NOT NULL,
    beyond_tolerance boolean DEFAULT false NOT NULL,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: template_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_permissions (
    template_id uuid NOT NULL,
    module_code character varying(50) NOT NULL
);


--
-- Name: user_passkeys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_passkeys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id text NOT NULL,
    public_key text NOT NULL,
    counter bigint DEFAULT 0 NOT NULL,
    device_name text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_role_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_role_assignments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    template_id uuid,
    station_id uuid,
    assigned_by uuid,
    assigned_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(120) NOT NULL,
    phone character varying(15) NOT NULL,
    email character varying(120),
    password_hash text NOT NULL,
    role character varying(20) NOT NULL,
    language character varying(10) DEFAULT 'en'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    corporate_id uuid,
    must_change_password boolean DEFAULT false,
    token_version integer DEFAULT 0 NOT NULL,
    end_date date,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'manager'::character varying, 'attendant'::character varying, 'rsa'::character varying, 'corporate'::character varying])::text[])))
);


--
-- Name: dispense_events event_seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispense_events ALTER COLUMN event_seq SET DEFAULT nextval('public.dispense_events_event_seq_seq'::regclass);


--
-- Name: alert_definitions alert_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_definitions
    ADD CONSTRAINT alert_definitions_pkey PRIMARY KEY (id);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_user_id_date_shift_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_user_id_date_shift_number_key UNIQUE (user_id, date, shift_number);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: cash_denominations cash_denominations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_denominations
    ADD CONSTRAINT cash_denominations_pkey PRIMARY KEY (id);


--
-- Name: cash_denominations cash_denominations_shift_id_attendant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_denominations
    ADD CONSTRAINT cash_denominations_shift_id_attendant_id_key UNIQUE (shift_id, attendant_id);


--
-- Name: cash_deposits cash_deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposits
    ADD CONSTRAINT cash_deposits_pkey PRIMARY KEY (id);


--
-- Name: corporate_accounts corporate_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_accounts
    ADD CONSTRAINT corporate_accounts_pkey PRIMARY KEY (id);


--
-- Name: corporate_drivers corporate_drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_drivers
    ADD CONSTRAINT corporate_drivers_pkey PRIMARY KEY (id);


--
-- Name: corporate_duplicate_flags corporate_duplicate_flags_corp1_id_corp2_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_duplicate_flags
    ADD CONSTRAINT corporate_duplicate_flags_corp1_id_corp2_id_key UNIQUE (corp1_id, corp2_id);


--
-- Name: corporate_duplicate_flags corporate_duplicate_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_duplicate_flags
    ADD CONSTRAINT corporate_duplicate_flags_pkey PRIMARY KEY (id);


--
-- Name: corporate_receipts corporate_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_receipts
    ADD CONSTRAINT corporate_receipts_pkey PRIMARY KEY (id);


--
-- Name: corporate_station_links corporate_station_links_corporate_id_station_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_station_links
    ADD CONSTRAINT corporate_station_links_corporate_id_station_id_key UNIQUE (corporate_id, station_id);


--
-- Name: corporate_station_links corporate_station_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_station_links
    ADD CONSTRAINT corporate_station_links_pkey PRIMARY KEY (id);


--
-- Name: corporate_transactions corporate_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_transactions
    ADD CONSTRAINT corporate_transactions_pkey PRIMARY KEY (id);


--
-- Name: credit_suspense_entries credit_suspense_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_suspense_entries
    ADD CONSTRAINT credit_suspense_entries_pkey PRIMARY KEY (id);


--
-- Name: delivery_invoices delivery_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_invoices
    ADD CONSTRAINT delivery_invoices_pkey PRIMARY KEY (id);


--
-- Name: dipstick_readings dipstick_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dipstick_readings
    ADD CONSTRAINT dipstick_readings_pkey PRIMARY KEY (id);


--
-- Name: dispense_events dispense_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispense_events
    ADD CONSTRAINT dispense_events_pkey PRIMARY KEY (id);


--
-- Name: fuel_deliveries fuel_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuel_deliveries
    ADD CONSTRAINT fuel_deliveries_pkey PRIMARY KEY (id);


--
-- Name: fuel_prices fuel_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuel_prices
    ADD CONSTRAINT fuel_prices_pkey PRIMARY KEY (id);


--
-- Name: gst_invoices gst_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gst_invoices
    ADD CONSTRAINT gst_invoices_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: meter_photos meter_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_photos
    ADD CONSTRAINT meter_photos_pkey PRIMARY KEY (id);


--
-- Name: nozzles nozzles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nozzles
    ADD CONSTRAINT nozzles_pkey PRIMARY KEY (id);


--
-- Name: owner_group_members owner_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_group_members
    ADD CONSTRAINT owner_group_members_pkey PRIMARY KEY (group_id, user_id);


--
-- Name: owner_groups owner_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_groups
    ADD CONSTRAINT owner_groups_pkey PRIMARY KEY (id);


--
-- Name: permission_modules permission_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_modules
    ADD CONSTRAINT permission_modules_pkey PRIMARY KEY (code);


--
-- Name: petty_cash_entries petty_cash_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.petty_cash_entries
    ADD CONSTRAINT petty_cash_entries_pkey PRIMARY KEY (id);


--
-- Name: plans plans_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_name_key UNIQUE (name);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: platform_audit platform_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_audit
    ADD CONSTRAINT platform_audit_pkey PRIMARY KEY (id);


--
-- Name: product_cn_seq product_cn_seq_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_cn_seq
    ADD CONSTRAINT product_cn_seq_pkey PRIMARY KEY (station_id);


--
-- Name: product_credit_note_items product_credit_note_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_credit_note_items
    ADD CONSTRAINT product_credit_note_items_pkey PRIMARY KEY (id);


--
-- Name: product_credit_notes product_credit_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_credit_notes
    ADD CONSTRAINT product_credit_notes_pkey PRIMARY KEY (id);


--
-- Name: product_invoice_items product_invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_invoice_items
    ADD CONSTRAINT product_invoice_items_pkey PRIMARY KEY (id);


--
-- Name: product_invoice_seq product_invoice_seq_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_invoice_seq
    ADD CONSTRAINT product_invoice_seq_pkey PRIMARY KEY (station_id);


--
-- Name: product_invoices product_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_invoices
    ADD CONSTRAINT product_invoices_pkey PRIMARY KEY (id);


--
-- Name: product_stock_receipts product_stock_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock_receipts
    ADD CONSTRAINT product_stock_receipts_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: rfid_tags rfid_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfid_tags
    ADD CONSTRAINT rfid_tags_pkey PRIMARY KEY (id);


--
-- Name: rfid_tags rfid_tags_tag_uid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfid_tags
    ADD CONSTRAINT rfid_tags_tag_uid_key UNIQUE (tag_uid);


--
-- Name: role_templates role_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_templates
    ADD CONSTRAINT role_templates_pkey PRIMARY KEY (id);


--
-- Name: role_templates role_templates_station_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_templates
    ADD CONSTRAINT role_templates_station_id_name_key UNIQUE (station_id, name);


--
-- Name: shift_attendant_nozzles shift_attendant_nozzles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_attendant_nozzles
    ADD CONSTRAINT shift_attendant_nozzles_pkey PRIMARY KEY (id);


--
-- Name: shift_attendant_nozzles shift_attendant_nozzles_shift_id_nozzle_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_attendant_nozzles
    ADD CONSTRAINT shift_attendant_nozzles_shift_id_nozzle_id_key UNIQUE (shift_id, nozzle_id);


--
-- Name: shift_attendants shift_attendants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_attendants
    ADD CONSTRAINT shift_attendants_pkey PRIMARY KEY (id);


--
-- Name: shift_attendants shift_attendants_shift_attendant_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_attendants
    ADD CONSTRAINT shift_attendants_shift_attendant_unique UNIQUE (shift_id, attendant_id);


--
-- Name: shift_definitions shift_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_definitions
    ADD CONSTRAINT shift_definitions_pkey PRIMARY KEY (id);


--
-- Name: shift_definitions shift_definitions_station_id_shift_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_definitions
    ADD CONSTRAINT shift_definitions_station_id_shift_number_key UNIQUE (station_id, shift_number);


--
-- Name: shift_nozzle_readings shift_nozzle_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_nozzle_readings
    ADD CONSTRAINT shift_nozzle_readings_pkey PRIMARY KEY (id);


--
-- Name: shift_reconciliation shift_reconciliation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_reconciliation
    ADD CONSTRAINT shift_reconciliation_pkey PRIMARY KEY (id);


--
-- Name: shift_reconciliation shift_reconciliation_shift_attendant_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_reconciliation
    ADD CONSTRAINT shift_reconciliation_shift_attendant_unique UNIQUE (shift_id, attendant_id);


--
-- Name: shifts shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);


--
-- Name: station_group_members station_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_group_members
    ADD CONSTRAINT station_group_members_pkey PRIMARY KEY (station_group_id, station_id);


--
-- Name: station_groups station_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_groups
    ADD CONSTRAINT station_groups_pkey PRIMARY KEY (id);


--
-- Name: station_settings station_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_settings
    ADD CONSTRAINT station_settings_pkey PRIMARY KEY (id);


--
-- Name: station_settings station_settings_station_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_settings
    ADD CONSTRAINT station_settings_station_id_key UNIQUE (station_id);


--
-- Name: station_subscriptions station_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_subscriptions
    ADD CONSTRAINT station_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: station_users station_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_users
    ADD CONSTRAINT station_users_pkey PRIMARY KEY (station_id, user_id);


--
-- Name: stations stations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stations
    ADD CONSTRAINT stations_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_owner_group_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_owner_group_id_key UNIQUE (owner_group_id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: superadmins superadmins_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.superadmins
    ADD CONSTRAINT superadmins_email_key UNIQUE (email);


--
-- Name: superadmins superadmins_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.superadmins
    ADD CONSTRAINT superadmins_phone_key UNIQUE (phone);


--
-- Name: superadmins superadmins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.superadmins
    ADD CONSTRAINT superadmins_pkey PRIMARY KEY (id);


--
-- Name: tally_ledger_map tally_ledger_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tally_ledger_map
    ADD CONSTRAINT tally_ledger_map_pkey PRIMARY KEY (id);


--
-- Name: tally_ledger_map tally_ledger_map_station_id_touchpoint_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tally_ledger_map
    ADD CONSTRAINT tally_ledger_map_station_id_touchpoint_key_key UNIQUE (station_id, touchpoint_key);


--
-- Name: tank_calibration_charts tank_calibration_charts_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tank_calibration_charts
    ADD CONSTRAINT tank_calibration_charts_name_key UNIQUE (name);


--
-- Name: tank_calibration_charts tank_calibration_charts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tank_calibration_charts
    ADD CONSTRAINT tank_calibration_charts_pkey PRIMARY KEY (id);


--
-- Name: tank_reconciliation tank_reconciliation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tank_reconciliation
    ADD CONSTRAINT tank_reconciliation_pkey PRIMARY KEY (id);


--
-- Name: tank_reconciliation tank_reconciliation_shift_id_tank_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tank_reconciliation
    ADD CONSTRAINT tank_reconciliation_shift_id_tank_id_key UNIQUE (shift_id, tank_id);


--
-- Name: tanks tanks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tanks
    ADD CONSTRAINT tanks_pkey PRIMARY KEY (id);


--
-- Name: template_permissions template_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_permissions
    ADD CONSTRAINT template_permissions_pkey PRIMARY KEY (template_id, module_code);


--
-- Name: user_passkeys user_passkeys_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_passkeys
    ADD CONSTRAINT user_passkeys_credential_id_key UNIQUE (credential_id);


--
-- Name: user_passkeys user_passkeys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_passkeys
    ADD CONSTRAINT user_passkeys_pkey PRIMARY KEY (id);


--
-- Name: user_role_assignments user_role_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_pkey PRIMARY KEY (id);


--
-- Name: user_role_assignments user_role_assignments_user_id_station_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_user_id_station_id_key UNIQUE (user_id, station_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_alerts_station_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_station_sent ON public.alerts USING btree (station_id, sent_at DESC);


--
-- Name: idx_alerts_station_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_station_unread ON public.alerts USING btree (station_id, acknowledged_at) WHERE (acknowledged_at IS NULL);


--
-- Name: idx_cash_deposits_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_deposits_station ON public.cash_deposits USING btree (station_id, deposit_date DESC);


--
-- Name: idx_corp_links_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corp_links_station ON public.corporate_station_links USING btree (station_id);


--
-- Name: idx_corp_receipts_corp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corp_receipts_corp ON public.corporate_receipts USING btree (corporate_id);


--
-- Name: idx_corp_receipts_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corp_receipts_station ON public.corporate_receipts USING btree (station_id);


--
-- Name: idx_corporate_pan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corporate_pan ON public.corporate_accounts USING btree (upper(TRIM(BOTH FROM pan)));


--
-- Name: idx_credit_suspense_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_suspense_station ON public.credit_suspense_entries USING btree (station_id, created_at DESC);


--
-- Name: idx_de_nozzle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_de_nozzle ON public.dispense_events USING btree (nozzle_id);


--
-- Name: idx_de_payment_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_de_payment_mode ON public.dispense_events USING btree (station_id, payment_mode);


--
-- Name: idx_de_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_de_shift ON public.dispense_events USING btree (shift_id);


--
-- Name: idx_de_station_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_de_station_date ON public.dispense_events USING btree (station_id, occurred_at);


--
-- Name: idx_deliveries_station_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliveries_station_date ON public.fuel_deliveries USING btree (station_id, received_at);


--
-- Name: idx_deliveries_tank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliveries_tank ON public.fuel_deliveries USING btree (tank_id);


--
-- Name: idx_dip_tank_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dip_tank_shift ON public.dipstick_readings USING btree (tank_id, shift_id);


--
-- Name: idx_dispense_corp_outstanding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispense_corp_outstanding ON public.dispense_events USING btree (corporate_id, station_id) WHERE ((payment_mode)::text = 'credit'::text);


--
-- Name: idx_dispense_corporate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispense_corporate ON public.dispense_events USING btree (corporate_id) WHERE (corporate_id IS NOT NULL);


--
-- Name: idx_dispense_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispense_date ON public.dispense_events USING btree (occurred_at);


--
-- Name: idx_dispense_invoiced; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispense_invoiced ON public.dispense_events USING btree (station_id, is_invoiced) WHERE (is_invoiced = false);


--
-- Name: idx_dispense_rfid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispense_rfid ON public.dispense_events USING btree (rfid_tag_id);


--
-- Name: idx_dispense_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispense_shift ON public.dispense_events USING btree (shift_id);


--
-- Name: idx_dispense_shift_attendant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispense_shift_attendant ON public.dispense_events USING btree (shift_id, attendant_id);


--
-- Name: idx_dispense_station_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispense_station_date ON public.dispense_events USING btree (station_id, occurred_at);


--
-- Name: idx_invoice_items_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_items_invoice ON public.product_invoice_items USING btree (invoice_id);


--
-- Name: idx_leads_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_created ON public.leads USING btree (created_at DESC);


--
-- Name: idx_meter_photos_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meter_photos_created ON public.meter_photos USING btree (created_at);


--
-- Name: idx_meter_photos_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meter_photos_shift ON public.meter_photos USING btree (shift_id);


--
-- Name: idx_nozzles_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nozzles_station ON public.nozzles USING btree (station_id);


--
-- Name: idx_nozzles_tank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nozzles_tank ON public.nozzles USING btree (tank_id);


--
-- Name: idx_pcni_invoice_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcni_invoice_item ON public.product_credit_note_items USING btree (invoice_item_id);


--
-- Name: idx_petty_cash_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_petty_cash_station ON public.petty_cash_entries USING btree (station_id, created_at DESC);


--
-- Name: idx_product_invoices_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_product_invoices_number ON public.product_invoices USING btree (station_id, invoice_number);


--
-- Name: idx_product_invoices_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_invoices_shift ON public.product_invoices USING btree (shift_id, attendant_id);


--
-- Name: idx_product_invoices_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_invoices_station ON public.product_invoices USING btree (station_id);


--
-- Name: idx_products_barcode; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_products_barcode ON public.products USING btree (station_id, barcode) WHERE (barcode IS NOT NULL);


--
-- Name: idx_products_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_station ON public.products USING btree (station_id);


--
-- Name: idx_san_shift_attendant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_san_shift_attendant ON public.shift_attendant_nozzles USING btree (shift_id, attendant_id);


--
-- Name: idx_shift_attendants_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shift_attendants_shift ON public.shift_attendants USING btree (shift_id, attendant_id);


--
-- Name: idx_shift_recon_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shift_recon_shift ON public.shift_reconciliation USING btree (shift_id);


--
-- Name: idx_shifts_station_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_station_date ON public.shifts USING btree (station_id, date);


--
-- Name: idx_shifts_station_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_station_status ON public.shifts USING btree (station_id, status);


--
-- Name: idx_shifts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_status ON public.shifts USING btree (station_id, status);


--
-- Name: idx_snr_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snr_shift ON public.shift_nozzle_readings USING btree (shift_id);


--
-- Name: idx_station_subs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_station_subs_active ON public.station_subscriptions USING btree (station_id) WHERE (end_date IS NULL);


--
-- Name: idx_station_subs_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_station_subs_station ON public.station_subscriptions USING btree (station_id);


--
-- Name: idx_stock_receipts_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_receipts_station ON public.product_stock_receipts USING btree (station_id);


--
-- Name: idx_tank_reco_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tank_reco_station ON public.tank_reconciliation USING btree (station_id, created_at DESC);


--
-- Name: idx_tank_reco_tank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tank_reco_tank ON public.tank_reconciliation USING btree (tank_id, created_at DESC);


--
-- Name: idx_tanks_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tanks_station ON public.tanks USING btree (station_id);


--
-- Name: idx_user_passkeys_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_passkeys_user_id ON public.user_passkeys USING btree (user_id);


--
-- Name: idx_users_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone ON public.users USING btree (phone);


--
-- Name: idx_users_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_station ON public.station_users USING btree (station_id, user_id);


--
-- Name: uq_snr_shift_nozzle; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_snr_shift_nozzle ON public.shift_nozzle_readings USING btree (shift_id, nozzle_id);


--
-- Name: ux_fuel_deliveries_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_fuel_deliveries_dedup ON public.fuel_deliveries USING btree (station_id, dc_number, fuel_type, gross_volume_ltrs) WHERE (dc_number IS NOT NULL);


--
-- Name: corporate_accounts trg_detect_corp_duplicates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_detect_corp_duplicates AFTER INSERT ON public.corporate_accounts FOR EACH ROW EXECUTE FUNCTION public.detect_corporate_duplicates();


--
-- Name: fuel_deliveries trg_increase_stock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_increase_stock AFTER INSERT ON public.fuel_deliveries FOR EACH ROW EXECUTE FUNCTION public.increase_tank_stock();


--
-- Name: gst_invoices trg_mark_invoiced; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mark_invoiced AFTER INSERT OR UPDATE ON public.gst_invoices FOR EACH ROW EXECUTE FUNCTION public.mark_transactions_invoiced();


--
-- Name: dispense_events trg_reduce_stock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reduce_stock AFTER INSERT ON public.dispense_events FOR EACH ROW EXECUTE FUNCTION public.reduce_tank_stock();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: alerts alerts_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);


--
-- Name: attendance attendance_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);


--
-- Name: attendance attendance_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: cash_denominations cash_denominations_attendant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_denominations
    ADD CONSTRAINT cash_denominations_attendant_id_fkey FOREIGN KEY (attendant_id) REFERENCES public.users(id);


--
-- Name: cash_denominations cash_denominations_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_denominations
    ADD CONSTRAINT cash_denominations_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;


--
-- Name: cash_deposits cash_deposits_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposits
    ADD CONSTRAINT cash_deposits_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id);


--
-- Name: cash_deposits cash_deposits_deposited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposits
    ADD CONSTRAINT cash_deposits_deposited_by_fkey FOREIGN KEY (deposited_by) REFERENCES public.users(id);


--
-- Name: cash_deposits cash_deposits_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposits
    ADD CONSTRAINT cash_deposits_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: corporate_accounts corporate_accounts_created_by_station_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_accounts
    ADD CONSTRAINT corporate_accounts_created_by_station_fkey FOREIGN KEY (created_by_station) REFERENCES public.stations(id);


--
-- Name: corporate_accounts corporate_accounts_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_accounts
    ADD CONSTRAINT corporate_accounts_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES public.corporate_accounts(id);


--
-- Name: corporate_drivers corporate_drivers_corporate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_drivers
    ADD CONSTRAINT corporate_drivers_corporate_id_fkey FOREIGN KEY (corporate_id) REFERENCES public.corporate_accounts(id) ON DELETE CASCADE;


--
-- Name: corporate_duplicate_flags corporate_duplicate_flags_corp1_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_duplicate_flags
    ADD CONSTRAINT corporate_duplicate_flags_corp1_id_fkey FOREIGN KEY (corp1_id) REFERENCES public.corporate_accounts(id) ON DELETE CASCADE;


--
-- Name: corporate_duplicate_flags corporate_duplicate_flags_corp2_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_duplicate_flags
    ADD CONSTRAINT corporate_duplicate_flags_corp2_id_fkey FOREIGN KEY (corp2_id) REFERENCES public.corporate_accounts(id) ON DELETE CASCADE;


--
-- Name: corporate_duplicate_flags corporate_duplicate_flags_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_duplicate_flags
    ADD CONSTRAINT corporate_duplicate_flags_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.superadmins(id);


--
-- Name: corporate_receipts corporate_receipts_corporate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_receipts
    ADD CONSTRAINT corporate_receipts_corporate_id_fkey FOREIGN KEY (corporate_id) REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT;


--
-- Name: corporate_receipts corporate_receipts_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_receipts
    ADD CONSTRAINT corporate_receipts_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.gst_invoices(id) ON DELETE SET NULL;


--
-- Name: corporate_receipts corporate_receipts_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_receipts
    ADD CONSTRAINT corporate_receipts_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: corporate_receipts corporate_receipts_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_receipts
    ADD CONSTRAINT corporate_receipts_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE RESTRICT;


--
-- Name: corporate_station_links corporate_station_links_corporate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_station_links
    ADD CONSTRAINT corporate_station_links_corporate_id_fkey FOREIGN KEY (corporate_id) REFERENCES public.corporate_accounts(id) ON DELETE CASCADE;


--
-- Name: corporate_station_links corporate_station_links_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_station_links
    ADD CONSTRAINT corporate_station_links_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: corporate_transactions corporate_transactions_corporate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_transactions
    ADD CONSTRAINT corporate_transactions_corporate_id_fkey FOREIGN KEY (corporate_id) REFERENCES public.corporate_accounts(id);


--
-- Name: corporate_transactions corporate_transactions_dispense_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_transactions
    ADD CONSTRAINT corporate_transactions_dispense_event_id_fkey FOREIGN KEY (dispense_event_id) REFERENCES public.dispense_events(id);


--
-- Name: corporate_transactions corporate_transactions_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_transactions
    ADD CONSTRAINT corporate_transactions_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.corporate_drivers(id);


--
-- Name: credit_suspense_entries credit_suspense_entries_attendant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_suspense_entries
    ADD CONSTRAINT credit_suspense_entries_attendant_id_fkey FOREIGN KEY (attendant_id) REFERENCES public.users(id);


--
-- Name: credit_suspense_entries credit_suspense_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_suspense_entries
    ADD CONSTRAINT credit_suspense_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: credit_suspense_entries credit_suspense_entries_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_suspense_entries
    ADD CONSTRAINT credit_suspense_entries_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: credit_suspense_entries credit_suspense_entries_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_suspense_entries
    ADD CONSTRAINT credit_suspense_entries_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: delivery_invoices delivery_invoices_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_invoices
    ADD CONSTRAINT delivery_invoices_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);


--
-- Name: delivery_invoices delivery_invoices_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_invoices
    ADD CONSTRAINT delivery_invoices_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: dipstick_readings dipstick_readings_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dipstick_readings
    ADD CONSTRAINT dipstick_readings_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: dipstick_readings dipstick_readings_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dipstick_readings
    ADD CONSTRAINT dipstick_readings_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: dipstick_readings dipstick_readings_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dipstick_readings
    ADD CONSTRAINT dipstick_readings_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);


--
-- Name: dipstick_readings dipstick_readings_tank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dipstick_readings
    ADD CONSTRAINT dipstick_readings_tank_id_fkey FOREIGN KEY (tank_id) REFERENCES public.tanks(id);


--
-- Name: dispense_events dispense_events_attendant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispense_events
    ADD CONSTRAINT dispense_events_attendant_id_fkey FOREIGN KEY (attendant_id) REFERENCES public.users(id);


--
-- Name: dispense_events dispense_events_corporate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispense_events
    ADD CONSTRAINT dispense_events_corporate_id_fkey FOREIGN KEY (corporate_id) REFERENCES public.corporate_accounts(id);


--
-- Name: dispense_events dispense_events_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispense_events
    ADD CONSTRAINT dispense_events_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.gst_invoices(id);


--
-- Name: dispense_events dispense_events_nozzle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispense_events
    ADD CONSTRAINT dispense_events_nozzle_id_fkey FOREIGN KEY (nozzle_id) REFERENCES public.nozzles(id);


--
-- Name: dispense_events dispense_events_rfid_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispense_events
    ADD CONSTRAINT dispense_events_rfid_tag_id_fkey FOREIGN KEY (rfid_tag_id) REFERENCES public.rfid_tags(id);


--
-- Name: dispense_events dispense_events_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispense_events
    ADD CONSTRAINT dispense_events_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: dispense_events dispense_events_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispense_events
    ADD CONSTRAINT dispense_events_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);


--
-- Name: dispense_events dispense_events_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispense_events
    ADD CONSTRAINT dispense_events_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.users(id);


--
-- Name: fuel_deliveries fuel_deliveries_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuel_deliveries
    ADD CONSTRAINT fuel_deliveries_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.delivery_invoices(id);


--
-- Name: fuel_deliveries fuel_deliveries_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuel_deliveries
    ADD CONSTRAINT fuel_deliveries_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(id);


--
-- Name: fuel_deliveries fuel_deliveries_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuel_deliveries
    ADD CONSTRAINT fuel_deliveries_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: fuel_deliveries fuel_deliveries_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuel_deliveries
    ADD CONSTRAINT fuel_deliveries_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: fuel_deliveries fuel_deliveries_tank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuel_deliveries
    ADD CONSTRAINT fuel_deliveries_tank_id_fkey FOREIGN KEY (tank_id) REFERENCES public.tanks(id);


--
-- Name: fuel_deliveries fuel_deliveries_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuel_deliveries
    ADD CONSTRAINT fuel_deliveries_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- Name: fuel_prices fuel_prices_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuel_prices
    ADD CONSTRAINT fuel_prices_set_by_fkey FOREIGN KEY (set_by) REFERENCES public.users(id);


--
-- Name: fuel_prices fuel_prices_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuel_prices
    ADD CONSTRAINT fuel_prices_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);


--
-- Name: gst_invoices gst_invoices_corporate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gst_invoices
    ADD CONSTRAINT gst_invoices_corporate_id_fkey FOREIGN KEY (corporate_id) REFERENCES public.corporate_accounts(id);


--
-- Name: gst_invoices gst_invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gst_invoices
    ADD CONSTRAINT gst_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: gst_invoices gst_invoices_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gst_invoices
    ADD CONSTRAINT gst_invoices_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);


--
-- Name: meter_photos meter_photos_nozzle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_photos
    ADD CONSTRAINT meter_photos_nozzle_id_fkey FOREIGN KEY (nozzle_id) REFERENCES public.nozzles(id);


--
-- Name: meter_photos meter_photos_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_photos
    ADD CONSTRAINT meter_photos_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: meter_photos meter_photos_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_photos
    ADD CONSTRAINT meter_photos_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;


--
-- Name: nozzles nozzles_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nozzles
    ADD CONSTRAINT nozzles_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: nozzles nozzles_tank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nozzles
    ADD CONSTRAINT nozzles_tank_id_fkey FOREIGN KEY (tank_id) REFERENCES public.tanks(id);


--
-- Name: owner_group_members owner_group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_group_members
    ADD CONSTRAINT owner_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.owner_groups(id) ON DELETE CASCADE;


--
-- Name: owner_group_members owner_group_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_group_members
    ADD CONSTRAINT owner_group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: owner_groups owner_groups_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_groups
    ADD CONSTRAINT owner_groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.superadmins(id);


--
-- Name: petty_cash_entries petty_cash_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.petty_cash_entries
    ADD CONSTRAINT petty_cash_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: petty_cash_entries petty_cash_entries_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.petty_cash_entries
    ADD CONSTRAINT petty_cash_entries_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: platform_audit platform_audit_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_audit
    ADD CONSTRAINT platform_audit_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.superadmins(id);


--
-- Name: product_credit_note_items product_credit_note_items_credit_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_credit_note_items
    ADD CONSTRAINT product_credit_note_items_credit_note_id_fkey FOREIGN KEY (credit_note_id) REFERENCES public.product_credit_notes(id) ON DELETE CASCADE;


--
-- Name: product_credit_notes product_credit_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_credit_notes
    ADD CONSTRAINT product_credit_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: product_credit_notes product_credit_notes_original_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_credit_notes
    ADD CONSTRAINT product_credit_notes_original_invoice_id_fkey FOREIGN KEY (original_invoice_id) REFERENCES public.product_invoices(id);


--
-- Name: product_credit_notes product_credit_notes_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_credit_notes
    ADD CONSTRAINT product_credit_notes_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);


--
-- Name: product_invoice_items product_invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_invoice_items
    ADD CONSTRAINT product_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.product_invoices(id) ON DELETE CASCADE;


--
-- Name: product_invoice_items product_invoice_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_invoice_items
    ADD CONSTRAINT product_invoice_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: product_invoice_seq product_invoice_seq_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_invoice_seq
    ADD CONSTRAINT product_invoice_seq_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: product_invoices product_invoices_attendant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_invoices
    ADD CONSTRAINT product_invoices_attendant_id_fkey FOREIGN KEY (attendant_id) REFERENCES public.users(id);


--
-- Name: product_invoices product_invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_invoices
    ADD CONSTRAINT product_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: product_invoices product_invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_invoices
    ADD CONSTRAINT product_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.corporate_accounts(id);


--
-- Name: product_invoices product_invoices_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_invoices
    ADD CONSTRAINT product_invoices_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: product_invoices product_invoices_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_invoices
    ADD CONSTRAINT product_invoices_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: product_stock_receipts product_stock_receipts_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock_receipts
    ADD CONSTRAINT product_stock_receipts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_stock_receipts product_stock_receipts_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock_receipts
    ADD CONSTRAINT product_stock_receipts_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(id);


--
-- Name: product_stock_receipts product_stock_receipts_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock_receipts
    ADD CONSTRAINT product_stock_receipts_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: products products_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: rfid_tags rfid_tags_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfid_tags
    ADD CONSTRAINT rfid_tags_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);


--
-- Name: role_templates role_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_templates
    ADD CONSTRAINT role_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: role_templates role_templates_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_templates
    ADD CONSTRAINT role_templates_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: shift_attendant_nozzles shift_attendant_nozzles_attendant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_attendant_nozzles
    ADD CONSTRAINT shift_attendant_nozzles_attendant_id_fkey FOREIGN KEY (attendant_id) REFERENCES public.users(id);


--
-- Name: shift_attendant_nozzles shift_attendant_nozzles_nozzle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_attendant_nozzles
    ADD CONSTRAINT shift_attendant_nozzles_nozzle_id_fkey FOREIGN KEY (nozzle_id) REFERENCES public.nozzles(id);


--
-- Name: shift_attendant_nozzles shift_attendant_nozzles_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_attendant_nozzles
    ADD CONSTRAINT shift_attendant_nozzles_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;


--
-- Name: shift_attendants shift_attendants_attendant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_attendants
    ADD CONSTRAINT shift_attendants_attendant_id_fkey FOREIGN KEY (attendant_id) REFERENCES public.users(id);


--
-- Name: shift_attendants shift_attendants_nozzle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_attendants
    ADD CONSTRAINT shift_attendants_nozzle_id_fkey FOREIGN KEY (nozzle_id) REFERENCES public.nozzles(id);


--
-- Name: shift_attendants shift_attendants_rfid_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_attendants
    ADD CONSTRAINT shift_attendants_rfid_tag_id_fkey FOREIGN KEY (rfid_tag_id) REFERENCES public.rfid_tags(id);


--
-- Name: shift_attendants shift_attendants_shift_ended_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_attendants
    ADD CONSTRAINT shift_attendants_shift_ended_by_fkey FOREIGN KEY (shift_ended_by) REFERENCES public.users(id);


--
-- Name: shift_attendants shift_attendants_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_attendants
    ADD CONSTRAINT shift_attendants_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;


--
-- Name: shift_definitions shift_definitions_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_definitions
    ADD CONSTRAINT shift_definitions_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: shift_nozzle_readings shift_nozzle_readings_nozzle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_nozzle_readings
    ADD CONSTRAINT shift_nozzle_readings_nozzle_id_fkey FOREIGN KEY (nozzle_id) REFERENCES public.nozzles(id);


--
-- Name: shift_nozzle_readings shift_nozzle_readings_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_nozzle_readings
    ADD CONSTRAINT shift_nozzle_readings_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: shift_nozzle_readings shift_nozzle_readings_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_nozzle_readings
    ADD CONSTRAINT shift_nozzle_readings_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;


--
-- Name: shift_reconciliation shift_reconciliation_attendant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_reconciliation
    ADD CONSTRAINT shift_reconciliation_attendant_id_fkey FOREIGN KEY (attendant_id) REFERENCES public.users(id);


--
-- Name: shift_reconciliation shift_reconciliation_denomination_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_reconciliation
    ADD CONSTRAINT shift_reconciliation_denomination_id_fkey FOREIGN KEY (denomination_id) REFERENCES public.cash_denominations(id);


--
-- Name: shift_reconciliation shift_reconciliation_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_reconciliation
    ADD CONSTRAINT shift_reconciliation_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.users(id);


--
-- Name: shift_reconciliation shift_reconciliation_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_reconciliation
    ADD CONSTRAINT shift_reconciliation_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: shifts shifts_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.users(id);


--
-- Name: shifts shifts_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);


--
-- Name: station_group_members station_group_members_station_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_group_members
    ADD CONSTRAINT station_group_members_station_group_id_fkey FOREIGN KEY (station_group_id) REFERENCES public.station_groups(id) ON DELETE CASCADE;


--
-- Name: station_group_members station_group_members_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_group_members
    ADD CONSTRAINT station_group_members_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: station_groups station_groups_owner_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_groups
    ADD CONSTRAINT station_groups_owner_group_id_fkey FOREIGN KEY (owner_group_id) REFERENCES public.owner_groups(id) ON DELETE CASCADE;


--
-- Name: station_settings station_settings_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_settings
    ADD CONSTRAINT station_settings_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: station_subscriptions station_subscriptions_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_subscriptions
    ADD CONSTRAINT station_subscriptions_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: station_users station_users_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_users
    ADD CONSTRAINT station_users_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: station_users station_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_users
    ADD CONSTRAINT station_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_owner_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_owner_group_id_fkey FOREIGN KEY (owner_group_id) REFERENCES public.owner_groups(id);


--
-- Name: tally_ledger_map tally_ledger_map_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tally_ledger_map
    ADD CONSTRAINT tally_ledger_map_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: tank_reconciliation tank_reconciliation_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tank_reconciliation
    ADD CONSTRAINT tank_reconciliation_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: tank_reconciliation tank_reconciliation_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tank_reconciliation
    ADD CONSTRAINT tank_reconciliation_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;


--
-- Name: tank_reconciliation tank_reconciliation_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tank_reconciliation
    ADD CONSTRAINT tank_reconciliation_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: tank_reconciliation tank_reconciliation_tank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tank_reconciliation
    ADD CONSTRAINT tank_reconciliation_tank_id_fkey FOREIGN KEY (tank_id) REFERENCES public.tanks(id) ON DELETE CASCADE;


--
-- Name: tanks tanks_calibration_chart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tanks
    ADD CONSTRAINT tanks_calibration_chart_id_fkey FOREIGN KEY (calibration_chart_id) REFERENCES public.tank_calibration_charts(id);


--
-- Name: tanks tanks_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tanks
    ADD CONSTRAINT tanks_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: template_permissions template_permissions_module_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_permissions
    ADD CONSTRAINT template_permissions_module_code_fkey FOREIGN KEY (module_code) REFERENCES public.permission_modules(code) ON DELETE CASCADE;


--
-- Name: template_permissions template_permissions_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_permissions
    ADD CONSTRAINT template_permissions_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.role_templates(id) ON DELETE CASCADE;


--
-- Name: user_passkeys user_passkeys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_passkeys
    ADD CONSTRAINT user_passkeys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_role_assignments user_role_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: user_role_assignments user_role_assignments_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;


--
-- Name: user_role_assignments user_role_assignments_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.role_templates(id) ON DELETE CASCADE;


--
-- Name: user_role_assignments user_role_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_corporate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_corporate_id_fkey FOREIGN KEY (corporate_id) REFERENCES public.corporate_accounts(id);


--
-- Name: alert_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alert_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: alert_definitions alert_definitions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY alert_definitions_read ON public.alert_definitions FOR SELECT USING (true);


--
-- Name: alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: alerts alerts_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY alerts_station_isolation ON public.alerts USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance attendance_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_station_isolation ON public.attendance USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_log_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_isolation ON public.audit_log USING (((user_id = public.app_current_user_id()) OR public.app_is_superadmin())) WITH CHECK (true);


--
-- Name: cash_denominations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_denominations ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_denominations cash_denominations_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cash_denominations_isolation ON public.cash_denominations USING ((EXISTS ( SELECT 1
   FROM public.shifts s
  WHERE ((s.id = cash_denominations.shift_id) AND (s.station_id IN ( SELECT public.my_stations() AS my_stations)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.shifts s
  WHERE ((s.id = cash_denominations.shift_id) AND (s.station_id IN ( SELECT public.my_stations() AS my_stations))))));


--
-- Name: cash_deposits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_deposits ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_deposits cash_deposits_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cash_deposits_station_isolation ON public.cash_deposits USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: corporate_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_accounts corporate_accounts_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY corporate_accounts_isolation ON public.corporate_accounts USING (((id IN ( SELECT public.my_corporates() AS my_corporates)) OR public.app_is_superadmin())) WITH CHECK (((created_by_station IN ( SELECT public.my_stations() AS my_stations)) OR (id IN ( SELECT public.my_corporates() AS my_corporates)) OR public.app_is_superadmin()));


--
-- Name: corporate_drivers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_drivers ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_drivers corporate_drivers_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY corporate_drivers_isolation ON public.corporate_drivers USING (((corporate_id IN ( SELECT public.my_corporates() AS my_corporates)) OR public.app_is_superadmin())) WITH CHECK (((corporate_id IN ( SELECT public.my_corporates() AS my_corporates)) OR public.app_is_superadmin()));


--
-- Name: corporate_duplicate_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_duplicate_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_duplicate_flags corporate_duplicate_flags_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY corporate_duplicate_flags_isolation ON public.corporate_duplicate_flags USING (((corp1_id IN ( SELECT public.my_corporates() AS my_corporates)) OR (corp2_id IN ( SELECT public.my_corporates() AS my_corporates)) OR public.app_is_superadmin())) WITH CHECK (((corp1_id IN ( SELECT public.my_corporates() AS my_corporates)) OR (corp2_id IN ( SELECT public.my_corporates() AS my_corporates)) OR public.app_is_superadmin()));


--
-- Name: corporate_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_receipts corporate_receipts_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY corporate_receipts_station_isolation ON public.corporate_receipts USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: corporate_station_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_station_links ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_station_links corporate_station_links_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY corporate_station_links_station_isolation ON public.corporate_station_links USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: corporate_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_transactions corporate_transactions_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY corporate_transactions_isolation ON public.corporate_transactions USING (((corporate_id IN ( SELECT public.my_corporates() AS my_corporates)) OR public.app_is_superadmin())) WITH CHECK (((corporate_id IN ( SELECT public.my_corporates() AS my_corporates)) OR public.app_is_superadmin()));


--
-- Name: credit_suspense_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credit_suspense_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_suspense_entries credit_suspense_entries_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY credit_suspense_entries_station_isolation ON public.credit_suspense_entries USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: delivery_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_invoices delivery_invoices_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delivery_invoices_station_isolation ON public.delivery_invoices USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: dipstick_readings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dipstick_readings ENABLE ROW LEVEL SECURITY;

--
-- Name: dipstick_readings dipstick_readings_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dipstick_readings_station_isolation ON public.dipstick_readings USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: dispense_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dispense_events ENABLE ROW LEVEL SECURITY;

--
-- Name: dispense_events dispense_events_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dispense_events_station_isolation ON public.dispense_events USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: fuel_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fuel_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: fuel_deliveries fuel_deliveries_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fuel_deliveries_station_isolation ON public.fuel_deliveries USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: fuel_prices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fuel_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: fuel_prices fuel_prices_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fuel_prices_station_isolation ON public.fuel_prices USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: gst_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gst_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: gst_invoices gst_invoices_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gst_invoices_station_isolation ON public.gst_invoices USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

--
-- Name: leads leads_public_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_public_insert ON public.leads FOR INSERT WITH CHECK (true);


--
-- Name: leads leads_superadmin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_superadmin_read ON public.leads FOR SELECT USING (public.app_is_superadmin());


--
-- Name: meter_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meter_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: meter_photos meter_photos_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meter_photos_station_isolation ON public.meter_photos USING ((EXISTS ( SELECT 1
   FROM public.shifts s
  WHERE ((s.id = meter_photos.shift_id) AND (s.station_id IN ( SELECT public.my_stations() AS my_stations)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.shifts s
  WHERE ((s.id = meter_photos.shift_id) AND (s.station_id IN ( SELECT public.my_stations() AS my_stations))))));


--
-- Name: nozzles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nozzles ENABLE ROW LEVEL SECURITY;

--
-- Name: nozzles nozzles_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY nozzles_station_isolation ON public.nozzles USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: owner_group_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.owner_group_members ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_group_members owner_group_members_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_group_members_isolation ON public.owner_group_members USING (((group_id IN ( SELECT public.my_owner_groups() AS my_owner_groups)) OR (user_id = public.app_current_user_id()) OR public.app_is_superadmin())) WITH CHECK (true);


--
-- Name: owner_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.owner_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_groups owner_groups_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_groups_isolation ON public.owner_groups USING (((id IN ( SELECT public.my_owner_groups() AS my_owner_groups)) OR public.app_is_superadmin())) WITH CHECK (public.app_is_superadmin());


--
-- Name: permission_modules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permission_modules ENABLE ROW LEVEL SECURITY;

--
-- Name: permission_modules permission_modules_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY permission_modules_read ON public.permission_modules FOR SELECT USING (true);


--
-- Name: petty_cash_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.petty_cash_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: petty_cash_entries petty_cash_entries_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY petty_cash_entries_station_isolation ON public.petty_cash_entries USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

--
-- Name: plans plans_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plans_read ON public.plans FOR SELECT USING (true);


--
-- Name: platform_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_audit platform_audit_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_audit_superadmin ON public.platform_audit USING (public.app_is_superadmin()) WITH CHECK (public.app_is_superadmin());


--
-- Name: product_cn_seq; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_cn_seq ENABLE ROW LEVEL SECURITY;

--
-- Name: product_cn_seq product_cn_seq_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_cn_seq_station_isolation ON public.product_cn_seq USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: product_credit_note_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_credit_note_items ENABLE ROW LEVEL SECURITY;

--
-- Name: product_credit_note_items product_credit_note_items_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_credit_note_items_isolation ON public.product_credit_note_items USING ((EXISTS ( SELECT 1
   FROM public.product_credit_notes cn
  WHERE ((cn.id = product_credit_note_items.credit_note_id) AND (cn.station_id IN ( SELECT public.my_stations() AS my_stations)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.product_credit_notes cn
  WHERE ((cn.id = product_credit_note_items.credit_note_id) AND (cn.station_id IN ( SELECT public.my_stations() AS my_stations))))));


--
-- Name: product_credit_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_credit_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: product_credit_notes product_credit_notes_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_credit_notes_station_isolation ON public.product_credit_notes USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: product_invoice_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_invoice_items ENABLE ROW LEVEL SECURITY;

--
-- Name: product_invoice_items product_invoice_items_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_invoice_items_isolation ON public.product_invoice_items USING ((EXISTS ( SELECT 1
   FROM public.product_invoices pi
  WHERE ((pi.id = product_invoice_items.invoice_id) AND (pi.station_id IN ( SELECT public.my_stations() AS my_stations)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.product_invoices pi
  WHERE ((pi.id = product_invoice_items.invoice_id) AND (pi.station_id IN ( SELECT public.my_stations() AS my_stations))))));


--
-- Name: product_invoice_seq; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_invoice_seq ENABLE ROW LEVEL SECURITY;

--
-- Name: product_invoice_seq product_invoice_seq_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_invoice_seq_station_isolation ON public.product_invoice_seq USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: product_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: product_invoices product_invoices_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_invoices_station_isolation ON public.product_invoices USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: product_stock_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_stock_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: product_stock_receipts product_stock_receipts_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_stock_receipts_station_isolation ON public.product_stock_receipts USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: products products_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_station_isolation ON public.products USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: rfid_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rfid_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: rfid_tags rfid_tags_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rfid_tags_station_isolation ON public.rfid_tags USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: role_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: role_templates role_templates_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_templates_station_isolation ON public.role_templates USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: shift_attendant_nozzles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shift_attendant_nozzles ENABLE ROW LEVEL SECURITY;

--
-- Name: shift_attendant_nozzles shift_attendant_nozzles_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shift_attendant_nozzles_isolation ON public.shift_attendant_nozzles USING ((EXISTS ( SELECT 1
   FROM public.shifts s
  WHERE ((s.id = shift_attendant_nozzles.shift_id) AND (s.station_id IN ( SELECT public.my_stations() AS my_stations)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.shifts s
  WHERE ((s.id = shift_attendant_nozzles.shift_id) AND (s.station_id IN ( SELECT public.my_stations() AS my_stations))))));


--
-- Name: shift_attendants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shift_attendants ENABLE ROW LEVEL SECURITY;

--
-- Name: shift_attendants shift_attendants_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shift_attendants_isolation ON public.shift_attendants USING ((EXISTS ( SELECT 1
   FROM public.shifts s
  WHERE ((s.id = shift_attendants.shift_id) AND (s.station_id IN ( SELECT public.my_stations() AS my_stations)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.shifts s
  WHERE ((s.id = shift_attendants.shift_id) AND (s.station_id IN ( SELECT public.my_stations() AS my_stations))))));


--
-- Name: shift_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shift_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: shift_definitions shift_definitions_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shift_definitions_station_isolation ON public.shift_definitions USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: shift_nozzle_readings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shift_nozzle_readings ENABLE ROW LEVEL SECURITY;

--
-- Name: shift_nozzle_readings shift_nozzle_readings_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shift_nozzle_readings_station_isolation ON public.shift_nozzle_readings USING ((EXISTS ( SELECT 1
   FROM public.shifts s
  WHERE ((s.id = shift_nozzle_readings.shift_id) AND (s.station_id IN ( SELECT public.my_stations() AS my_stations)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.shifts s
  WHERE ((s.id = shift_nozzle_readings.shift_id) AND (s.station_id IN ( SELECT public.my_stations() AS my_stations))))));


--
-- Name: shift_reconciliation; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shift_reconciliation ENABLE ROW LEVEL SECURITY;

--
-- Name: shift_reconciliation shift_reconciliation_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shift_reconciliation_isolation ON public.shift_reconciliation USING ((EXISTS ( SELECT 1
   FROM public.shifts s
  WHERE ((s.id = shift_reconciliation.shift_id) AND (s.station_id IN ( SELECT public.my_stations() AS my_stations)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.shifts s
  WHERE ((s.id = shift_reconciliation.shift_id) AND (s.station_id IN ( SELECT public.my_stations() AS my_stations))))));


--
-- Name: shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: shifts shifts_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shifts_station_isolation ON public.shifts USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: station_group_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.station_group_members ENABLE ROW LEVEL SECURITY;

--
-- Name: station_group_members station_group_members_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY station_group_members_station_isolation ON public.station_group_members USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: station_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.station_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: station_groups station_groups_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY station_groups_isolation ON public.station_groups USING (((owner_group_id IN ( SELECT public.my_owner_groups() AS my_owner_groups)) OR public.app_is_superadmin())) WITH CHECK (public.app_is_superadmin());


--
-- Name: station_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.station_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: station_settings station_settings_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY station_settings_station_isolation ON public.station_settings USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: station_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.station_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: station_subscriptions station_subscriptions_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY station_subscriptions_station_isolation ON public.station_subscriptions USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: station_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.station_users ENABLE ROW LEVEL SECURITY;

--
-- Name: station_users station_users_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY station_users_station_isolation ON public.station_users USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: stations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;

--
-- Name: stations stations_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stations_isolation ON public.stations USING (((id IN ( SELECT public.my_stations() AS my_stations)) OR public.app_is_superadmin())) WITH CHECK (((id IN ( SELECT public.my_stations() AS my_stations)) OR public.app_is_superadmin()));


--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions subscriptions_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_isolation ON public.subscriptions USING (((owner_group_id IN ( SELECT public.my_owner_groups() AS my_owner_groups)) OR public.app_is_superadmin())) WITH CHECK (public.app_is_superadmin());


--
-- Name: superadmins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.superadmins ENABLE ROW LEVEL SECURITY;

--
-- Name: superadmins superadmins_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY superadmins_superadmin ON public.superadmins USING (public.app_is_superadmin()) WITH CHECK (public.app_is_superadmin());


--
-- Name: tally_ledger_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tally_ledger_map ENABLE ROW LEVEL SECURITY;

--
-- Name: tally_ledger_map tally_ledger_map_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tally_ledger_map_station_isolation ON public.tally_ledger_map USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: tank_calibration_charts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tank_calibration_charts ENABLE ROW LEVEL SECURITY;

--
-- Name: tank_calibration_charts tank_calibration_charts_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tank_calibration_charts_read ON public.tank_calibration_charts FOR SELECT USING (true);


--
-- Name: tank_reconciliation; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tank_reconciliation ENABLE ROW LEVEL SECURITY;

--
-- Name: tank_reconciliation tank_reconciliation_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tank_reconciliation_station_isolation ON public.tank_reconciliation USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: tanks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tanks ENABLE ROW LEVEL SECURITY;

--
-- Name: tanks tanks_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tanks_station_isolation ON public.tanks USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: template_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.template_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: template_permissions template_permissions_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY template_permissions_isolation ON public.template_permissions USING ((EXISTS ( SELECT 1
   FROM public.role_templates rt
  WHERE ((rt.id = template_permissions.template_id) AND (rt.station_id IN ( SELECT public.my_stations() AS my_stations)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.role_templates rt
  WHERE ((rt.id = template_permissions.template_id) AND (rt.station_id IN ( SELECT public.my_stations() AS my_stations))))));


--
-- Name: user_passkeys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_passkeys ENABLE ROW LEVEL SECURITY;

--
-- Name: user_passkeys user_passkeys_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_passkeys_isolation ON public.user_passkeys USING (((user_id = public.app_current_user_id()) OR public.app_is_superadmin())) WITH CHECK ((user_id = public.app_current_user_id()));


--
-- Name: user_role_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_role_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: user_role_assignments user_role_assignments_station_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_role_assignments_station_isolation ON public.user_role_assignments USING ((station_id IN ( SELECT public.my_stations() AS my_stations))) WITH CHECK ((station_id IN ( SELECT public.my_stations() AS my_stations)));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_isolation ON public.users USING (((id = public.app_current_user_id()) OR public.app_is_superadmin() OR (EXISTS ( SELECT 1
   FROM public.station_users su
  WHERE ((su.user_id = users.id) AND (su.station_id IN ( SELECT public.my_stations() AS my_stations))))) OR ((corporate_id IS NOT NULL) AND (corporate_id IN ( SELECT public.my_corporates() AS my_corporates))))) WITH CHECK (true);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO app_authenticated;


--
-- Name: FUNCTION app_current_corporate_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.app_current_corporate_id() TO anon;
GRANT ALL ON FUNCTION public.app_current_corporate_id() TO authenticated;
GRANT ALL ON FUNCTION public.app_current_corporate_id() TO service_role;
GRANT ALL ON FUNCTION public.app_current_corporate_id() TO app_authenticated;


--
-- Name: FUNCTION app_current_user_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.app_current_user_id() TO anon;
GRANT ALL ON FUNCTION public.app_current_user_id() TO authenticated;
GRANT ALL ON FUNCTION public.app_current_user_id() TO service_role;
GRANT ALL ON FUNCTION public.app_current_user_id() TO app_authenticated;


--
-- Name: FUNCTION app_is_superadmin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.app_is_superadmin() TO anon;
GRANT ALL ON FUNCTION public.app_is_superadmin() TO authenticated;
GRANT ALL ON FUNCTION public.app_is_superadmin() TO service_role;
GRANT ALL ON FUNCTION public.app_is_superadmin() TO app_authenticated;


--
-- Name: FUNCTION calib_tolerance(p_chart uuid, p_dip numeric); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calib_tolerance(p_chart uuid, p_dip numeric) TO anon;
GRANT ALL ON FUNCTION public.calib_tolerance(p_chart uuid, p_dip numeric) TO authenticated;
GRANT ALL ON FUNCTION public.calib_tolerance(p_chart uuid, p_dip numeric) TO service_role;


--
-- Name: FUNCTION calib_volume(p_chart uuid, p_dip numeric); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calib_volume(p_chart uuid, p_dip numeric) TO anon;
GRANT ALL ON FUNCTION public.calib_volume(p_chart uuid, p_dip numeric) TO authenticated;
GRANT ALL ON FUNCTION public.calib_volume(p_chart uuid, p_dip numeric) TO service_role;


--
-- Name: FUNCTION detect_corporate_duplicates(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.detect_corporate_duplicates() TO anon;
GRANT ALL ON FUNCTION public.detect_corporate_duplicates() TO authenticated;
GRANT ALL ON FUNCTION public.detect_corporate_duplicates() TO service_role;


--
-- Name: FUNCTION increase_tank_stock(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increase_tank_stock() TO anon;
GRANT ALL ON FUNCTION public.increase_tank_stock() TO authenticated;
GRANT ALL ON FUNCTION public.increase_tank_stock() TO service_role;


--
-- Name: FUNCTION mark_transactions_invoiced(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.mark_transactions_invoiced() TO anon;
GRANT ALL ON FUNCTION public.mark_transactions_invoiced() TO authenticated;
GRANT ALL ON FUNCTION public.mark_transactions_invoiced() TO service_role;


--
-- Name: FUNCTION my_corporates(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.my_corporates() TO anon;
GRANT ALL ON FUNCTION public.my_corporates() TO authenticated;
GRANT ALL ON FUNCTION public.my_corporates() TO service_role;
GRANT ALL ON FUNCTION public.my_corporates() TO app_authenticated;


--
-- Name: FUNCTION my_owner_groups(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.my_owner_groups() TO anon;
GRANT ALL ON FUNCTION public.my_owner_groups() TO authenticated;
GRANT ALL ON FUNCTION public.my_owner_groups() TO service_role;
GRANT ALL ON FUNCTION public.my_owner_groups() TO app_authenticated;


--
-- Name: FUNCTION my_stations(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.my_stations() TO anon;
GRANT ALL ON FUNCTION public.my_stations() TO authenticated;
GRANT ALL ON FUNCTION public.my_stations() TO service_role;
GRANT ALL ON FUNCTION public.my_stations() TO app_authenticated;


--
-- Name: FUNCTION reduce_tank_stock(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reduce_tank_stock() TO anon;
GRANT ALL ON FUNCTION public.reduce_tank_stock() TO authenticated;
GRANT ALL ON FUNCTION public.reduce_tank_stock() TO service_role;


--
-- Name: FUNCTION update_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at() TO service_role;


--
-- Name: TABLE alert_definitions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.alert_definitions TO anon;
GRANT ALL ON TABLE public.alert_definitions TO authenticated;
GRANT ALL ON TABLE public.alert_definitions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.alert_definitions TO app_authenticated;


--
-- Name: TABLE alerts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.alerts TO anon;
GRANT ALL ON TABLE public.alerts TO authenticated;
GRANT ALL ON TABLE public.alerts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.alerts TO app_authenticated;


--
-- Name: TABLE attendance; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.attendance TO anon;
GRANT ALL ON TABLE public.attendance TO authenticated;
GRANT ALL ON TABLE public.attendance TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.attendance TO app_authenticated;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_log TO anon;
GRANT ALL ON TABLE public.audit_log TO authenticated;
GRANT ALL ON TABLE public.audit_log TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.audit_log TO app_authenticated;


--
-- Name: TABLE cash_denominations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cash_denominations TO anon;
GRANT ALL ON TABLE public.cash_denominations TO authenticated;
GRANT ALL ON TABLE public.cash_denominations TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cash_denominations TO app_authenticated;


--
-- Name: TABLE cash_deposits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cash_deposits TO anon;
GRANT ALL ON TABLE public.cash_deposits TO authenticated;
GRANT ALL ON TABLE public.cash_deposits TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cash_deposits TO app_authenticated;


--
-- Name: TABLE corporate_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.corporate_accounts TO anon;
GRANT ALL ON TABLE public.corporate_accounts TO authenticated;
GRANT ALL ON TABLE public.corporate_accounts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.corporate_accounts TO app_authenticated;


--
-- Name: TABLE corporate_drivers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.corporate_drivers TO anon;
GRANT ALL ON TABLE public.corporate_drivers TO authenticated;
GRANT ALL ON TABLE public.corporate_drivers TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.corporate_drivers TO app_authenticated;


--
-- Name: TABLE corporate_duplicate_flags; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.corporate_duplicate_flags TO anon;
GRANT ALL ON TABLE public.corporate_duplicate_flags TO authenticated;
GRANT ALL ON TABLE public.corporate_duplicate_flags TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.corporate_duplicate_flags TO app_authenticated;


--
-- Name: TABLE corporate_receipts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.corporate_receipts TO anon;
GRANT ALL ON TABLE public.corporate_receipts TO authenticated;
GRANT ALL ON TABLE public.corporate_receipts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.corporate_receipts TO app_authenticated;


--
-- Name: TABLE corporate_station_links; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.corporate_station_links TO anon;
GRANT ALL ON TABLE public.corporate_station_links TO authenticated;
GRANT ALL ON TABLE public.corporate_station_links TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.corporate_station_links TO app_authenticated;


--
-- Name: TABLE dispense_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.dispense_events TO anon;
GRANT ALL ON TABLE public.dispense_events TO authenticated;
GRANT ALL ON TABLE public.dispense_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dispense_events TO app_authenticated;


--
-- Name: TABLE corporate_station_balance; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.corporate_station_balance TO anon;
GRANT ALL ON TABLE public.corporate_station_balance TO authenticated;
GRANT ALL ON TABLE public.corporate_station_balance TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.corporate_station_balance TO app_authenticated;


--
-- Name: TABLE corporate_transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.corporate_transactions TO anon;
GRANT ALL ON TABLE public.corporate_transactions TO authenticated;
GRANT ALL ON TABLE public.corporate_transactions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.corporate_transactions TO app_authenticated;


--
-- Name: TABLE credit_suspense_entries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.credit_suspense_entries TO anon;
GRANT ALL ON TABLE public.credit_suspense_entries TO authenticated;
GRANT ALL ON TABLE public.credit_suspense_entries TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.credit_suspense_entries TO app_authenticated;


--
-- Name: TABLE delivery_invoices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.delivery_invoices TO anon;
GRANT ALL ON TABLE public.delivery_invoices TO authenticated;
GRANT ALL ON TABLE public.delivery_invoices TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.delivery_invoices TO app_authenticated;


--
-- Name: TABLE dipstick_readings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.dipstick_readings TO anon;
GRANT ALL ON TABLE public.dipstick_readings TO authenticated;
GRANT ALL ON TABLE public.dipstick_readings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dipstick_readings TO app_authenticated;


--
-- Name: SEQUENCE dispense_events_event_seq_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.dispense_events_event_seq_seq TO anon;
GRANT ALL ON SEQUENCE public.dispense_events_event_seq_seq TO authenticated;
GRANT ALL ON SEQUENCE public.dispense_events_event_seq_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.dispense_events_event_seq_seq TO app_authenticated;


--
-- Name: TABLE fuel_deliveries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fuel_deliveries TO anon;
GRANT ALL ON TABLE public.fuel_deliveries TO authenticated;
GRANT ALL ON TABLE public.fuel_deliveries TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fuel_deliveries TO app_authenticated;


--
-- Name: TABLE fuel_prices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fuel_prices TO anon;
GRANT ALL ON TABLE public.fuel_prices TO authenticated;
GRANT ALL ON TABLE public.fuel_prices TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fuel_prices TO app_authenticated;


--
-- Name: TABLE gst_invoices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.gst_invoices TO anon;
GRANT ALL ON TABLE public.gst_invoices TO authenticated;
GRANT ALL ON TABLE public.gst_invoices TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gst_invoices TO app_authenticated;


--
-- Name: TABLE leads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.leads TO anon;
GRANT ALL ON TABLE public.leads TO authenticated;
GRANT ALL ON TABLE public.leads TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.leads TO app_authenticated;


--
-- Name: TABLE meter_photos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.meter_photos TO anon;
GRANT ALL ON TABLE public.meter_photos TO authenticated;
GRANT ALL ON TABLE public.meter_photos TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.meter_photos TO app_authenticated;


--
-- Name: TABLE nozzles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nozzles TO anon;
GRANT ALL ON TABLE public.nozzles TO authenticated;
GRANT ALL ON TABLE public.nozzles TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.nozzles TO app_authenticated;


--
-- Name: TABLE owner_group_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.owner_group_members TO anon;
GRANT ALL ON TABLE public.owner_group_members TO authenticated;
GRANT ALL ON TABLE public.owner_group_members TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.owner_group_members TO app_authenticated;


--
-- Name: TABLE owner_groups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.owner_groups TO anon;
GRANT ALL ON TABLE public.owner_groups TO authenticated;
GRANT ALL ON TABLE public.owner_groups TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.owner_groups TO app_authenticated;


--
-- Name: TABLE permission_modules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.permission_modules TO anon;
GRANT ALL ON TABLE public.permission_modules TO authenticated;
GRANT ALL ON TABLE public.permission_modules TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.permission_modules TO app_authenticated;


--
-- Name: TABLE petty_cash_entries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.petty_cash_entries TO anon;
GRANT ALL ON TABLE public.petty_cash_entries TO authenticated;
GRANT ALL ON TABLE public.petty_cash_entries TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.petty_cash_entries TO app_authenticated;


--
-- Name: TABLE plans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.plans TO anon;
GRANT ALL ON TABLE public.plans TO authenticated;
GRANT ALL ON TABLE public.plans TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.plans TO app_authenticated;


--
-- Name: TABLE platform_audit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.platform_audit TO anon;
GRANT ALL ON TABLE public.platform_audit TO authenticated;
GRANT ALL ON TABLE public.platform_audit TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_audit TO app_authenticated;


--
-- Name: TABLE product_cn_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_cn_seq TO anon;
GRANT ALL ON TABLE public.product_cn_seq TO authenticated;
GRANT ALL ON TABLE public.product_cn_seq TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_cn_seq TO app_authenticated;


--
-- Name: TABLE product_credit_note_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_credit_note_items TO anon;
GRANT ALL ON TABLE public.product_credit_note_items TO authenticated;
GRANT ALL ON TABLE public.product_credit_note_items TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_credit_note_items TO app_authenticated;


--
-- Name: TABLE product_credit_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_credit_notes TO anon;
GRANT ALL ON TABLE public.product_credit_notes TO authenticated;
GRANT ALL ON TABLE public.product_credit_notes TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_credit_notes TO app_authenticated;


--
-- Name: TABLE product_invoice_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_invoice_items TO anon;
GRANT ALL ON TABLE public.product_invoice_items TO authenticated;
GRANT ALL ON TABLE public.product_invoice_items TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_invoice_items TO app_authenticated;


--
-- Name: TABLE product_invoice_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_invoice_seq TO anon;
GRANT ALL ON TABLE public.product_invoice_seq TO authenticated;
GRANT ALL ON TABLE public.product_invoice_seq TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_invoice_seq TO app_authenticated;


--
-- Name: TABLE product_invoices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_invoices TO anon;
GRANT ALL ON TABLE public.product_invoices TO authenticated;
GRANT ALL ON TABLE public.product_invoices TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_invoices TO app_authenticated;


--
-- Name: TABLE product_stock_receipts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_stock_receipts TO anon;
GRANT ALL ON TABLE public.product_stock_receipts TO authenticated;
GRANT ALL ON TABLE public.product_stock_receipts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_stock_receipts TO app_authenticated;


--
-- Name: TABLE products; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.products TO anon;
GRANT ALL ON TABLE public.products TO authenticated;
GRANT ALL ON TABLE public.products TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.products TO app_authenticated;


--
-- Name: TABLE rfid_tags; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rfid_tags TO anon;
GRANT ALL ON TABLE public.rfid_tags TO authenticated;
GRANT ALL ON TABLE public.rfid_tags TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rfid_tags TO app_authenticated;


--
-- Name: TABLE role_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.role_templates TO anon;
GRANT ALL ON TABLE public.role_templates TO authenticated;
GRANT ALL ON TABLE public.role_templates TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.role_templates TO app_authenticated;


--
-- Name: TABLE shift_attendant_nozzles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shift_attendant_nozzles TO anon;
GRANT ALL ON TABLE public.shift_attendant_nozzles TO authenticated;
GRANT ALL ON TABLE public.shift_attendant_nozzles TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.shift_attendant_nozzles TO app_authenticated;


--
-- Name: TABLE shift_attendants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shift_attendants TO anon;
GRANT ALL ON TABLE public.shift_attendants TO authenticated;
GRANT ALL ON TABLE public.shift_attendants TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.shift_attendants TO app_authenticated;


--
-- Name: TABLE shift_definitions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shift_definitions TO anon;
GRANT ALL ON TABLE public.shift_definitions TO authenticated;
GRANT ALL ON TABLE public.shift_definitions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.shift_definitions TO app_authenticated;


--
-- Name: TABLE shift_nozzle_readings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shift_nozzle_readings TO anon;
GRANT ALL ON TABLE public.shift_nozzle_readings TO authenticated;
GRANT ALL ON TABLE public.shift_nozzle_readings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.shift_nozzle_readings TO app_authenticated;


--
-- Name: TABLE shift_reconciliation; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shift_reconciliation TO anon;
GRANT ALL ON TABLE public.shift_reconciliation TO authenticated;
GRANT ALL ON TABLE public.shift_reconciliation TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.shift_reconciliation TO app_authenticated;


--
-- Name: TABLE shifts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shifts TO anon;
GRANT ALL ON TABLE public.shifts TO authenticated;
GRANT ALL ON TABLE public.shifts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.shifts TO app_authenticated;


--
-- Name: TABLE station_group_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.station_group_members TO anon;
GRANT ALL ON TABLE public.station_group_members TO authenticated;
GRANT ALL ON TABLE public.station_group_members TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.station_group_members TO app_authenticated;


--
-- Name: TABLE station_groups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.station_groups TO anon;
GRANT ALL ON TABLE public.station_groups TO authenticated;
GRANT ALL ON TABLE public.station_groups TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.station_groups TO app_authenticated;


--
-- Name: TABLE station_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.station_settings TO anon;
GRANT ALL ON TABLE public.station_settings TO authenticated;
GRANT ALL ON TABLE public.station_settings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.station_settings TO app_authenticated;


--
-- Name: TABLE station_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.station_subscriptions TO anon;
GRANT ALL ON TABLE public.station_subscriptions TO authenticated;
GRANT ALL ON TABLE public.station_subscriptions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.station_subscriptions TO app_authenticated;


--
-- Name: TABLE station_users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.station_users TO anon;
GRANT ALL ON TABLE public.station_users TO authenticated;
GRANT ALL ON TABLE public.station_users TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.station_users TO app_authenticated;


--
-- Name: TABLE stations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stations TO anon;
GRANT ALL ON TABLE public.stations TO authenticated;
GRANT ALL ON TABLE public.stations TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stations TO app_authenticated;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.subscriptions TO anon;
GRANT ALL ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.subscriptions TO app_authenticated;


--
-- Name: TABLE superadmins; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.superadmins TO anon;
GRANT ALL ON TABLE public.superadmins TO authenticated;
GRANT ALL ON TABLE public.superadmins TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.superadmins TO app_authenticated;


--
-- Name: TABLE tally_ledger_map; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tally_ledger_map TO anon;
GRANT ALL ON TABLE public.tally_ledger_map TO authenticated;
GRANT ALL ON TABLE public.tally_ledger_map TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tally_ledger_map TO app_authenticated;


--
-- Name: TABLE tanks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tanks TO anon;
GRANT ALL ON TABLE public.tanks TO authenticated;
GRANT ALL ON TABLE public.tanks TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tanks TO app_authenticated;


--
-- Name: TABLE tank_book_stock; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tank_book_stock TO anon;
GRANT ALL ON TABLE public.tank_book_stock TO authenticated;
GRANT ALL ON TABLE public.tank_book_stock TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tank_book_stock TO app_authenticated;


--
-- Name: TABLE tank_calibration_charts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tank_calibration_charts TO anon;
GRANT ALL ON TABLE public.tank_calibration_charts TO authenticated;
GRANT ALL ON TABLE public.tank_calibration_charts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tank_calibration_charts TO app_authenticated;


--
-- Name: TABLE tank_reconciliation; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tank_reconciliation TO anon;
GRANT ALL ON TABLE public.tank_reconciliation TO authenticated;
GRANT ALL ON TABLE public.tank_reconciliation TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tank_reconciliation TO app_authenticated;


--
-- Name: TABLE template_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.template_permissions TO anon;
GRANT ALL ON TABLE public.template_permissions TO authenticated;
GRANT ALL ON TABLE public.template_permissions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.template_permissions TO app_authenticated;


--
-- Name: TABLE user_passkeys; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_passkeys TO anon;
GRANT ALL ON TABLE public.user_passkeys TO authenticated;
GRANT ALL ON TABLE public.user_passkeys TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_passkeys TO app_authenticated;


--
-- Name: TABLE user_role_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_role_assignments TO anon;
GRANT ALL ON TABLE public.user_role_assignments TO authenticated;
GRANT ALL ON TABLE public.user_role_assignments TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_role_assignments TO app_authenticated;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO app_authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO app_authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO app_authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict vmMUXLo5BvpAQMojladFOjd67okJwBQ3KUAtpW6PAaWuLHDIe54tchD4Wb6zjXO

