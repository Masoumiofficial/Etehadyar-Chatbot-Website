<?php
/** Shared, fail-closed CMS helpers. Compatible with PHP 7.4+. */
declare(strict_types=1);

const ETEHADYAR_MAX_BODY = 2097152;
const ETEHADYAR_IDLE_TIMEOUT = 1800;
const ETEHADYAR_SESSION_LIFETIME = 28800;

final class EtehadyarHttpError extends RuntimeException {
    public $status;
    public function __construct(int $status, string $message) {
        parent::__construct($message);
        $this->status = $status;
    }
}

function etehadyar_root(): string {
    return dirname(__DIR__);
}

function etehadyar_is_within(string $path, string $directory): bool {
    $directory = rtrim(str_replace('\\', '/', $directory), '/');
    $path = str_replace('\\', '/', $path);
    return $path === $directory || strpos($path, $directory . '/') === 0;
}

function etehadyar_private_dir(): string {
    static $directory;
    if ($directory !== null) return $directory;
    $root = realpath(etehadyar_root());
    $documentRoot = isset($_SERVER['DOCUMENT_ROOT']) ? realpath($_SERVER['DOCUMENT_ROOT']) : false;
    $path = getenv('ETEHADYAR_PRIVATE_DIR') ?: dirname($documentRoot ?: $root) . '/.etehadyar-private';
    if (!preg_match('~^(?:/|[A-Za-z]:[\\\\/])~', $path)) {
        throw new EtehadyarHttpError(503, 'مسیر فضای خصوصی مدیر باید مطلق و خارج از روت عمومی باشد.');
    }
    if (in_array('..', explode('/', str_replace('\\', '/', $path)), true)) {
        throw new EtehadyarHttpError(503, 'مسیر فضای خصوصی نباید بخش نسبی داشته باشد.');
    }
    $ancestor = $path;
    while (!file_exists($ancestor) && dirname($ancestor) !== $ancestor) $ancestor = dirname($ancestor);
    $canonicalAncestor = realpath($ancestor);
    if (etehadyar_is_within($path, $root) || ($documentRoot && etehadyar_is_within($path, $documentRoot))
        || ($canonicalAncestor && (etehadyar_is_within($canonicalAncestor, $root) || ($documentRoot && etehadyar_is_within($canonicalAncestor, $documentRoot))))) {
        throw new EtehadyarHttpError(503, 'اطلاعات مدیر نباید داخل پوشه عمومی وب ذخیره شود.');
    }
    if (!is_dir($path) && !@mkdir($path, 0700, true) && !is_dir($path)) {
        throw new EtehadyarHttpError(503, 'فضای خصوصی مدیر قابل ایجاد نیست؛ تنظیمات هاست را بررسی کنید.');
    }
    $resolved = realpath($path);
    if (!$resolved || etehadyar_is_within($resolved, $root) || ($documentRoot && etehadyar_is_within($resolved, $documentRoot))) {
        throw new EtehadyarHttpError(503, 'اطلاعات مدیر نباید داخل پوشه عمومی وب ذخیره شود.');
    }
    @chmod($resolved, 0700);
    $directory = $resolved;
    return $directory;
}

