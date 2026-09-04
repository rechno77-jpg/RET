CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  doc_type text NOT NULL,
  doc_number text NOT NULL UNIQUE,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  ref_code text NOT NULL UNIQUE,
  referrer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  account_status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_referrer_idx ON users(referrer_user_id);

CREATE TABLE IF NOT EXISTS wallets (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  asset text NOT NULL DEFAULT 'USDT',
  balance numeric(24,8) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  principal numeric(24,8) NOT NULL CHECK (principal > 0),
  monthly_rate numeric(10,8) NOT NULL DEFAULT 0.05 CHECK (monthly_rate >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_profit_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS investments_user_idx ON investments(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  amount numeric(24,8) NOT NULL,
  reference_id uuid,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_ledger_user_idx ON wallet_ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric(24,8) NOT NULL CHECK (amount > 0),
  network text NOT NULL DEFAULT 'TRC20',
  txid text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deposits_user_idx ON deposits(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric(24,8) NOT NULL CHECK (amount > 0),
  fee numeric(24,8) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  net numeric(24,8) NOT NULL CHECK (net >= 0),
  network text NOT NULL DEFAULT 'TRC20',
  address text NOT NULL,
  txid text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS withdrawals_user_idx ON withdrawals(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  start_price numeric(30,10),
  end_price numeric(30,10),
  result text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed'))
);
CREATE INDEX IF NOT EXISTS reservations_user_idx ON reservations(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS wheel_state (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chances integer NOT NULL DEFAULT 0 CHECK (chances >= 0),
  last_prize text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wheel_spins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prize text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wheel_spins_user_idx ON wheel_spins(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS session (
  sid varchar NOT NULL COLLATE "default" PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON session(expire);


-- RET real notification triggers.
-- These fire regardless of which admin/backend process updates a transaction status.
CREATE OR REPLACE FUNCTION ret_notify_deposit_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF lower(NEW.status) IN ('approved','confirmed','completed','success','paid') THEN
      INSERT INTO notifications(user_id,type,title,message)
      VALUES(
        NEW.user_id,
        'deposit',
        'واریز تأیید شد',
        'واریز ' || trim(to_char(NEW.amount,'FM999999999999990.########')) || ' USDT با موفقیت تأیید شد.'
      );
    ELSIF lower(NEW.status) IN ('rejected','failed','cancelled','canceled') THEN
      INSERT INTO notifications(user_id,type,title,message)
      VALUES(
        NEW.user_id,
        'deposit',
        'واریز تأیید نشد',
        'وضعیت واریز ' || trim(to_char(NEW.amount,'FM999999999999990.########')) || ' USDT رد/ناموفق ثبت شد.'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ret_notify_deposit_status ON deposits;
CREATE TRIGGER trg_ret_notify_deposit_status
AFTER UPDATE OF status ON deposits
FOR EACH ROW EXECUTE FUNCTION ret_notify_deposit_status();

CREATE OR REPLACE FUNCTION ret_notify_withdraw_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF lower(NEW.status) IN ('approved','confirmed','completed','success','paid') THEN
      INSERT INTO notifications(user_id,type,title,message)
      VALUES(
        NEW.user_id,
        'withdraw',
        'برداشت انجام شد',
        'برداشت ' || trim(to_char(NEW.net,'FM999999999999990.########')) || ' USDT با موفقیت انجام شد.'
      );
    ELSIF lower(NEW.status) IN ('rejected','failed','cancelled','canceled') THEN
      INSERT INTO notifications(user_id,type,title,message)
      VALUES(
        NEW.user_id,
        'withdraw',
        'برداشت انجام نشد',
        'درخواست برداشت ' || trim(to_char(NEW.amount,'FM999999999999990.########')) || ' USDT رد/ناموفق ثبت شد.'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ret_notify_withdraw_status ON withdrawals;
CREATE TRIGGER trg_ret_notify_withdraw_status
AFTER UPDATE OF status ON withdrawals
FOR EACH ROW EXECUTE FUNCTION ret_notify_withdraw_status();


-- RET advanced account security
CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device TEXT NOT NULL DEFAULT 'دستگاه',
  browser TEXT NOT NULL DEFAULT 'مرورگر',
  os TEXT NOT NULL DEFAULT 'نامشخص',
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, revoked_at, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS login_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  identifier TEXT,
  ip TEXT,
  device TEXT,
  browser TEXT,
  os TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
  identifier TEXT NOT NULL,
  ip TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  PRIMARY KEY(identifier, ip)
);


-- RET real admin panel
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='users_role_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check CHECK (role IN ('user','admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_user_id,created_at DESC);


-- ============================================================
-- RET UNIFIED FINANCIAL LEDGER
-- wallet_ledger is the source of truth for every balance change.
-- wallets.balance is only a fast materialized projection.
-- ============================================================

ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS entry_key TEXT;
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS balance_after NUMERIC(24,8);
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_entry_key_uidx
  ON wallet_ledger(entry_key)
  WHERE entry_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS wallet_ledger_reference_idx
  ON wallet_ledger(reference_id);

-- Bring pre-upgrade accounts into ledger parity without changing their balance.
-- Any legacy difference becomes one explicit opening_balance audit entry.
DO $$
DECLARE
  r RECORD;
  delta NUMERIC(24,8);
BEGIN
  FOR r IN
    SELECT
      w.user_id,
      w.balance AS wallet_balance,
      COALESCE(SUM(l.amount),0)::numeric(24,8) AS ledger_balance
    FROM wallets w
    LEFT JOIN wallet_ledger l ON l.user_id=w.user_id
    GROUP BY w.user_id,w.balance
  LOOP
    delta := (r.wallet_balance-r.ledger_balance)::numeric(24,8);
    IF delta <> 0 THEN
      INSERT INTO wallet_ledger(
        user_id,type,amount,description,entry_key,balance_after,metadata
      )
      VALUES(
        r.user_id,
        'opening_balance',
        delta,
        'تطبیق موجودی پیش از یکپارچه‌سازی Ledger',
        'opening_balance:'||r.user_id::text,
        r.wallet_balance,
        jsonb_build_object('migration','unified_finance_v1')
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- Historical rows receive a deterministic running balance.
WITH running AS (
  SELECT
    id,
    SUM(amount) OVER (
      PARTITION BY user_id
      ORDER BY id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )::numeric(24,8) AS running_balance
  FROM wallet_ledger
)
UPDATE wallet_ledger l
SET balance_after=running.running_balance
FROM running
WHERE l.id=running.id
  AND l.balance_after IS NULL;

-- One atomic posting function for ALL financial balance mutations.
CREATE OR REPLACE FUNCTION ret_post_ledger(
  p_user_id UUID,
  p_type TEXT,
  p_amount NUMERIC,
  p_reference_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_entry_key TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  ledger_id BIGINT,
  posted_amount NUMERIC(24,8),
  new_balance NUMERIC(24,8),
  posted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  existing wallet_ledger%ROWTYPE;
  current_balance NUMERIC(24,8);
  next_balance NUMERIC(24,8);
  created wallet_ledger%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_USER_REQUIRED' USING ERRCODE='P0001';
  END IF;

  IF p_type IS NULL OR btrim(p_type)='' THEN
    RAISE EXCEPTION 'LEDGER_TYPE_REQUIRED' USING ERRCODE='P0001';
  END IF;

  IF p_amount IS NULL OR p_amount=0 THEN
    RAISE EXCEPTION 'LEDGER_ZERO_AMOUNT' USING ERRCODE='P0001';
  END IF;

  -- Idempotency: the same business event can never post twice.
  IF p_entry_key IS NOT NULL AND btrim(p_entry_key)<>'' THEN
    SELECT * INTO existing
    FROM wallet_ledger
    WHERE entry_key=p_entry_key;

    IF FOUND THEN
      IF existing.user_id<>p_user_id
         OR existing.type<>p_type
         OR existing.amount<>p_amount THEN
        RAISE EXCEPTION 'LEDGER_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';
      END IF;

      RETURN QUERY
      SELECT existing.id,existing.amount,existing.balance_after,existing.created_at;
      RETURN;
    END IF;
  END IF;

  INSERT INTO wallets(user_id,asset,balance)
  VALUES(p_user_id,'USDT',0)
  ON CONFLICT(user_id) DO NOTHING;

  SELECT balance
  INTO current_balance
  FROM wallets
  WHERE user_id=p_user_id
  FOR UPDATE;

  next_balance := round((current_balance+p_amount)::numeric,8)::numeric(24,8);

  IF next_balance < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING ERRCODE='P0001';
  END IF;

  -- The guard triggers below only allow these mutations while this local flag is on.
  PERFORM set_config('ret.ledger_write','on',true);

  UPDATE wallets
  SET balance=next_balance,updated_at=now()
  WHERE user_id=p_user_id;

  INSERT INTO wallet_ledger(
    user_id,type,amount,reference_id,description,entry_key,balance_after,metadata
  )
  VALUES(
    p_user_id,
    p_type,
    p_amount::numeric(24,8),
    p_reference_id,
    p_description,
    NULLIF(btrim(p_entry_key),''),
    next_balance,
    COALESCE(p_metadata,'{}'::jsonb)
  )
  RETURNING * INTO created;

  PERFORM set_config('ret.ledger_write','off',true);

  RETURN QUERY
  SELECT created.id,created.amount,created.balance_after,created.created_at;
END;
$$;

-- Direct balance edits are forbidden.
CREATE OR REPLACE FUNCTION ret_guard_wallet_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF COALESCE(NEW.balance,0)<>0
       AND COALESCE(current_setting('ret.ledger_write',true),'off')<>'on' THEN
      RAISE EXCEPTION 'WALLET_BALANCE_MUST_USE_LEDGER' USING ERRCODE='P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.balance IS DISTINCT FROM OLD.balance
     AND COALESCE(current_setting('ret.ledger_write',true),'off')<>'on' THEN
    RAISE EXCEPTION 'WALLET_BALANCE_MUST_USE_LEDGER' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ret_guard_wallet_balance ON wallets;
DROP TRIGGER IF EXISTS trg_ret_guard_wallet_insert ON wallets;
DROP TRIGGER IF EXISTS trg_ret_guard_wallet_update ON wallets;

CREATE TRIGGER trg_ret_guard_wallet_insert
BEFORE INSERT ON wallets
FOR EACH ROW EXECUTE FUNCTION ret_guard_wallet_balance();

CREATE TRIGGER trg_ret_guard_wallet_update
BEFORE UPDATE OF balance ON wallets
FOR EACH ROW EXECUTE FUNCTION ret_guard_wallet_balance();

-- Ledger is append-only and can only be appended by ret_post_ledger.
CREATE OR REPLACE FUNCTION ret_guard_ledger_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF COALESCE(current_setting('ret.ledger_write',true),'off')<>'on' THEN
      RAISE EXCEPTION 'LEDGER_WRITE_MUST_USE_POST_FUNCTION' USING ERRCODE='P0001';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'LEDGER_IS_IMMUTABLE' USING ERRCODE='P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_ret_guard_ledger_insert ON wallet_ledger;
CREATE TRIGGER trg_ret_guard_ledger_insert
BEFORE INSERT ON wallet_ledger
FOR EACH ROW EXECUTE FUNCTION ret_guard_ledger_write();

DROP TRIGGER IF EXISTS trg_ret_guard_ledger_immutable ON wallet_ledger;
CREATE TRIGGER trg_ret_guard_ledger_immutable
BEFORE UPDATE OR DELETE ON wallet_ledger
FOR EACH ROW EXECUTE FUNCTION ret_guard_ledger_write();

-- RET 2FA + RISK
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS risk_events(
 id BIGSERIAL PRIMARY KEY,
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 event_type TEXT NOT NULL,risk_score INTEGER NOT NULL DEFAULT 0,
 severity TEXT NOT NULL DEFAULT 'low',reason TEXT NOT NULL,ip TEXT,
 device_fingerprint TEXT,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 reviewed_at TIMESTAMPTZ,reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_risk_events_open ON risk_events(reviewed_at,severity,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_user ON risk_events(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS user_risk_state(
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 risk_score INTEGER NOT NULL DEFAULT 0,flagged BOOLEAN NOT NULL DEFAULT false,
 reason TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_fingerprints(
 id BIGSERIAL PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL,ip TEXT,user_agent TEXT,
 first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 seen_count INTEGER NOT NULL DEFAULT 1,UNIQUE(user_id,fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_login_fp_ip ON login_fingerprints(ip,last_seen_at DESC);


-- ============================================================
-- MERGED SECURITY / MONITORING ADDITIONS
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS password_reset_tokens(
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_expiry ON password_reset_tokens(expires_at);

CREATE TABLE IF NOT EXISTS system_events(
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info',
  event TEXT NOT NULL,
  message TEXT,
  request_id TEXT,
  ip TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_events_level_time ON system_events(level,created_at DESC);
