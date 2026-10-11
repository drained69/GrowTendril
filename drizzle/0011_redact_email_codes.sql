UPDATE email_log
SET subject = regexp_replace(subject, '\m[0-9]{6}\M', '[code]', 'g'),
    error = regexp_replace(error, '\m[0-9]{6}\M', '[code]', 'g')
WHERE kind IN ('verify_code', 'reset_code');