function etehadyar_json(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

/** Atomic replacement: failed writes never publish partial content. */
function etehadyar_atomic_write(string $path, string $contents, int $mode = 0600): void {
    if (!is_writable(dirname($path))) throw new EtehadyarHttpError(503, 'فضای ذخیره‌سازی قابل نوشتن نیست.');
    $temporary = @tempnam(dirname($path), '.etehadyar-');
    if ($temporary === false) throw new EtehadyarHttpError(503, 'فضای ذخیره‌سازی قابل نوشتن نیست.');
    try {
        if (!@chmod($temporary, $mode) || @file_put_contents($temporary, $contents, LOCK_EX) !== strlen($contents)) {
            throw new EtehadyarHttpError(503, 'ذخیره‌سازی کامل نشد؛ تغییری منتشر نشده است.');
        }
        if (!@rename($temporary, $path)) throw new EtehadyarHttpError(503, 'انتشار تغییرات انجام نشد.');
    } finally {
        if (file_exists($temporary)) @unlink($temporary);
    }
}

function etehadyar_lock(string $name, callable $callback) {
    $path = etehadyar_private_dir() . '/' . $name . '.lock';
    $handle = @fopen($path, 'c+');
    if (!$handle) throw new EtehadyarHttpError(503, 'فضای خصوصی مدیر قابل نوشتن نیست.');
    @chmod($path, 0600);
    try {
        if (!flock($handle, LOCK_EX)) throw new EtehadyarHttpError(503, 'قفل ذخیره‌سازی در دسترس نیست.');
        return $callback();
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

function etehadyar_valid_username(string $username): bool {
    return preg_match('/\A[A-Za-z0-9_.@-]{3,80}\z/', $username) === 1;
}

function etehadyar_validate_password(string $password): void {
    // PASSWORD_DEFAULT currently uses bcrypt: do not silently truncate past 72 bytes.
    if (strlen($password) > 72 || preg_match('/\A.{12,72}\z/us', $password) !== 1 || trim($password) === '') {
        throw new EtehadyarHttpError(400, 'رمز عبور باید حداقل ۱۲ کاراکتر و حداکثر ۷۲ بایت باشد.');
    }
}

function etehadyar_credentials(): ?array {
    $path = etehadyar_private_dir() . '/credentials.json';
    if (!file_exists($path)) {
        $username = getenv('ETEHADYAR_ADMIN_USERNAME') ?: '';
        $hash = getenv('ETEHADYAR_ADMIN_PASSWORD_HASH') ?: '';
        if ($username === '' && $hash === '') return null;
        if (!etehadyar_valid_username($username) || (password_get_info($hash)['algoName'] ?? 'unknown') === 'unknown') {
            throw new EtehadyarHttpError(503, 'پیکربندی اولیه مدیر معتبر نیست.');
        }
        etehadyar_lock('credentials', function () use ($path, $username, $hash) {
            if (!file_exists($path)) {
                etehadyar_atomic_write($path, json_encode([
                    'username' => $username, 'passwordHash' => $hash,
                    'revision' => bin2hex(random_bytes(16))
                ], JSON_THROW_ON_ERROR));
            }
        });
    }
    $contents = @file_get_contents($path);
    $credentials = $contents !== false ? json_decode($contents, true) : null;
    if (!is_array($credentials) || !isset($credentials['username'], $credentials['passwordHash'], $credentials['revision'])
        || !is_string($credentials['username']) || !is_string($credentials['passwordHash']) || !is_string($credentials['revision'])
        || !preg_match('/\A[a-f0-9]{32}\z/', $credentials['revision'])
        || !etehadyar_valid_username($credentials['username'])
        || (password_get_info($credentials['passwordHash'])['algoName'] ?? 'unknown') === 'unknown') {
        throw new EtehadyarHttpError(503, 'اطلاعات مدیر معتبر نیست؛ راهنمای راه‌اندازی را بررسی کنید.');
    }
    return $credentials;
}

function etehadyar_start_session(): void {
    $sessions = etehadyar_private_dir() . '/sessions';
    if (!is_dir($sessions) && !@mkdir($sessions, 0700) && !is_dir($sessions)) {
        throw new EtehadyarHttpError(503, 'ذخیره نشست مدیریت امکان‌پذیر نیست.');
    }
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    if (getenv('ETEHADYAR_TRUST_PROXY') === '1' && ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') $secure = true;
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) ETEHADYAR_SESSION_LIFETIME);
    session_save_path($sessions);
    session_name('etehadyar_admin_session');
    // Restrict to this installation, including deployments under a subdirectory.
    $script = $_SERVER['SCRIPT_NAME'] ?? '/admin/api.php';
    $cookiePath = rtrim(str_replace('\\', '/', dirname($script)), '/') . '/';
    session_set_cookie_params([
        'lifetime' => 0, 'path' => $cookiePath, 'secure' => $secure,
        'httponly' => true, 'samesite' => 'Strict'
    ]);
    if (!session_start()) throw new EtehadyarHttpError(503, 'نشست مدیریت شروع نشد.');
    if (!isset($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function etehadyar_authenticated(?array $credentials): bool {
    $now = time();
    $valid = $credentials && isset($_SESSION['user'], $_SESSION['credential_revision'], $_SESSION['last_seen'], $_SESSION['created_at'])
        && $_SESSION['user'] === $credentials['username']
        && hash_equals($credentials['revision'], (string) $_SESSION['credential_revision'])
        && $now - $_SESSION['last_seen'] < ETEHADYAR_IDLE_TIMEOUT
        && $now - $_SESSION['created_at'] < ETEHADYAR_SESSION_LIFETIME;
    if ($valid) {
        $_SESSION['last_seen'] = $now;
        return true;
    }
    unset($_SESSION['user'], $_SESSION['credential_revision'], $_SESSION['last_seen'], $_SESSION['created_at']);
    return false;
}

function etehadyar_require_auth(?array $credentials): void {
    if (!etehadyar_authenticated($credentials)) throw new EtehadyarHttpError(401, 'نشست معتبر ندارید؛ دوباره وارد پنل شوید.');
}

function etehadyar_require_csrf(): void {
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($token) || !isset($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $token)) {
        throw new EtehadyarHttpError(403, 'توکن امنیتی معتبر نیست؛ صفحه را تازه کنید.');
    }
}

function etehadyar_input(): array {
    $type = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if ($type !== 'application/json') throw new EtehadyarHttpError(415, 'درخواست باید JSON باشد.');
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > ETEHADYAR_MAX_BODY) throw new EtehadyarHttpError(413, 'حجم درخواست بیش از حد مجاز است.');
    $raw = file_get_contents('php://input', false, null, 0, ETEHADYAR_MAX_BODY + 1);
    if ($raw === false || strlen($raw) > ETEHADYAR_MAX_BODY) throw new EtehadyarHttpError(413, 'حجم درخواست بیش از حد مجاز است.');
    try {
        $value = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException $error) {
        throw new EtehadyarHttpError(400, 'ساختار JSON معتبر نیست.');
    }
    if (!is_array($value) || substr(ltrim($raw), 0, 1) !== '{') throw new EtehadyarHttpError(400, 'بدنه درخواست باید یک شیء JSON باشد.');
    return $value;
}

/** Persistent rate limiting, independent of cookies or browser storage. */
function etehadyar_rate_limit(bool $failed = false, bool $reset = false): int {
    $address = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    // Forwarded client IPs are only trusted when the operator opts into a trusted proxy.
    if (getenv('ETEHADYAR_TRUST_PROXY') === '1') {
        $forwarded = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '')[0]);
        if (filter_var($forwarded, FILTER_VALIDATE_IP)) $address = $forwarded;
    }
    $key = hash('sha256', $address);
    return etehadyar_lock('login-rate', function () use ($key, $failed, $reset) {
        $path = etehadyar_private_dir() . '/login-rate.json';
        $state = file_exists($path) ? json_decode((string) file_get_contents($path), true) : [];
        if (!is_array($state)) throw new EtehadyarHttpError(503, 'سامانه محدودسازی ورود در دسترس نیست.');
        $now = time();
        foreach ($state as $id => $entry) {
            if (!is_array($entry) || ($entry['until'] ?? 0) <= $now) unset($state[$id]);
        }
        $entry = $state[$key] ?? ['count' => 0, 'until' => $now + 900];
        if ($reset) unset($state[$key]);
        elseif ($failed) {
            $entry['count']++;
            $state[$key] = $entry;
        }
        if (count($state) > 10000) throw new EtehadyarHttpError(503, 'سامانه ورود موقتاً شلوغ است.');
        if ($failed || $reset) etehadyar_atomic_write($path, json_encode($state, JSON_THROW_ON_ERROR));
        return !$reset && $entry['count'] >= 5 ? max(1, $entry['until'] - $now) : 0;
    });
}

function etehadyar_text($value, string $field, int $max, bool $required = true): string {
    if (!is_string($value) || strlen($value) > $max * 4 || preg_match('//u', $value) !== 1
        || ($required && trim($value) === '')) {
        throw new EtehadyarHttpError(400, 'فیلد «' . $field . '» معتبر نیست.');
    }
    // A character bound also applies to multibyte Persian text, without requiring mbstring.
    if (preg_match_all('/./us', $value) > $max) throw new EtehadyarHttpError(400, 'فیلد «' . $field . '» بیش از حد طولانی است.');
    return $value;
}

function etehadyar_list($value, string $field, int $max): array {
    if (!is_array($value) || array_values($value) !== $value || count($value) > $max) {
        throw new EtehadyarHttpError(400, 'فهرست «' . $field . '» معتبر نیست.');
    }
    return $value;
}

function etehadyar_url($value, string $field, bool $required = false): string {
    if (($value === null || $value === '') && !$required) return '';
    $value = etehadyar_text($value, $field, 2048);
    $parts = parse_url($value);
    if (!filter_var($value, FILTER_VALIDATE_URL) || !$parts || strtolower($parts['scheme'] ?? '') !== 'https'
        || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
        throw new EtehadyarHttpError(400, 'آدرس «' . $field . '» باید یک URL معتبر HTTPS باشد.');
    }
    return $value;
}

function etehadyar_validate_data($input): array {
    if (!is_array($input) || !isset($input['config'], $input['hero'], $input['faqs'], $input['releases'])
        || !is_array($input['config']) || !is_array($input['hero'])) {
        throw new EtehadyarHttpError(400, 'داده‌های سایت کامل نیست.');
    }
    $config = [];
    foreach (['siteName', 'siteNameEn', 'tagline', 'taglineEn', 'currentVersion', 'priceToman', 'priceUSD'] as $key) {
        $config[$key] = etehadyar_text($input['config'][$key] ?? null, $key, 200, !in_array($key, ['taglineEn'], true));
    }
    if (!preg_match('/\A\d+\.\d+\.\d+\z/', $config['currentVersion'])) throw new EtehadyarHttpError(400, 'نسخه فعلی باید با قالب 6.12.0 باشد.');
    $latinPrice = strtr($config['priceToman'], array_combine(preg_split('//u', '۰۱۲۳۴۵۶۷۸۹', -1, PREG_SPLIT_NO_EMPTY), str_split('0123456789')));
    $latinPrice = str_replace([',', '٬', ' '], '', $latinPrice);
    if (!preg_match('/\A\d{1,12}\z/', $latinPrice) || (float) $latinPrice <= 0
        || !preg_match('/\A\d{1,9}(?:\.\d{1,2})?\z/', $config['priceUSD']) || (float) $config['priceUSD'] <= 0) {
        throw new EtehadyarHttpError(400, 'قیمت‌ها باید عدد مثبت معتبر باشند.');
    }
    foreach (['purchaseUrlIR', 'purchaseUrlInternational', 'contactUrl', 'productUrl'] as $key) {
        $config[$key] = etehadyar_url($input['config'][$key] ?? '', $key, $key === 'productUrl');
    }
    foreach (['purchaseUrlIR', 'purchaseUrlInternational'] as $key) {
        if ($config[$key] !== '' && rtrim($config[$key], '/') === rtrim($config['productUrl'], '/')) {
            throw new EtehadyarHttpError(400, 'لینک خرید نباید به صفحه اصلی محصول برگردد.');
        }
    }
    $hero = [];
    foreach (['liveBadgeFa', 'liveBadgeEn', 'headlineFa', 'headlineEn', 'descriptionFa', 'descriptionEn', 'buttonPrimaryFa', 'buttonPrimaryEn', 'buttonGhostFa', 'buttonGhostEn'] as $key) {
        $hero[$key] = etehadyar_text($input['hero'][$key] ?? '', $key, strpos($key, 'description') === 0 ? 2000 : 300, substr($key, -2) === 'Fa');
    }
    $faqs = [];
    foreach (etehadyar_list($input['faqs'], 'FAQ', 100) as $index => $faq) {
        if (!is_array($faq)) throw new EtehadyarHttpError(400, 'سوال متداول معتبر نیست.');
        $item = ['id' => 'faq-' . ($index + 1)];
        foreach (['questionFa', 'questionEn', 'answerFa', 'answerEn'] as $key) {
            $item[$key] = etehadyar_text($faq[$key] ?? '', $key, strpos($key, 'question') === 0 ? 300 : 4000, substr($key, -2) === 'Fa');
        }
        $faqs[] = $item;
    }
    $releases = [];
    $seen = [];
    $hasCurrent = false;
    foreach (etehadyar_list($input['releases'], 'نسخه‌ها', 1000) as $release) {
        if (!is_array($release)) throw new EtehadyarHttpError(400, 'نسخه معتبر نیست.');
        $version = ltrim(etehadyar_text($release['version'] ?? null, 'version', 80), 'vV');
        if (!preg_match('/\A\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\z/', $version) || isset($seen[strtolower($version)])) {
            throw new EtehadyarHttpError(400, 'شماره نسخه نامعتبر یا تکراری است.');
        }
        $seen[strtolower($version)] = true;
        if (isset($release['is_alpha']) && !is_bool($release['is_alpha'])) throw new EtehadyarHttpError(400, 'وضعیت آزمایشی نسخه معتبر نیست.');
        $alpha = ($release['is_alpha'] ?? false) || strpos($version, '-') !== false;
        if ($version === $config['currentVersion'] && !$alpha) $hasCurrent = true;
        $items = [];
        foreach (etehadyar_list($release['items'] ?? [], 'تغییرات نسخه', 200) as $text) {
            $items[] = etehadyar_text($text, 'تغییر نسخه', 4000);
        }
        $sections = [];
        $flattened = [];
        foreach (etehadyar_list($release['subsections'] ?? [], 'بخش‌های نسخه', 50) as $section) {
            if (!is_array($section)) throw new EtehadyarHttpError(400, 'بخش نسخه معتبر نیست.');
            $title = etehadyar_text($section['title'] ?? '', 'عنوان بخش', 300, false);
            $sectionItems = [];
            foreach (etehadyar_list($section['items'] ?? [], 'تغییرات بخش', 200) as $text) {
                $sectionItems[] = etehadyar_text($text, 'تغییر بخش', 4000);
                $flattened[] = $text;
            }
            $sections[] = ['title' => $title, 'items' => $sectionItems];
        }
        // Edited flat items are authoritative; never display stale subsection text.
        if ($flattened !== $items) $sections = [];
        $releases[] = ['version' => $version, 'title' => etehadyar_text($release['title'] ?? null, 'عنوان نسخه', 300),
            'is_alpha' => $alpha, 'items' => $items, 'subsections' => $sections];
    }
    if (!$hasCurrent) throw new EtehadyarHttpError(400, 'نسخه فعلی باید در تاریخچه نسخه‌های پایدار ثبت شده باشد.');
    usort($releases, function ($a, $b) {
        if ($a['is_alpha'] !== $b['is_alpha']) return $a['is_alpha'] ? 1 : -1;
        return version_compare($b['version'], $a['version']);
    });
    $config['totalReleases'] = (string) count(array_filter($releases, function ($release) { return !$release['is_alpha']; }));
    return ['schemaVersion' => 1, 'config' => $config, 'hero' => $hero, 'faqs' => $faqs, 'releases' => $releases];
}

function etehadyar_read_data(): array {
    $raw = @file_get_contents(etehadyar_root() . '/data/site_data.json');
    if ($raw === false) throw new EtehadyarHttpError(503, 'داده‌های سایت قابل خواندن نیست.');
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new EtehadyarHttpError(503, 'فایل داده‌های سایت معتبر نیست.');
    return ['data' => $data, 'revision' => hash('sha256', $raw)];
}

/** Small, dependency-free ZIP writer (stored files, no private data). */
function etehadyar_public_zip(): string {
    $root = etehadyar_root();
    $files = ['index.html', '.htaccess', 'robots.txt', 'sitemap.xml', 'llms.txt', 'README-FA.md', 'CHANGELOG.md', 'AUDIT-FULL-REPORT.md', 'scripts/setup-admin.php', 'deploy/nginx.conf.example'];
    foreach (['about', 'docs', 'changelog', 'assets', 'admin', 'data'] as $folder) {
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root . '/' . $folder, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->isLink() || !$file->isFile()) continue;
            $name = str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
            if ($folder === 'data' && $name !== 'data/site_data.json' && $name !== 'data/.htaccess') continue;
            if (strpos($file->getFilename(), '.etehadyar-') === 0) continue;
            if (!preg_match('/\.(?:html|css|js|php|webp|jpg|svg|woff2|mp3|txt)$/i', $name) && basename($name) !== '.htaccess' && $name !== 'data/site_data.json') continue;
            $files[] = $name;
        }
    }
    $files = array_values(array_unique($files));
    sort($files, SORT_STRING);
    $body = '';
    $central = '';
    $count = 0;
    foreach ($files as $name) {
        $path = $root . '/' . $name;
        if (!is_file($path) || is_link($path)) continue;
        $content = file_get_contents($path);
        if ($content === false) throw new EtehadyarHttpError(503, 'ساخت بسته پشتیبان کامل نشد.');
        $length = strlen($content);
        $crc = crc32($content);
        $offset = strlen($body);
        // Deterministic timestamp: 1980-01-01, UTF-8 names, no compression.
        $body .= pack('VvvvvvVVVvv', 0x04034b50, 20, 0x800, 0, 0, 33, $crc, $length, $length, strlen($name), 0) . $name . $content;
        $central .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0x800, 0, 0, 33, $crc, $length, $length,
            strlen($name), 0, 0, 0, 0, 0, $offset) . $name;
        $count++;
    }
    return $body . $central . pack('VvvvvVVv', 0x06054b50, 0, 0, $count, $count, strlen($central), strlen($body), 0);
}
