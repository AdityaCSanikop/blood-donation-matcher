-- ============================================================
-- 05_reference_data.sql  —  Compatibility lookup (all 64 pairs).
--
-- Red-cell rule: a donor can give to a recipient when the donor's red
-- cells carry no antigen (A, B, RhD) that the recipient lacks.
-- Instead of typing 64 rows by hand, the pairs are DERIVED from the
-- antigens of each group with INSERT ... SELECT over a cross join,
-- which makes the rule itself reviewable. 27 pairs come out compatible.
-- ============================================================
INSERT INTO Compatibility (donor_blood_group, recipient_blood_group, is_compatible)
SELECT dg.bg, rg.bg,
       (dg.has_a <= rg.has_a AND dg.has_b <= rg.has_b AND dg.has_rh <= rg.has_rh)
FROM (
    SELECT 'A+'  AS bg, 1 AS has_a, 0 AS has_b, 1 AS has_rh UNION ALL
    SELECT 'A-' , 1, 0, 0 UNION ALL
    SELECT 'B+' , 0, 1, 1 UNION ALL
    SELECT 'B-' , 0, 1, 0 UNION ALL
    SELECT 'AB+', 1, 1, 1 UNION ALL
    SELECT 'AB-', 1, 1, 0 UNION ALL
    SELECT 'O+' , 0, 0, 1 UNION ALL
    SELECT 'O-' , 0, 0, 0
) dg
CROSS JOIN (
    SELECT 'A+'  AS bg, 1 AS has_a, 0 AS has_b, 1 AS has_rh UNION ALL
    SELECT 'A-' , 1, 0, 0 UNION ALL
    SELECT 'B+' , 0, 1, 1 UNION ALL
    SELECT 'B-' , 0, 1, 0 UNION ALL
    SELECT 'AB+', 1, 1, 1 UNION ALL
    SELECT 'AB-', 1, 1, 0 UNION ALL
    SELECT 'O+' , 0, 0, 1 UNION ALL
    SELECT 'O-' , 0, 0, 0
) rg;
