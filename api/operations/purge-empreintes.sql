DELETE FROM admin_login_attempts WHERE length(ip_hash) = 64;
UPDATE reservation_requests SET ip_hash = '' WHERE length(ip_hash) = 64;
