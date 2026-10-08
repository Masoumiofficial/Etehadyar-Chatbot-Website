<?php
/** Run from a terminal, never expose a web-based first-user installer. */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
require_once __DIR__ . '/../admin/lib.php';
$options = getopt('', ['username:', 'private-dir:', 'reset']);
if (isset($options['private-dir'])) putenv('ETEHADYAR_PRIVATE_DIR=' . $options['private-dir']);
$username = $options['username'] ?? '';
if (!etehadyar_valid_username($username)) {
    fwrite(STDERR, "Usage: php scripts/setup-admin.php --username YOUR_USERNAME [--private-dir=/absolute/private/path] [--reset]\n");
    exit(1);
}
function read_secret(string $prompt): string {
    fwrite(STDOUT, $prompt);
    $hidden = function_exists('stream_isatty') && stream_isatty(STDIN) && PHP_OS_FAMILY !== 'Windows' && function_exists('system');
    if ($hidden) system('stty -echo');
    try {
        $line = fgets(STDIN);
        if ($line === false) throw new RuntimeException('No password received on stdin.');
        return rtrim($line, "\r\n");
    } finally {
        if ($hidden) system('stty echo');
        fwrite(STDOUT, "\n");
    }
}
try {
    $path = etehadyar_private_dir() . '/credentials.json';
    if (file_exists($path) && !isset($options['reset'])) {
        throw new RuntimeException('An administrator already exists. Use --reset only for an intentional password reset.');
    }
    $password = read_secret('Password (at least 12 characters, up to 72 UTF-8 bytes): ');
    $confirmation = read_secret('Confirm password: ');
    if (!hash_equals($password, $confirmation)) throw new RuntimeException('Passwords do not match.');
    etehadyar_validate_password($password);
    $hash = password_hash($password, PASSWORD_DEFAULT);
    if ($hash === false) throw new RuntimeException('Password hashing failed.');
    etehadyar_lock('credentials', function () use ($path, $username, $hash, $options) {
        if (file_exists($path) && !isset($options['reset'])) throw new RuntimeException('An administrator already exists.');
        etehadyar_atomic_write($path, json_encode([
            'username' => $username, 'passwordHash' => $hash,
            'revision' => bin2hex(random_bytes(16))
        ], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n");
    });
    unset($password, $confirmation);
    fwrite(STDOUT, "Administrator created. No default password is used. Credentials are stored outside the public web root.\n");
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
