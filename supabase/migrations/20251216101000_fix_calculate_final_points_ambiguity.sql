-- Fix ambiguous calls to calculate_final_points(...)
-- When both versions exist:
--  - calculate_final_points(int, numeric, numeric, numeric)
--  - calculate_final_points(int, numeric, numeric, numeric, int DEFAULT 0)
-- a 4-arg call becomes ambiguous. Keep the 5-arg version (with DEFAULT) and drop the 4-arg one.

DROP FUNCTION IF EXISTS public.calculate_final_points(integer, numeric, numeric, numeric);

