BEGIN;
CREATE TABLE IF NOT EXISTS public.hes_control_points (
  device_id text NOT NULL CHECK (device_id ~ '^[0-9]{1,20}$'),
  ioa integer NOT NULL CHECK (ioa BETWEEN 0 AND 16777215),
  command_type text NOT NULL CHECK (command_type IN ('C_SC_NA_1', 'C_SE_NC_1')),
  min_value double precision,
  max_value double precision,
  common_address integer CHECK (common_address BETWEEN 0 AND 65535),
  enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (device_id, ioa),
  CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);
INSERT INTO public.hes_control_points (device_id, ioa, command_type, min_value, max_value, enabled)
VALUES ('366502', 1, 'C_SC_NA_1', 1, 1, true), ('366502', 2, 'C_SC_NA_1', 1, 1, true),
       ('366502', 3, 'C_SC_NA_1', 1, 1, true), ('366502', 4, 'C_SC_NA_1', 1, 1, true)
ON CONFLICT (device_id, ioa) DO NOTHING;
COMMIT;
