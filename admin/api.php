<?php
/** Same-origin CMS API. No default account and no browser-side authentication. */
declare(strict_types=1);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
require_once __DIR__ . '/lib.php';

header_remove('X-Powered-By');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: same-origin');
header('Content-Type: application/json; charset=utf-8');

try {
    $action = $_GET['action'] ?? '';
    if (!is_string($action)) throw new EtehadyarHttpError(400, 'عملیات معتبر نیست.');
    $methods = ['state' => 'GET', 'login' => 'POST', 'logout' => 'POST', 'get_data' => 'GET',
        'save_data' => 'POST', 'change_password' => 'POST', 'download_zip' => 'GET'];
    if (!isset($methods[$action])) throw new EtehadyarHttpError(404, 'عملیات پیدا نشد.');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== $methods[$action]) {
        header('Allow: ' . $methods[$action]);
        throw new EtehadyarHttpError(405, 'روش درخواست مجاز نیست.');
    }
    etehadyar_start_session();
    $credentials = etehadyar_credentials();

    if ($action === 'state') {
        $authenticated = etehadyar_authenticated($credentials);
        etehadyar_json(['success' => true, 'authenticated' => $authenticated,
            'setupRequired' => $credentials === null, 'csrfToken' => $_SESSION['csrf'],
            'username' => $authenticated ? $_SESSION['user'] : null]);
        exit;
    }

    if ($action === 'login') {
        etehadyar_require_csrf();
        if ($credentials === null) throw new EtehadyarHttpError(503, 'مدیر هنوز راه‌اندازی نشده است؛ راهنمای نصب را دنبال کنید.');
        $input = etehadyar_input();
        $username = etehadyar_text($input['username'] ?? '', 'نام کاربری', 80);
        $password = etehadyar_text($input['password'] ?? '', 'رمز عبور', 256);
        etehadyar_lock('login-attempts', function () use ($credentials, $username, $password) {
            $retry = etehadyar_rate_limit();
            if ($retry > 0) {
                header('Retry-After: ' . $retry);
                throw new EtehadyarHttpError(429, 'تلاش‌های ورود بیش از حد مجاز است؛ ۱۵ دقیقه بعد دوباره امتحان کنید.');
            }
            // Verify the hash even for a wrong username, to avoid a username timing oracle.
            $passwordMatches = strlen($password) <= 72 && password_verify($password, $credentials['passwordHash']);
            if (!hash_equals($credentials['username'], trim($username)) || !$passwordMatches) {
                $retry = etehadyar_rate_limit(true);
                if ($retry > 0) {
                    header('Retry-After: ' . $retry);
                    throw new EtehadyarHttpError(429, 'تلاش‌های ورود بیش از حد مجاز است؛ ۱۵ دقیقه بعد دوباره امتحان کنید.');
                }
                throw new EtehadyarHttpError(401, 'نام کاربری یا رمز عبور نامعتبر است.');
            }
            etehadyar_rate_limit(false, true);
        });
        if (!session_regenerate_id(true)) throw new EtehadyarHttpError(503, 'ایجاد نشست امن انجام نشد.');
        $_SESSION['user'] = $credentials['username'];
        $_SESSION['credential_revision'] = $credentials['revision'];
        $_SESSION['created_at'] = $_SESSION['last_seen'] = time();
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        etehadyar_json(['success' => true, 'csrfToken' => $_SESSION['csrf'], 'username' => $_SESSION['user']]);
        exit;
    }

    etehadyar_require_auth($credentials);
    if ($methods[$action] === 'POST') etehadyar_require_csrf();

    if ($action === 'logout') {
        $_SESSION = [];
        $parameters = session_get_cookie_params();
        setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $parameters['path'],
            'secure' => $parameters['secure'], 'httponly' => true, 'samesite' => 'Strict']);
        session_destroy();
        etehadyar_json(['success' => true]);
        exit;
    }

    if ($action === 'get_data') {
        etehadyar_json(['success' => true] + etehadyar_read_data());
        exit;
    }

    if ($action === 'save_data') {
        $input = etehadyar_input();
        $data = etehadyar_validate_data($input['data'] ?? null);
        $revision = $input['revision'] ?? '';
        if (!is_string($revision) || !preg_match('/\A[a-f0-9]{64}\z/', $revision)) {
            throw new EtehadyarHttpError(400, 'شناسه نسخه داده معتبر نیست؛ اطلاعات را دوباره بارگذاری کنید.');
        }
        $saved = etehadyar_lock('site-data', function () use ($data, $revision) {
            $current = etehadyar_read_data();
            if (!hash_equals($current['revision'], $revision)) {
                throw new EtehadyarHttpError(409, 'اطلاعات سایت در نشست دیگری تغییر کرده است؛ قبل از ذخیره دوباره بارگذاری کنید.');
            }
            $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
            etehadyar_atomic_write(etehadyar_root() . '/data/site_data.json', $json, 0644);
            return ['data' => $data, 'revision' => hash('sha256', $json)];
        });
        etehadyar_json(['success' => true, 'message' => 'تغییرات ذخیره و منتشر شد.'] + $saved);
        exit;
    }

    if ($action === 'change_password') {
        $input = etehadyar_input();
        $newUser = etehadyar_text($input['username'] ?? '', 'نام کاربری', 80);
        $newPass = etehadyar_text($input['password'] ?? '', 'رمز جدید', 72);
        $currentPass = etehadyar_text($input['currentPassword'] ?? '', 'رمز فعلی', 256);
        if (!etehadyar_valid_username($newUser)) throw new EtehadyarHttpError(400, 'نام کاربری باید ۳ تا ۸۰ حرف لاتین، عدد یا _ . @ - باشد.');
        etehadyar_validate_password($newPass);
        $newCredentials = etehadyar_lock('credentials', function () use ($newUser, $newPass, $currentPass) {
            $current = etehadyar_credentials();
            if (!$current || strlen($currentPass) > 72 || !password_verify($currentPass, $current['passwordHash'])) {
                throw new EtehadyarHttpError(401, 'رمز فعلی نامعتبر است.');
            }
            $hash = password_hash($newPass, PASSWORD_DEFAULT);
            if ($hash === false) throw new EtehadyarHttpError(503, 'ذخیره رمز امن امکان‌پذیر نیست.');
            $next = ['username' => $newUser, 'passwordHash' => $hash, 'revision' => bin2hex(random_bytes(16))];
            etehadyar_atomic_write(etehadyar_private_dir() . '/credentials.json', json_encode($next, JSON_THROW_ON_ERROR));
            return $next;
        });
        session_regenerate_id(true);
        $_SESSION['user'] = $newCredentials['username'];
        $_SESSION['credential_revision'] = $newCredentials['revision'];
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        etehadyar_json(['success' => true, 'csrfToken' => $_SESSION['csrf'], 'username' => $_SESSION['user'],
            'message' => 'رمز به‌صورت امن ذخیره شد و نشست‌های دیگر باطل شدند.']);
        exit;
    }

    if ($action === 'download_zip') {
        $zip = etehadyar_lock('site-data', function () { return etehadyar_public_zip(); });
        session_write_close();
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="etehadyar-site-backup.zip"');
        header('Content-Length: ' . strlen($zip));
        echo $zip;
        exit;
    }
} catch (EtehadyarHttpError $error) {
    etehadyar_json(['success' => false, 'error' => $error->getMessage()], $error->status);
} catch (Throwable $error) {
    // Never send credentials, paths, stack traces, or request bodies to the browser.
    error_log('Etehadyar CMS: ' . get_class($error) . ': ' . $error->getMessage());
    etehadyar_json(['success' => false, 'error' => 'خطای داخلی؛ تغییری منتشر نشده است. تنظیمات هاست را بررسی کنید.'], 500);
}
