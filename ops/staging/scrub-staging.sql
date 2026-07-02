-- ============================================================================
-- Run on STAGING ONLY, immediately after loading prod data.
-- Masks personal / customer PII and resets every login to a known password.
-- Business identifiers that are needed to navigate staging (station names,
-- staff names/phones so people can log in) are intentionally KEPT — outbound
-- messaging must be neutralised at the env level, not by scrambling logins.
--
-- Resilient: each mask runs independently; a table/column missing on staging is
-- skipped with a NOTICE instead of aborting the whole scrub.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Every user's password -> 'staging123' (bcrypt $2a$, verifies with Node bcrypt).
UPDATE users SET password_hash = crypt('staging123', gen_salt('bf', 10)),
                 must_change_password = false;

DO $$
DECLARE
  stmts text[] := ARRAY[
    -- Credit customers (the main PII surface: PAN, GST, phone, email, address)
    $s$UPDATE corporate_accounts SET company_name='Customer '||left(id::text,8),
         pan=NULL, gst_number=NULL, contact_phone=NULL, contact_email=NULL,
         email=NULL, address=NULL$s$,
    $s$UPDATE corporate_drivers SET name='Driver '||left(id::text,8), phone=NULL$s$,
    -- Banking / payment handles
    $s$UPDATE shift_attendants SET bank_account=NULL, upi_vpa=NULL$s$,
    $s$UPDATE cash_deposits SET bank_account=NULL$s$,
    $s$UPDATE corporate_receipts SET reference_no=NULL, remarks=NULL$s$,
    -- Vehicle numbers / UPI refs on fills
    $s$UPDATE dispense_events SET vehicle_number=NULL, upi_ref=NULL$s$,
    -- Walk-in / dry-stock customer names
    $s$UPDATE product_invoices SET customer_name='Customer'$s$,
    $s$UPDATE product_credit_notes SET customer_name='Customer'$s$,
    -- Marketing leads
    $s$UPDATE leads SET name='Lead '||left(id::text,8), phone='0000000000', email=NULL$s$,
    -- Owner contact / station tax ids in settings
    $s$UPDATE station_settings SET owner_email=NULL, pan=NULL, address=NULL$s$,
    $s$UPDATE subscriptions SET billing_email=NULL$s$,
    -- Audit IPs and stored meter photos (may contain plates/faces; also bulky)
    $s$UPDATE audit_log SET ip_address=NULL$s$,
    $s$UPDATE meter_photos SET image_base64=NULL$s$
  ];
  s text;
BEGIN
  FOREACH s IN ARRAY stmts LOOP
    BEGIN
      EXECUTE s;
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      RAISE NOTICE 'scrub skipped (missing table/column): %', s;
    END;
  END LOOP;
END $$;
